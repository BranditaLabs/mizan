import { convertMoney, fromMinor, toMinor } from "@mizan/shared";
import { describe, expect, it } from "vitest";
import { computePnl, spreadShare, stageOf, type OrderStage, type PnlInput } from "../src/modules/profit/pnl.js";

/**
 * E9-2: properties of the profit function over thousands of generated orders (seeded, so a
 * failure always reproduces), plus worked examples a merchant can check by hand.
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
const STAGES: OrderStage[] = ["open", "confirmed", "shipped", "delivered", "returned", "cancelled"];
const MODES = ["cod", "partial", "prepaid", "bnpl", "bank_transfer"];
const egp = (amount: string) => ({ amount, currency: "EGP" });

function gen(r: () => number): PnlInput {
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
  const int = (max: number) => BigInt(Math.floor(r() * max));
  const stage = pick(STAGES);
  const mode = pick(MODES);
  const total = int(500_000) + 100n;
  const paid = mode === "cod" ? 0n : mode === "partial" ? total / 4n : r() < 0.8 ? total : 0n;
  const foreign = r() < 0.2;
  const currency = foreign ? "USD" : "EGP";
  // After a return is inspected (E10-3): some units back in stock, some lost, never more than the line.
  const inspect = (stage === "returned" || stage === "delivered") && r() < 0.6;
  const lines = Array.from({ length: 1 + Math.floor(r() * 3) }, () => {
    const quantity = 1 + Math.floor(r() * 4);
    const restocked = inspect ? Math.floor(r() * (quantity + 1)) : 0;
    const lost = inspect ? Math.floor(r() * (quantity - restocked + 1)) : 0;
    return { quantity, unitCostMinor: r() < 0.15 ? null : int(100_000), ...(inspect ? { restocked, lost } : {}) };
  });
  const has = () => r() < 0.8;
  return {
    stage, paymentMode: mode, currency, totalMinor: total, codMinor: mode === "cod" || mode === "partial" ? total - paid : 0n,
    refundedMinor: r() < 0.1 ? paid / 2n : 0n, rateToBase: foreign ? (r() < 0.8 ? "48.75" : null) : "1", base: "EGP", lines,
    confirmed: stage !== "open" && (stage !== "cancelled" || r() < 0.5),
    payments: paid > 0n ? [
      { kind: "sale", method: pick(["card", "wallet", "bnpl"]), amountMinor: paid, feeMinor: int(5_000), feeIsActual: r() < 0.3 },
      // E14-5: a chargeback (negative, with its fee), sometimes won back.
      ...(r() < 0.15 ? [{ kind: "chargeback", method: "card", amountMinor: -(paid / 2n), feeMinor: int(3_000), feeIsActual: true },
        ...(r() < 0.5 ? [{ kind: "chargeback_reversal", method: "card", amountMinor: paid / 2n, feeMinor: 0n, feeIsActual: true }] : [])] : []),
    ] : [],
    rules: {
      packaging: has() ? egp("7.50") : null, agent: has() ? egp("12.00") : null, codPct: has() ? "1.5" : null,
      courier: has() ? { amount: egp("60.00"), returnAmount: has() ? egp("30.00") : null } : null,
      paymentFee: (m) => (m === "card" ? { pct: "2.75", fixed: egp("2.00") } : null),
    },
    ...(r() < 0.4 ? { adsMinor: int(30_000), adsFxMissing: r() < 0.1 } : {}),
    ...(r() < 0.3 ? { actual: { shipping: int(9_000), ...(r() < 0.5 ? { cod: int(2_000) } : {}) } } : {}),
  };
}
const costsOf = (p: ReturnType<typeof computePnl>) => p.cogs + p.shipping + p.codFee + p.paymentFee + p.channelFee + p.ads + p.agent + p.packaging + p.rto + p.chargeback;

describe("profit properties (5,000 generated orders)", () => {
  const r = rng(20261023);
  const cases = Array.from({ length: 5000 }, () => gen(r));

  it("net is revenue minus refunds minus every cost, to the minor unit", () => {
    for (const c of cases) {
      const p = computePnl(c);
      expect(p.net).toBe(p.revenue - p.refund - costsOf(p));
    }
  });

  it("no component is ever negative", () => {
    for (const c of cases) {
      const p = computePnl(c);
      for (const [k, v] of Object.entries(p)) if (typeof v === "bigint" && !["net", "expectedNet"].includes(k)) expect(v >= 0n, `${k}`).toBe(true);
    }
  });

  it("cash on delivery earns only when delivered; cancelled before shipping costs no goods or shipping", () => {
    for (const c of cases) {
      const p = computePnl(c);
      if (c.paymentMode === "cod" && c.stage !== "delivered") expect(p.revenue).toBe(0n);
      if (c.stage === "cancelled") { expect(p.cogs + p.shipping + p.packaging + p.codFee + p.ads).toBe(0n); }
      if (c.stage === "open") { expect(p.cogs + p.shipping + p.packaging).toBe(0n); }
    }
  });

  it("an order still moving is expected to make its total, and no more than that", () => {
    for (const c of cases) {
      const p = computePnl(c);
      const moving = ["open", "confirmed", "shipped"].includes(c.stage);
      if (moving && p.currency === "EGP") {
        const total = c.currency === "USD" ? toMinor(convertMoney(fromMinor(c.totalMinor, "USD"), "EGP", "48.75")) : c.totalMinor;
        expect(p.expectedRevenue).toBe(total - p.refund);
        expect(p.expectedNet <= p.expectedRevenue).toBe(true);
      }
      if (!moving) expect(p.expectedNet).toBe(p.net);
    }
  });

  it("without a rate, the order stays in its own currency and no store cost is mixed in", () => {
    for (const c of cases) {
      const p = computePnl(c);
      if (c.rateToBase === null && c.currency !== c.base) {
        expect(p.currency).toBe("USD");
        expect(p.flags).toContain("fx_missing");
        expect(p.cogs + p.agent + p.packaging).toBe(0n);
      } else expect(p.currency).toBe("EGP");
    }
  });

  it("an order carries its ad share from the day it is placed, a refused one too; a cancelled one gives it back", () => {
    for (const c of cases) {
      const p = computePnl(c);
      const known = p.currency === "EGP";
      if (c.stage === "cancelled" || !known) expect(p.ads).toBe(0n);
      else expect(p.ads).toBe(c.adsMinor ?? 0n);
      if (c.adsFxMissing && c.stage !== "cancelled") expect(p.flags).toContain("ads_fx_missing");
    }
  });

  it("a day's spend is split to the minor unit: shares add up exactly and differ by at most one", () => {
    const r2 = rng(93);
    for (let k = 0; k < 2000; k++) {
      const total = BigInt(Math.floor(r2() * 10_000_000));
      const n = 1 + Math.floor(r2() * 400);
      const shares = Array.from({ length: n }, (_, i) => spreadShare(total, n, i));
      expect(shares.reduce((a, b) => a + b, 0n)).toBe(total);
      const min = shares.reduce((a, b) => (b < a ? b : a)), max = shares.reduce((a, b) => (b > a ? b : a));
      expect(max - min <= 1n).toBe(true);
    }
    expect(spreadShare(100n, 3, 0)).toBe(34n);
    expect(spreadShare(100n, 3, 2)).toBe(33n);
    expect(spreadShare(100n, 0, 0)).toBe(0n);
    expect(spreadShare(100n, 3, 3)).toBe(0n); // not one of the day's orders
  });

  it("returned goods cost only the units inspection lost; a delivered order's units sent back sellable come off its cost (E10-3)", () => {
    let seen = 0;
    for (const c of cases) {
      const p = computePnl(c);
      const known = c.rateToBase !== null;
      const cost = (f: (l: PnlInput["lines"][number]) => number) => (known ? c.lines.reduce((a, l) => a + (l.unitCostMinor ?? 0n) * BigInt(f(l)), 0n) : 0n);
      if (c.stage === "returned") {
        expect(p.cogs).toBe(cost((l) => l.lost ?? 0));
        const left = c.lines.reduce((a, l) => a + l.quantity - (l.restocked ?? 0) - (l.lost ?? 0), 0);
        expect(p.flags.includes("awaiting_inspection")).toBe(left > 0);
        seen++;
      }
      if (c.stage === "delivered" && c.confirmed) expect(p.cogs).toBe(cost((l) => l.quantity - (l.restocked ?? 0)));
      if (c.stage !== "returned") expect(p.flags).not.toContain("awaiting_inspection");
    }
    expect(seen).toBeGreaterThan(300);
  });

  it("is deterministic", () => {
    for (const c of cases.slice(0, 200)) expect(computePnl(c)).toEqual(computePnl(c));
  });
});

describe("worked examples", () => {
  const base: PnlInput = {
    stage: "delivered", paymentMode: "cod", currency: "EGP", totalMinor: 125000n, codMinor: 125000n, refundedMinor: 0n, rateToBase: "1", base: "EGP",
    lines: [{ quantity: 2, unitCostMinor: 40000n }], confirmed: true, payments: [],
    rules: { packaging: egp("7.50"), agent: egp("12.00"), codPct: "1.5", courier: { amount: egp("60.00"), returnAmount: egp("30.00") }, paymentFee: () => null },
  };

  it("a delivered COD abaya order: 1,250 − 800 product − 60 shipping − 18.75 COD fee − 12 agent − 7.50 packaging = 351.75", () => {
    const p = computePnl(base);
    expect(p).toMatchObject({ currency: "EGP", revenue: 125000n, cogs: 80000n, shipping: 6000n, codFee: 1875n, agent: 1200n, packaging: 750n, net: 35175n, isFinal: false });
    expect(p.flags).toEqual(["awaiting_settlement", "estimated"]);
  });

  it("the same order refused at the door: no revenue, the goods come back, shipping and the return leg are lost", () => {
    const p = computePnl({ ...base, stage: "returned" });
    expect(p).toMatchObject({ revenue: 0n, cogs: 0n, shipping: 6000n, rto: 3000n, codFee: 0n, agent: 1200n, packaging: 750n, net: -10950n });
  });

  it("the courier's cash in the ledger (the order owes nothing any more) is the same 1,250 of revenue", () => {
    const p = computePnl({ ...base, codMinor: 0n, payments: [{ kind: "cod_collection", method: "cod", amountMinor: 125000n, feeMinor: 0n, feeIsActual: false }] });
    expect(p).toMatchObject({ revenue: 125000n, codFee: 1875n, net: 35175n });
    // Before delivery it earns nothing, whatever the ledger says.
    expect(computePnl({ ...base, stage: "shipped", codMinor: 0n, payments: [{ kind: "cod_collection", method: "cod", amountMinor: 125000n, feeMinor: 0n, feeIsActual: false }] }).revenue).toBe(0n);
  });

  it("while it waits for confirmation it is expected to make the same 351.75", () => {
    const p = computePnl({ ...base, stage: "open", confirmed: false });
    expect(p).toMatchObject({ revenue: 0n, net: 0n, expectedRevenue: 125000n, expectedNet: 35175n });
  });

  it("a card order: revenue on payment, fee 2.75% + 2", () => {
    const p = computePnl({ ...base, stage: "confirmed", paymentMode: "prepaid", codMinor: 0n,
      payments: [{ kind: "sale", method: "card", amountMinor: 125000n, feeMinor: 0n, feeIsActual: false }],
      rules: { ...base.rules, paymentFee: () => ({ pct: "2.75", fixed: egp("2.00") }) } });
    expect(p).toMatchObject({ revenue: 125000n, paymentFee: 3638n, cogs: 80000n, shipping: 0n });
  });

  it("a chargeback costs what was taken back plus its fee; a won dispute gives the amount back, not the fee (E14-5)", () => {
    const card = { ...base, stage: "delivered" as const, paymentMode: "prepaid", codMinor: 0n, rules: { ...base.rules, paymentFee: () => null } };
    const sale = { kind: "sale", method: "card", amountMinor: 125000n, feeMinor: 0n, feeIsActual: true };
    const cb = { kind: "chargeback", method: "card", amountMinor: -125000n, feeMinor: 15000n, feeIsActual: true };
    const lost = computePnl({ ...card, payments: [sale, cb] });
    expect(lost).toMatchObject({ revenue: 125000n, chargeback: 140000n });
    expect(lost.net).toBe(computePnl({ ...card, payments: [sale] }).net - 140000n);
    const won = computePnl({ ...card, payments: [sale, cb, { kind: "chargeback_reversal", method: "card", amountMinor: 125000n, feeMinor: 0n, feeIsActual: true }] });
    expect(won.chargeback).toBe(15000n);
  });

  it("cancelled before anything moved is final at zero (agent time aside)", () => {
    const p = computePnl({ ...base, stage: "cancelled", confirmed: false });
    expect(p).toMatchObject({ net: 0n, isFinal: true, flags: [] });
  });

  it("names what is missing instead of guessing", () => {
    const p = computePnl({ ...base, lines: [{ quantity: 1, unitCostMinor: null }], rules: { packaging: null, agent: null, codPct: null, courier: null, paymentFee: () => null } });
    expect(p.flags).toEqual(["agent_cost_missing", "awaiting_settlement", "cod_fee_missing", "cost_missing", "packaging_cost_missing", "shipping_rate_missing"]);
    expect(p.net).toBe(125000n);
  });

  it("maps statuses to stages", () => {
    expect(stageOf("pending_confirmation", false)).toBe("open");
    expect(stageOf("cancelled", true)).toBe("returned");
    expect(stageOf("cancelled", false)).toBe("cancelled");
  });
});
