import { describe, expect, it } from "vitest";
import { cashToCollect, ShipBlockedError } from "../src/core/payments.js";
import { DriftMonitor } from "../src/adapt/drift.js";
import { salvageJson } from "../src/connectors/woocommerce/client.js";
import { detectWooPayment, mapWooOrder } from "../src/connectors/woocommerce/mapper.js";
import { isWooPing, signWoo, verifyWooSignature } from "../src/connectors/woocommerce/webhooks.js";
import { FakeClock } from "./fakes/clock.js";
import { settle, setupWoo } from "./fakes/setup.js";
import { FakeWooCommerce, type WooPayment } from "./fakes/woocommerce.js";
import { MizanEngine } from "../src/engine/engine.js";

const clock = new FakeClock();
const ctx = () => ({ drift: new DriftMonitor(), now: () => clock.now() });
const fake = () => new FakeWooCommerce(clock);

describe("WooCommerce mapping (E5-7)", () => {
  it.each<[WooPayment, string, string, string, string]>([
    // payment, mode, status, outstanding, cash the courier collects
    ["cod", "cod", "unpaid", "1250.00", "1250.00"],
    ["card", "prepaid", "paid", "0.00", "0.00"],
    ["bnpl", "bnpl", "paid", "0.00", "0.00"],
    ["free", "prepaid", "paid", "0.00", "0.00"],
  ])("%s → %s / %s, owes %s, the courier collects %s", (payment, mode, status, outstanding, cash) => {
    const o = mapWooOrder(fake().addOrder({ payment }), ctx());
    expect(o).toMatchObject({ connector: "woocommerce", paymentMode: mode, paymentStatus: status, outstanding: { amount: outstanding, currency: "EGP" } });
    expect(cashToCollect(o).amount).toBe(cash);
  });

  it("COD: WooCommerce stamps date_paid on 'processing', but nothing was paid", () => {
    const raw = fake().addOrder({ payment: "cod" });
    expect(raw.status).toBe("processing");
    expect(raw.date_paid).not.toBeNull();
    const o = mapWooOrder(raw, ctx());
    expect(o).toMatchObject({ paymentMode: "cod", paymentStatus: "unpaid", received: { amount: "0.00" }, outstanding: { amount: "1250.00" } });
    expect(mapWooOrder({ ...raw, status: "completed" }, ctx()).paymentStatus).toBe("unpaid"); // completed = shipped, not collected
  });

  it("bank transfer, Fawry and an order typed without a method do not ship until paid; never guessed", () => {
    const w = fake();
    const bank = w.addOrder({ payment: "bank" });
    for (const raw of [bank, w.addOrder({ payment: "fawry" }), w.addOrder({ payment: "manual" })]) {
      const o = mapWooOrder(raw, ctx());
      expect(() => cashToCollect(o)).toThrow(ShipBlockedError);
    }
    expect(mapWooOrder(bank, ctx())).toMatchObject({ paymentMode: "bank_transfer", paymentStatus: "unpaid" });
    expect(mapWooOrder(w.orders.get(bank.id + 2)!, ctx()).paymentMode).toBe("unknown");
    w.paid(bank.id);
    const paid = mapWooOrder(w.orders.get(bank.id)!, ctx());
    expect(paid).toMatchObject({ paymentMode: "bank_transfer", paymentStatus: "paid" });
    expect(cashToCollect(paid).amount).toBe("0.00");
  });

  it("refunds are negative in WooCommerce: partial and full", () => {
    const w = fake();
    const card = w.addOrder({ payment: "card" });
    w.refund(card.id, "250.00");
    expect(mapWooOrder(w.orders.get(card.id)!, ctx())).toMatchObject({ paymentStatus: "partially_refunded", refunded: { amount: "250.00" } });
    w.refund(card.id, "1000.00");
    w.setStatus(card.id, "refunded");
    const full = mapWooOrder(w.orders.get(card.id)!, ctx());
    expect(full).toMatchObject({ paymentStatus: "refunded", refunded: { amount: "1250.00" } });
    expect(() => cashToCollect(full)).toThrow(ShipBlockedError);
  });

  it("cancelled and trashed orders are cancelled; an unpaid one is voided", () => {
    const w = fake();
    const o = w.addOrder({ payment: "fawry" });
    w.setStatus(o.id, "cancelled");
    expect(mapWooOrder(w.orders.get(o.id)!, ctx())).toMatchObject({ cancelled: true, paymentStatus: "voided" });
    w.setStatus(o.id, "trash");
    expect(mapWooOrder(w.orders.get(o.id)!, ctx()).cancelled).toBe(true);
  });

  it("the state code becomes the governorate; a billing-only checkout is the delivery address; GMT dates get their zone", () => {
    const w = fake();
    const o = mapWooOrder(w.addOrder({ state: "EGGZ", city: "6 أكتوبر" }), ctx());
    expect(o.shippingAddress).toMatchObject({ line1: "12 شارع عباس العقاد", line2: "الدور 3", city: "6 أكتوبر", province: "Giza", countryCode: "EG", phone: "01001234821" });
    expect(o.customer).toEqual({ name: "منى عادل", phone: "01001234821", email: "mona@example.com" });
    expect(o.createdAt).toBe("2026-10-20T08:00:00.000Z");
    expect(o.number).toMatch(/^#\d+$/);
    expect(o.lines).toEqual([expect.objectContaining({ sku: "AB-1", quantity: 2, unitPrice: { amount: "600.00", currency: "EGP" }, variantExternalId: "501" })]);
    const billingOnly = mapWooOrder(w.addOrder({ billingOnly: true }), ctx());
    expect(billingOnly.shippingAddress).toMatchObject({ line1: "12 شارع عباس العقاد", province: "Cairo" });
  });

  it("an older payload (no *_gmt dates, prices as strings) still maps, and the fallback is recorded as drift", () => {
    const w = fake();
    w.legacyShape = true;
    const raw = w.addOrder();
    const c = ctx();
    const legacy = (w as unknown as { view(o: unknown): unknown }).view(raw);
    const o = mapWooOrder(legacy, c);
    expect(o.lines[0]!.unitPrice.amount).toBe("600.00");
    expect(o.updatedAt).toBe("2026-10-20T08:00:00.000Z");
    expect(c.drift.has((d) => d.kind === "fallback_field" && d.field === "date_created_gmt")).toBe(true);
  });

  it("a missing id or total is schema drift, not a broken order", () => {
    expect(() => mapWooOrder({ status: "processing" }, ctx())).toThrow(/required field "id"/);
  });

  it("merchant gateways are read by name: a renamed COD, InstaPay, valU", () => {
    const base = { status: "processing", datePaid: true, total: 100_00n, refunded: 0n };
    expect(detectWooPayment({ ...base, method: "custom_cash", title: "كاش عند الاستلام" }, {}).mode).toBe("cod");
    expect(detectWooPayment({ ...base, method: "instapay_gateway", title: "InstaPay" }, {}).mode).toBe("bank_transfer");
    expect(detectWooPayment({ ...base, method: "valu", title: "valU installments" }, {}).mode).toBe("bnpl");
    expect(detectWooPayment({ ...base, method: "kashier", title: "Card", status: "on-hold", datePaid: false }, {}).status).toBe("unpaid"); // never read as authorized
  });
});

describe("WooCommerce webhooks and client (E5-7)", () => {
  it("signature: base64 HMAC-SHA256 of the raw body with the secret's HTML entities decoded", () => {
    const body = JSON.stringify({ id: 1 });
    const sig = signWoo(body, "a &amp; b");
    expect(verifyWooSignature(body, sig, "a &amp; b")).toBe(true);
    expect(sig).toBe(signWoo(body, "a & b"));
    expect(verifyWooSignature(`${body} `, sig, "a &amp; b")).toBe(false);
    expect(verifyWooSignature(body, undefined, "a &amp; b")).toBe(false);
    expect(isWooPing("webhook_id=42")).toBe(true);
    expect(isWooPing(body)).toBe(false);
  });

  it("PHP notices before the JSON are recovered", () => {
    expect(salvageJson("<b>Deprecated</b>: x on line <b>4</b><br />\n{\"id\":7}")).toEqual({ id: 7 });
    expect(salvageJson("<html>maintenance</html>")).toBeUndefined();
  });

  it("answers the save-time ping, refuses a bad signature, reads each change once (thin webhook, fat fetch)", async () => {
    const { woo, engine, store, clock, latest } = setupWoo();
    const ping = woo.ping();
    expect(await engine.handleWooCommerceWebhook(ping.headers, ping.body)).toMatchObject({ status: 200, body: { ping: true } });
    const o = woo.addOrder({ payment: "bank" });
    const wh = woo.webhook("order.created", o);
    expect((await engine.handleWooCommerceWebhook({ ...wh.headers, "x-wc-webhook-signature": "AAAA" }, wh.body)).status).toBe(401);
    expect((await engine.handleWooCommerceWebhook(wh.headers, wh.body)).status).toBe(200);
    expect((await engine.handleWooCommerceWebhook(wh.headers, wh.body)).body).toEqual({ duplicate: true });
    await settle(engine, store, clock);
    expect(latest().get(String(o.id))).toMatchObject({ paymentMode: "bank_transfer", paymentStatus: "unpaid", number: `#${o.id}` });

    // Paid, then the older "created" delivery arrives late: the re-read wins, never the payload.
    clock.advance(2_000);
    woo.paid(o.id);
    const upd = woo.webhook("order.updated", woo.orders.get(o.id)!);
    await engine.handleWooCommerceWebhook(upd.headers, upd.body);
    const late = woo.webhook("order.created", { ...o, status: "on-hold", date_paid: null, date_modified_gmt: "2026-10-20T07:59:00" });
    await engine.handleWooCommerceWebhook(late.headers, late.body);
    await settle(engine, store, clock);
    expect(latest().get(String(o.id))).toMatchObject({ paymentStatus: "paid" });
    expect(woo.calls.filter((c) => c.path === `/orders/${o.id}`).length).toBeLessThanOrEqual(3);
  });

  it("deleted for good: the order is cancelled for Mizan", async () => {
    const { woo, engine, store, clock, latest, events } = setupWoo();
    const o = woo.addOrder();
    const wh = woo.webhook("order.created", o);
    await engine.handleWooCommerceWebhook(wh.headers, wh.body);
    await settle(engine, store, clock);
    woo.remove(o.id);
    const del = woo.webhook("order.deleted", { id: o.id });
    await engine.handleWooCommerceWebhook(del.headers, del.body);
    await settle(engine, store, clock);
    expect(latest().get(String(o.id))!.cancelled).toBe(true);
    expect(events.some((e) => e.event === "order.deleted")).toBe(true);
    expect(await store.jobs({ status: "dead" })).toEqual([]);
  });

  it("a host that drops the Authorization header: the keys go in the query string, and that is remembered", async () => {
    const { woo, engine, store, clock, learned } = setupWoo();
    await engine.init();
    woo.stripAuthHeader = true;
    const o = woo.addOrder();
    const wh = woo.webhook("order.created", o);
    await engine.handleWooCommerceWebhook(wh.headers, wh.body);
    await settle(engine, store, clock);
    expect(learned).toContainEqual({ provider: "woocommerce", state: { queryStringAuth: true } });
    expect(engine.drift.has((d) => d.connector === "woocommerce" && d.entity === "auth")).toBe(true);
  });

  it("a maintenance page and PHP notices: retried or recovered, never a broken order", async () => {
    const { woo, engine, store, clock, latest } = setupWoo();
    const o = woo.addOrder({ payment: "card" });
    woo.faults.push({ fault: "html" }, { fault: "notice" });
    const wh = woo.webhook("order.created", o);
    await engine.handleWooCommerceWebhook(wh.headers, wh.body);
    await settle(engine, store, clock);
    expect(latest().get(String(o.id))).toMatchObject({ paymentMode: "prepaid", paymentStatus: "paid" });
  });

  it("webhooks: created once, a disabled one turned back on, a lost create found instead of sent twice", async () => {
    const { woo, engine, store, clock } = setupWoo();
    woo.faults.push({ path: "/webhooks", fault: "500" });
    await store.enqueue(MizanEngineJob("r1"), clock.now());
    await settle(engine, store, clock);
    expect([...woo.webhooks.values()].map((w) => w.topic).sort()).toEqual(["order.created", "order.deleted", "order.updated"]);
    await store.enqueue(MizanEngineJob("r2"), clock.now());
    await settle(engine, store, clock);
    expect(woo.webhookCreates).toBe(3);

    woo.disableWebhooks();
    await store.enqueue(MizanEngineJob("r3"), clock.now());
    await settle(engine, store, clock);
    expect([...woo.webhooks.values()].every((w) => w.status === "active" && w.secret === woo.webhookSecret)).toBe(true);
    expect(woo.webhookCreates).toBe(3);
  });

  it("orders whose webhook never came are found by the poll", async () => {
    const { woo, engine, store, clock, latest } = setupWoo();
    const a = woo.addOrder({ payment: "cod" });
    const b = woo.addOrder({ payment: "bank" });
    clock.advance(60_000);
    await engine.scheduleReconcile();
    await settle(engine, store, clock);
    expect([...latest().keys()]).toEqual(expect.arrayContaining([String(a.id), String(b.id)]));
    clock.advance(60_000);
    woo.paid(b.id);
    clock.advance(5 * 60_000);
    await engine.scheduleReconcile();
    await settle(engine, store, clock);
    expect(latest().get(String(b.id))!.paymentStatus).toBe("paid");
  });
});

function MizanEngineJob(runKey: string) {
  return { kind: "woocommerce.syncWebhooks", connection: "woocommerce", payload: {}, idempotencyKey: `woocommerce:webhooks:${runKey}` };
}

describe("WooCommerce connect: the keys' check and the history (E5-7)", () => {
  it("refused keys end the check as needs-attention, not a dead job; good keys pass", async () => {
    const checks: unknown[] = [];
    const { woo, engine, store, clock } = setupWoo({ hooks: { onAccessChecked: async (provider, result) => { checks.push({ provider, ok: result.ok }); } } });
    const good = woo.consumerSecret;
    (woo as unknown as { consumerSecret: string }).consumerSecret = "cs_rotated";
    await store.enqueue(MizanEngine.wooWebhooksJob("bad"), clock.now());
    await settle(engine, store, clock);
    expect(checks).toEqual([{ provider: "woocommerce", ok: false }]);
    expect(await store.jobs({ status: "dead" })).toEqual([]);
    (woo as unknown as { consumerSecret: string }).consumerSecret = good;
    await store.enqueue(MizanEngine.wooWebhooksJob("good"), clock.now());
    await settle(engine, store, clock);
    expect(checks.at(-1)).toEqual({ provider: "woocommerce", ok: true });
  });

  it("imports the last days page by page, then the poll starts where the history ends", async () => {
    const { woo, engine, store, clock, latest } = setupWoo();
    for (let i = 0; i < 120; i++) woo.addOrder({ payment: i % 2 ? "cod" : "card" });
    clock.advance(60_000);
    await store.enqueue(MizanEngine.wooBackfillJob("connect", clock.now() - 60 * 86_400_000), clock.now());
    await settle(engine, store, clock);
    expect(latest().size).toBe(120);
    expect((await store.jobs({ kind: "woocommerce.backfill" })).length).toBe(3); // 50 + 50 + 20
    expect(await store.get("cursor", "woocommerce.orders")).toEqual({ since: new Date(clock.now()).toISOString() });
  });
});
