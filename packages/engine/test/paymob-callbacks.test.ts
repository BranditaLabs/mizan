import { describe, expect, it } from "vitest";
import { MizanEngine } from "../src/engine/engine.js";
import { paymobHmac, paymobRedirectString, paymobTransactionString, verifyPaymobCallback, verifyPaymobRedirect } from "../src/connectors/paymob/webhooks.js";
import { mapTransaction } from "../src/connectors/paymob/mapper.js";
import type { GatewayTransactionUpdate } from "../src/core/gateway-transaction.js";
import type { PaymentLinkOutcome, PaymentLinkRequest } from "../src/core/payment-link.js";
import { settle, setupPaymob } from "./fakes/setup.js";

/**
 * E14-2b: Paymob callbacks — the HMAC over the 20 values, thin webhook and fat fetch, dedupe on the
 * id and its flags, lines from what changed (never twice, whatever order or how often callbacks
 * come), refunds and voids through their parent, the inquiry when no callback comes, flags Mizan
 * does not know go to a person and post nothing; chaos at 10–50 %.
 */
const OFFICIAL = {
  amount_cents: 100000, created_at: "2024-06-13T11:33:44.592345", currency: "EGP", error_occured: false, has_parent_transaction: false, id: 192036465,
  integration_id: 4097558, is_3d_secure: true, is_auth: false, is_capture: false, is_refunded: false, is_standalone_payment: true, is_voided: false,
  order: { id: 217503754 }, owner: 302852, pending: false, source_data: { pan: "2346", sub_type: "MasterCard", type: "card" }, success: true,
};
const drift = { record: () => undefined };

describe("the callback signature (E14-2b)", () => {
  it("signs the 20 values of the docs' example in their order, booleans as true/false, nothing between", () => {
    expect(paymobTransactionString(OFFICIAL)).toBe("1000002024-06-13T11:33:44.592345EGPfalsefalse1920364654097558truefalsefalsefalsetruefalse217503754302852false2346MasterCardcardtrue");
    // The docs' digest fa8ac0b7… is for a secret they do not print: confirm with the sandbox account's secret.
    const hmac = paymobHmac(paymobTransactionString(OFFICIAL), "s3cret");
    expect(hmac).toMatch(/^[0-9a-f]{128}$/);
    expect(verifyPaymobCallback({ hmac }, { type: "TRANSACTION", obj: OFFICIAL }, "s3cret")).toMatchObject({ ok: true, type: "TRANSACTION", transactionId: "192036465" });
    expect(verifyPaymobCallback({ hmac: hmac.toUpperCase() }, { type: "TRANSACTION", obj: OFFICIAL }, "s3cret").ok).toBe(true);
  });

  it("refuses a changed amount, a flipped flag, another secret, no hmac, a body without obj", () => {
    const hmac = paymobHmac(paymobTransactionString(OFFICIAL), "s3cret");
    expect(verifyPaymobCallback({ hmac }, { obj: { ...OFFICIAL, amount_cents: 1 } }, "s3cret")).toEqual({ ok: false, reason: "signature" });
    expect(verifyPaymobCallback({ hmac }, { obj: { ...OFFICIAL, success: false } }, "s3cret")).toEqual({ ok: false, reason: "signature" });
    expect(verifyPaymobCallback({ hmac }, { obj: OFFICIAL }, "other")).toEqual({ ok: false, reason: "signature" });
    expect(verifyPaymobCallback({}, { obj: OFFICIAL }, "s3cret")).toEqual({ ok: false, reason: "signature" });
    expect(verifyPaymobCallback({ hmac }, { type: "TRANSACTION" }, "s3cret")).toEqual({ ok: false, reason: "shape" });
    expect(verifyPaymobCallback({ hmac: "ab" }, { obj: OFFICIAL }, "s3cret").ok).toBe(false); // short: no throw
  });

  it("the browser redirect's flat query signs the same values (order or order_id, source_data.pan or source_data_pan)", () => {
    const flat = (orderKey: string, sep: string) => ({
      amount_cents: "100000", created_at: OFFICIAL.created_at, currency: "EGP", error_occured: "false", has_parent_transaction: "false", id: "192036465", integration_id: "4097558",
      is_3d_secure: "true", is_auth: "false", is_capture: "false", is_refunded: "false", is_standalone_payment: "true", is_voided: "false", [orderKey]: "217503754", owner: "302852",
      pending: "false", [`source_data${sep}pan`]: "2346", [`source_data${sep}sub_type`]: "MasterCard", [`source_data${sep}type`]: "card", success: "true",
    });
    expect(paymobRedirectString(flat("order", "."))).toBe(paymobTransactionString(OFFICIAL));
    expect(paymobRedirectString(flat("order_id", "_"))).toBe(paymobTransactionString(OFFICIAL));
    const hmac = paymobHmac(paymobTransactionString(OFFICIAL), "s3cret");
    expect(verifyPaymobRedirect({ ...flat("order", "."), hmac }, "s3cret")).toBe(true);
    expect(verifyPaymobRedirect({ ...flat("order", "."), success: "false", hmac }, "s3cret")).toBe(false);
  });

  it("reads a transaction by candidate paths: money from the cent fields only, kiosk reference, parent, a method it does not know", () => {
    const notes: unknown[] = [];
    const t = mapTransaction({ ...OFFICIAL, order: { id: 1, merchant_order_id: "o:full:1" }, refunded_amount_cents: 2500, captured_amount: 0, data: { amount: 1000, bill_reference: 77 }, parent_transaction: null }, { drift, now: Date.now });
    expect(t).toMatchObject({ id: "192036465", reference: "o:full:1", amountMinor: 100000n, refundedMinor: 2500n, method: "card", parentId: null, kioskReference: "77" });
    const odd = mapTransaction({ ...OFFICIAL, source_data: { type: "crypto", sub_type: "x" }, parent_transaction: 5 }, { drift: { record: (e) => { notes.push(e); } }, now: Date.now });
    expect(odd).toMatchObject({ method: "other", parentId: "5" });
    expect(notes).toEqual([expect.objectContaining({ kind: "unknown_status", field: "source_data.type" })]);
  });
});

function world(seed = 0, rate = 0) {
  const requests = new Map<string, PaymentLinkRequest>();
  const links = new Map<string, PaymentLinkOutcome>();
  const updates: GatewayTransactionUpdate[] = [];
  let failHook = 0;
  const w = setupPaymob({ hooks: {
    loadPaymentLink: async (id) => requests.get(id),
    onPaymentLink: async (id, r) => { links.set(id, r); },
    onGatewayTransaction: async (u) => {
      if (failHook > 0) { failHook--; throw new Error("ledger unavailable"); }
      updates.push(u);
    },
  } }, undefined, seed);
  /** A link made and an intention behind it, ready to pay. */
  const link = async (n: number, amount = "1150.00") => {
    const r: PaymentLinkRequest = { linkId: `link-${n}`, orderId: `order-${n}`, orderNumber: `#10${n}`, purpose: "full", amount: { amount, currency: "EGP" }, methods: ["card", "wallet", "kiosk"], customer: { phone: "+201001234821" } };
    requests.set(r.linkId, r);
    await w.store.enqueue(MizanEngine.paymentLinkJob(r.linkId), w.clock.now());
    await settle(w.engine, w.store, w.clock);
    const out = links.get(r.linkId)!;
    if (!out.ok) throw new Error("no link");
    return out.intentionId;
  };
  const deliver = async (cb: { query: Record<string, string>; body: unknown }) => w.engine.handlePaymobWebhook(cb.query, cb.body);
  /** Every line posted, by its reference (the ledger's unique key): a repeat posts nothing. */
  const ledger = () => {
    const byRef = new Map<string, { kind: string; amount: bigint; txn: string }>();
    for (const u of updates) for (const l of u.lines) if (!byRef.has(l.externalRef)) byRef.set(l.externalRef, { kind: l.kind, amount: l.amountMinor, txn: u.transactionId });
    return [...byRef.values()];
  };
  const allLines = () => updates.flatMap((u) => u.lines);
  w.paymob.randomFaultRate = rate;
  return { ...w, updates, link, deliver, ledger, allLines, failNext: (n: number) => { failHook = n; } };
}

const sum = (lines: Array<{ kind: string; amount: bigint }>, kind: string) => lines.filter((l) => l.kind === kind).reduce((a, l) => a + l.amount, 0n);

describe("callbacks to the ledger (E14-2b)", () => {
  it("a paid card: verified, re-read, one sale line with Mizan's reference; the same callback again posts nothing", async () => {
    const w = world();
    const intention = await w.link(1);
    const { transactionId, callback } = w.paymob.pay(intention);
    expect(await w.deliver(callback)).toEqual({ status: 200, body: { ok: true } });
    await settle(w.engine, w.store, w.clock);
    expect(w.updates).toEqual([expect.objectContaining({ gateway: "paymob", transactionId, reference: "order-1:full:1", state: "succeeded", method: "card", currency: "EGP", amountMinor: 115000n, needsReview: false })]);
    expect(w.allLines()).toEqual([{ kind: "sale", amountMinor: 115000n, externalRef: `${transactionId}:sale`, occurredAt: expect.any(String) }]);

    expect(await w.deliver(callback)).toEqual({ status: 200, body: { ok: true } });
    await w.deliver(callback);
    await settle(w.engine, w.store, w.clock);
    expect(w.updates).toHaveLength(1); // deduped on the id and its flags
  });

  it("never trusts the body: a tampered callback is refused, a forged amount never posts", async () => {
    const w = world();
    const { callback } = w.paymob.pay(await w.link(1));
    const forged = structuredClone(callback.body) as { obj: Record<string, unknown> };
    forged.obj.amount_cents = 1;
    expect(await w.deliver({ query: callback.query, body: forged })).toEqual({ status: 401, body: { error: "invalid signature" } });
    expect(w.events).toContainEqual({ event: "webhook.rejected", data: { provider: "paymob", reason: "signature" } });
    await settle(w.engine, w.store, w.clock);
    expect(w.updates).toEqual([]);
  });

  it("the amount is the re-read one, not the callback's (fat fetch)", async () => {
    const w = world();
    const { transactionId, callback } = w.paymob.pay(await w.link(1));
    w.paymob.transactions.get(transactionId)!.amount_cents = 90000; // what Paymob has now
    await w.deliver(callback);
    await settle(w.engine, w.store, w.clock);
    expect(w.allLines()).toEqual([expect.objectContaining({ kind: "sale", amountMinor: 90000n })]);
  });

  it("a saved card's TOKEN callback is acknowledged and dropped; a forged one is refused", async () => {
    const w = world();
    const tok = w.paymob.tokenCallback();
    expect(await w.deliver(tok)).toEqual({ status: 200, body: { ok: true } });
    expect(await w.deliver({ query: { hmac: "00" }, body: tok.body })).toMatchObject({ status: 401 });
    await settle(w.engine, w.store, w.clock);
    expect(w.updates).toEqual([]);
    expect(await w.store.jobs({})).toEqual(expect.not.arrayContaining([expect.objectContaining({ kind: "paymob.ingestTransaction" })]));
  });

  it("a declined card: failed, no lines; a kiosk reference: pending with the reference to show, then the sale once paid", async () => {
    const w = world();
    const declined = w.paymob.pay(await w.link(1), { outcome: "declined" });
    await w.deliver(declined.callback);
    const kiosk = w.paymob.pay(await w.link(2), { method: "kiosk", outcome: "pending" });
    await w.deliver(kiosk.callback);
    await settle(w.engine, w.store, w.clock);
    expect(w.updates.map((u) => [u.reference, u.state, u.lines.length])).toEqual([["order-1:full:1", "failed", 0], ["order-2:full:1", "pending", 0]]);
    expect(w.updates[1]).toMatchObject({ method: "kiosk", kioskReference: "7134651" });

    await w.deliver(w.paymob.complete(kiosk.transactionId));
    await settle(w.engine, w.store, w.clock);
    expect(w.updates.at(-1)).toMatchObject({ state: "succeeded", lines: [expect.objectContaining({ kind: "sale", amountMinor: 115000n })] });
  });

  it("refunds from the dashboard come as children: re-read through the parent, each partial refund once, by how much the total moved", async () => {
    const w = world();
    const paid = w.paymob.pay(await w.link(1));
    await w.deliver(paid.callback);
    const r1 = w.paymob.refund(paid.transactionId, 15000);
    const r2 = w.paymob.refund(paid.transactionId, 5000);
    // Out of order, and each twice.
    await w.deliver(r2); await w.deliver(r1); await w.deliver(r2); await w.deliver(r1);
    await settle(w.engine, w.store, w.clock);
    const ledger = w.ledger();
    expect(sum(ledger, "sale")).toBe(115000n);
    expect(sum(ledger, "refund")).toBe(20000n);
    expect(ledger.every((l) => l.txn === paid.transactionId)).toBe(true); // all on the parent
    expect(w.allLines().filter((l) => l.kind === "refund").reduce((a, l) => a + l.amountMinor, 0n)).toBe(20000n); // no line twice, even before the ledger's key
  });

  it("an authorization, a partial capture and a void of the rest", async () => {
    const w = world();
    const auth = w.paymob.pay(await w.link(1), { auth: true });
    await w.deliver(auth.callback);
    await settle(w.engine, w.store, w.clock);
    expect(w.updates[0]).toMatchObject({ state: "authorized", lines: [expect.objectContaining({ kind: "authorization", amountMinor: 115000n })] });
    await w.deliver(w.paymob.capture(auth.transactionId, 100000));
    await settle(w.engine, w.store, w.clock);
    await w.deliver(w.paymob.void(auth.transactionId));
    await settle(w.engine, w.store, w.clock);
    const ledger = w.ledger();
    expect(sum(ledger, "capture")).toBe(100000n);
    expect(sum(ledger, "void")).toBe(15000n);
    expect(w.updates.at(-1)!.state).toBe("voided");
  });

  it("flags Mizan does not know (a success with an error) need a person and post nothing", async () => {
    const w = world();
    const { transactionId, callback } = w.paymob.pay(await w.link(1));
    w.paymob.transactions.get(transactionId)!.error_occured = true;
    await w.deliver(callback);
    await settle(w.engine, w.store, w.clock);
    expect(w.updates).toEqual([expect.objectContaining({ needsReview: true, lines: [] })]);
  });

  it("a failing ledger hook retries the same lines: nothing lost, nothing twice", async () => {
    const w = world();
    const { transactionId, callback } = w.paymob.pay(await w.link(1));
    w.failNext(2);
    await w.deliver(callback);
    await settle(w.engine, w.store, w.clock);
    expect(w.updates).toHaveLength(1);
    expect(w.allLines()).toEqual([expect.objectContaining({ kind: "sale", externalRef: `${transactionId}:sale` })]);
    expect(await w.store.jobs({ status: "dead" })).toEqual([]);
  });

  it("no callback came: the inquiry by Mizan's reference finds the payment, and finds nothing (quietly) when there is none", async () => {
    const w = world();
    const intention = await w.link(1);
    const { transactionId } = w.paymob.pay(intention); // callback lost
    await w.store.enqueue(MizanEngine.paymobInquiryJob("order-1:full:1", "r1"), w.clock.now());
    await w.store.enqueue(MizanEngine.paymobInquiryJob("order-9:full:1", "r1"), w.clock.now());
    await settle(w.engine, w.store, w.clock);
    expect(w.updates).toEqual([expect.objectContaining({ transactionId, state: "succeeded" })]);
    // The callback arriving late adds nothing.
    await w.deliver(w.paymob.callback(w.paymob.transactions.get(transactionId)!));
    await settle(w.engine, w.store, w.clock);
    expect(w.ledger()).toHaveLength(1);
    expect(await w.store.jobs({ status: "dead" })).toEqual([]);
  });

  it.each([[0.1, 1], [0.25, 2], [0.5, 3], [0.5, 4]])("chaos at %s (seed %i): every sale and refund once, none lost, nothing dead", async (rate, seed) => {
    const w = world(seed, 0);
    const paid: Array<{ id: string; amount: bigint; refunded: bigint }> = [];
    for (let n = 1; n <= 8; n++) {
      const p = w.paymob.pay(await w.link(n, `${100 + n}.50`));
      paid.push({ id: p.transactionId, amount: BigInt(Math.round((100 + n + 0.5) * 100)), refunded: 0n });
    }
    w.paymob.randomFaultRate = rate;
    const callbacks: Array<{ query: Record<string, string>; body: unknown }> = [];
    for (const [i, p] of paid.entries()) {
      callbacks.push(w.paymob.callback(w.paymob.transactions.get(p.id)!));
      if (i % 2 === 0) { callbacks.push(w.paymob.refund(p.id, 1000)); p.refunded += 1000n; }
      if (i % 4 === 0) { callbacks.push(w.paymob.refund(p.id, 500)); p.refunded += 500n; }
    }
    // Every callback twice, in a shuffled order.
    const order = [...callbacks, ...callbacks].map((c, i) => ({ c, k: (i * 7919 + seed * 31) % 101 })).sort((a, b) => a.k - b.k).map((x) => x.c);
    for (const c of order) expect((await w.deliver(c)).status).toBe(200);
    await settle(w.engine, w.store, w.clock, 2000);
    const ledger = w.ledger();
    for (const p of paid) {
      const mine = ledger.filter((l) => l.txn === p.id);
      expect(sum(mine, "sale")).toBe(p.amount);
      expect(sum(mine, "refund")).toBe(p.refunded);
    }
    expect(await w.store.jobs({ status: "dead" })).toEqual([]);
  });
});
