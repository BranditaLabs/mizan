import { describe, expect, it } from "vitest";
import { add, check, LEDGER_KINDS, statusOf, totals, ZERO, type LedgerKind, type LedgerLine, type LedgerStatus } from "../src/modules/payments/ledger.js";
import { money } from "../src/modules/payments/ledger.service.js";

/**
 * E14-1: the ledger's properties over thousands of generated histories (seeded, so a failure
 * always reproduces). Every history is built only from lines the ledger accepts, the way the
 * service writes them; then the order's totals must be exactly the sums of its lines.
 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const STATUSES: LedgerStatus[] = ["succeeded", "succeeded", "succeeded", "pending", "failed"];
const NEGATIVE = new Set<LedgerKind>(["refund", "chargeback", "void"]);

function history(r: () => number) {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const total = BigInt(1 + Math.floor(r() * 500_000));
  const lines: LedgerLine[] = [];
  let rejected = 0;
  let t = ZERO;
  for (let i = 0; i < 2 + Math.floor(r() * 14); i++) {
    const kind = pick(LEDGER_KINDS);
    const size = BigInt(Math.floor(r() * Number(total)) + (r() < 0.1 ? 0 : 1));
    // Mostly the right sign; sometimes the wrong one, which must be refused.
    const amount = (NEGATIVE.has(kind) ? -size : size) * (r() < 0.05 ? -1n : 1n);
    const status = pick(STATUSES);
    if (status === "succeeded" && check(t, total, { kind, amountMinor: amount })) { rejected++; continue; }
    if (amount === 0n) continue; // the database refuses a zero line whatever its status
    const line = { kind, status, amountMinor: amount };
    lines.push(line);
    t = add(t, line);
  }
  return { total, lines, t, rejected };
}

describe("payment ledger (E14-1)", () => {
  it("the totals are always the sums of the succeeded lines, and never leave their bounds", () => {
    const r = rng(14_1);
    let rejected = 0;
    for (let n = 0; n < 5000; n++) {
      const h = history(r);
      rejected += h.rejected;
      const ok = h.lines.filter((l) => l.status === "succeeded");
      const sum = (kinds: LedgerKind[]) => ok.filter((l) => kinds.includes(l.kind)).reduce((a, l) => a + l.amountMinor, 0n);

      expect(totals(h.lines)).toEqual(h.t); // incremental = from scratch, whatever the order
      expect(totals([...h.lines].reverse()).paid).toBe(h.t.paid);
      expect(h.t.paid).toBe(sum(["sale", "capture", "cod_collection", "void"]));
      expect(h.t.refunded).toBe(-sum(["refund"]));
      expect(h.t.chargedBack).toBe(-sum(["chargeback", "chargeback_reversal"]));
      // The ledger lines sum to what the merchant holds, and the order's balance is what is left.
      expect(sum(["sale", "capture", "cod_collection", "void", "refund", "chargeback", "chargeback_reversal"])).toBe(h.t.net);
      expect(h.t.net).toBe(h.t.paid - h.t.refunded - h.t.chargedBack);
      expect(h.t.paid >= 0n && h.t.paid <= h.total).toBe(true);
      expect(h.t.net >= 0n).toBe(true);
      expect(h.t.refunded >= 0n && h.t.refunded <= h.t.paid).toBe(true);
      expect(h.t.chargedBack >= 0n).toBe(true);
      const balance = h.total - h.t.paid;
      expect(balance >= 0n && balance + h.t.paid === h.total).toBe(true);

      const status = statusOf(h.t, h.total, "unpaid");
      if (h.t.chargedBack > 0n) expect(status).toBe("disputed");
      else if (h.t.refunded > 0n) expect(status).toBe(h.t.refunded >= h.t.paid ? "refunded" : "partially_refunded");
      else if (h.t.paid === h.total) expect(status).toBe("paid");
      else if (h.t.paid > 0n) expect(status).toBe("partially_paid");
    }
    expect(rejected).toBeGreaterThan(1000); // the generator does try to break the rules
  });

  it("refuses what would make the ledger unsound", () => {
    const t = totals([{ kind: "sale", status: "succeeded", amountMinor: 30_000n }]);
    expect(check(t, 100_000n, { kind: "sale", amountMinor: 70_001n })).toBe("over_payment");
    expect(check(t, 100_000n, { kind: "sale", amountMinor: 70_000n })).toBeNull();
    expect(check(t, 100_000n, { kind: "refund", amountMinor: -30_001n })).toBe("over_refund");
    expect(check(t, 100_000n, { kind: "refund", amountMinor: -30_000n })).toBeNull();
    expect(check(t, 100_000n, { kind: "refund", amountMinor: 500n })).toBe("wrong_sign");
    expect(check(t, 100_000n, { kind: "sale", amountMinor: 0n })).toBe("zero_amount");
    expect(check(t, 100_000n, { kind: "chargeback_reversal", amountMinor: 1n })).toBe("over_reversal");
    expect(check(ZERO, 100_000n, { kind: "refund", amountMinor: -1n })).toBe("over_refund"); // nothing received yet
    // An authorization holds money: capture it, never authorize past the total.
    const held = add(ZERO, { kind: "authorization", status: "succeeded", amountMinor: 100_000n });
    expect(held.authorized).toBe(100_000n);
    expect(check(held, 100_000n, { kind: "authorization", amountMinor: 1n })).toBe("over_payment");
    const captured = add(held, { kind: "capture", status: "succeeded", amountMinor: 100_000n });
    expect(captured).toMatchObject({ authorized: 0n, paid: 100_000n, net: 100_000n });
    expect(statusOf(held, 100_000n, "unpaid")).toBe("authorized");
    expect(statusOf(ZERO, 100_000n, "failed")).toBe("failed");
  });

  it("with only the store's lines the store's status and cash stand; with the team's own, the sums decide", () => {
    const store = [{ kind: "sale" as const, status: "succeeded" as const, amountMinor: 25_000n, source: "store" as const }];
    const o = { paid_minor: 25_000n, refunded_minor: 0n, payment_status: "partially_paid", cod_minor: 75_000n, total_minor: 100_000n, payment_mode: "partial", previous_status: "partially_paid" };
    expect(money(store, o)).toEqual({ paid_minor: 25_000n, refunded_minor: 0n, payment_status: "partially_paid", cod_minor: 75_000n });
    const withTransfer = [...store, { kind: "sale" as const, status: "succeeded" as const, amountMinor: 75_000n, source: "manual" as const }];
    expect(money(withTransfer, o)).toEqual({ paid_minor: 100_000n, refunded_minor: 0n, payment_status: "paid", cod_minor: 0n });
    expect(money(withTransfer, { ...o, payment_mode: "bank_transfer", cod_minor: 0n }).cod_minor).toBe(0n);
  });
});
