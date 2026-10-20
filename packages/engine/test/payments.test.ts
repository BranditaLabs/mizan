import { describe, expect, it } from "vitest";
import type { CanonicalOrder } from "../src/core/model.js";
import { cashToCollect, fromMinor, ShipBlockedError, toMinor } from "../src/core/payments.js";
import { detectPayment } from "../src/connectors/shopify/mapper.js";
import { settle, setup } from "./fakes/setup.js";

type Ctx = ReturnType<typeof setup>;
type OrderOpts = Parameters<Ctx["shop"]["addOrder"]>[0];

async function confirmedOrder(ctx: Ctx, opts: OrderOpts = {}) {
  const { shop, engine, store, clock } = ctx;
  const o = shop.addOrder({ tags: ["mizan-confirmed"], ...opts });
  const wh = shop.webhook("orders/create", o);
  await engine.handleShopifyWebhook(wh.headers, wh.body);
  await settle(engine, store, clock);
  const rec = await store.get<{ trackingNumber?: string; order: CanonicalOrder }>("order", o.id);
  return { order: o, tn: rec?.trackingNumber, rec };
}

async function deliver(ctx: Ctx, tn: string) {
  ctx.clock.advance(60_000);
  ctx.bosta.setState(tn, 45, "Delivered");
  await ctx.engine.handleBostaWebhook({ token: "whsec-bosta" }, {}, ctx.bosta.webhook(tn, { withLabel: true }));
  await settle(ctx.engine, ctx.store, ctx.clock);
}

const marksPaid = (ctx: Ctx) => ctx.shop.count("MizanOrderMarkPaid");

describe("money arithmetic", () => {
  it("converts decimal strings exactly, including 3-decimal currencies", () => {
    expect(toMinor({ amount: "1150.5", currency: "EGP" })).toBe(115050n);
    expect(toMinor({ amount: "12.345", currency: "KWD" })).toBe(12345n);
    expect(toMinor({ amount: "1,150.00", currency: "SAR" })).toBe(115000n);
    expect(fromMinor(180000n, "EGP")).toEqual({ amount: "1800.00", currency: "EGP" });
    expect(fromMinor(5n, "BHD")).toEqual({ amount: "0.005", currency: "BHD" });
    expect(() => toMinor({ amount: "12abc", currency: "EGP" })).toThrow();
  });
});

describe("payment method detection (Shopify)", () => {
  const d = (g: string[], f?: string, received?: string) => detectPayment(g, f, received ? { amount: received, currency: "EGP" } : undefined, {});
  it.each([
    [["Cash on Delivery (COD)"], "PENDING", "0.00", "cod", "unpaid"],
    [["الدفع عند الاستلام"], "PENDING", undefined, "cod", "unpaid"],
    [["paymob"], "PAID", "1150.00", "prepaid", "paid"],
    [["shopify_payments"], "AUTHORIZED", "0.00", "prepaid", "authorized"],
    [["paymob", "Cash on Delivery (COD)"], "PARTIALLY_PAID", "300.00", "partial", "partially_paid"],
    [["Tabby"], "PAID", "899.00", "bnpl", "paid"],
    [["Tamara Pay in 3"], "PAID", "899.00", "bnpl", "paid"],
    [["Bank Deposit"], "PENDING", "0.00", "bank_transfer", "unpaid"],
    [["InstaPay transfer"], "PAID", "500.00", "bank_transfer", "paid"],
    [["manual"], "PENDING", "0.00", "unknown", "unpaid"],
    [[], "PENDING", undefined, "unknown", "unpaid"],
    [["paymob"], "REFUNDED", "1150.00", "prepaid", "refunded"],
  ])("%j %s → %s / %s", (g, f, r, mode, status) => {
    expect(d(g as string[], f as string, r as string | undefined)).toEqual({ mode, status });
  });
});

describe("cash the courier collects", () => {
  const base: CanonicalOrder = {
    connector: "shopify", externalId: "1", number: "#1", createdAt: "", updatedAt: "", currency: "EGP",
    total: { amount: "2100.00", currency: "EGP" }, paymentMode: "cod", paymentStatus: "unpaid", gateways: [],
    cancelled: false, customer: { name: "x" }, lines: [], fulfillmentGroups: [], tags: [],
  };
  const o = (p: Partial<CanonicalOrder>) => ({ ...base, ...p });

  it("COD collects what is outstanding, else the total", () => {
    expect(cashToCollect(o({})).amount).toBe("2100.00");
    expect(cashToCollect(o({ outstanding: { amount: "1999.50", currency: "EGP" } })).amount).toBe("1999.50");
  });
  it("deposit orders collect only the balance", () => {
    expect(cashToCollect(o({ paymentMode: "partial", paymentStatus: "partially_paid", received: { amount: "300.00", currency: "EGP" } })).amount).toBe("1800.00");
    expect(() => cashToCollect(o({ paymentMode: "partial" }))).toThrow(ShipBlockedError);
  });
  it("paid card, BNPL and bank-transfer orders collect nothing", () => {
    for (const paymentMode of ["prepaid", "bnpl", "bank_transfer"] as const) {
      expect(cashToCollect(o({ paymentMode, paymentStatus: "paid" })).amount).toBe("0.00");
    }
    expect(cashToCollect(o({ paymentMode: "prepaid", paymentStatus: "authorized" })).amount).toBe("0.00");
  });
  it("blocks orders that must not ship, with a reason", () => {
    const reason = (p: Partial<CanonicalOrder>) => { try { cashToCollect(o(p)); return "ships"; } catch (e) { return (e as ShipBlockedError).reason; } };
    expect(reason({ paymentMode: "bank_transfer", paymentStatus: "unpaid" })).toBe("awaiting_payment");
    expect(reason({ paymentMode: "prepaid", paymentStatus: "failed" })).toBe("payment_failed");
    expect(reason({ paymentMode: "unknown" })).toBe("payment_mode_unknown");
    expect(reason({ paymentMode: "prepaid", paymentStatus: "refunded" })).toBe("refunded");
  });
});

describe("end to end by payment method", () => {
  it("COD: courier collects the total; delivery marks the order paid", async () => {
    const ctx = setup();
    const { tn } = await confirmedOrder(ctx, { payment: "cod" });
    expect(ctx.bosta.deliveries.get(tn!)!.cod).toBe(1150);
    await deliver(ctx, tn!);
    expect(marksPaid(ctx)).toBe(1);
  });

  it("card: ships with nothing to collect and is never marked paid again", async () => {
    const ctx = setup();
    const { tn, rec } = await confirmedOrder(ctx, { payment: "card" });
    expect(rec!.order.paymentMode).toBe("prepaid");
    expect(ctx.bosta.deliveries.get(tn!)!.cod).toBe(0);
    await deliver(ctx, tn!);
    expect(marksPaid(ctx)).toBe(0);
  });

  it("BNPL: ships with nothing to collect", async () => {
    const ctx = setup();
    const { tn, rec } = await confirmedOrder(ctx, { payment: "bnpl" });
    expect(rec!.order.paymentMode).toBe("bnpl");
    expect(ctx.bosta.deliveries.get(tn!)!.cod).toBe(0);
  });

  it("deposit + COD: courier collects only the balance; delivery completes payment", async () => {
    const ctx = setup();
    const { tn, rec } = await confirmedOrder(ctx, { payment: "deposit", total: "2100.00" });
    expect(rec!.order.paymentMode).toBe("partial");
    expect(ctx.bosta.deliveries.get(tn!)!.cod).toBe(1800);
    await deliver(ctx, tn!);
    expect(marksPaid(ctx)).toBe(1);
  });

  it("bank transfer: waits for payment, then ships automatically on the next update", async () => {
    const ctx = setup();
    const { order, tn } = await confirmedOrder(ctx, { payment: "bank" });
    expect(tn).toBeUndefined();
    expect(ctx.bosta.deliveries.size).toBe(0);
    expect(ctx.events.some((e) => e.event === "order.awaiting_payment" && e.data.reason === "awaiting_payment")).toBe(true);

    ctx.shop.paid(order.id);
    const wh = ctx.shop.webhook("orders/updated", ctx.shop.orders.get(order.id)!);
    await ctx.engine.handleShopifyWebhook(wh.headers, wh.body);
    await settle(ctx.engine, ctx.store, ctx.clock);
    const rec = await ctx.store.get<{ trackingNumber?: string }>("order", order.id);
    expect(rec?.trackingNumber).toBeTruthy();
    expect(ctx.bosta.deliveries.get(rec!.trackingNumber!)!.cod).toBe(0);
    expect(ctx.events.some((e) => e.event === "order.payment_changed" && e.data.from === "unpaid" && e.data.to === "paid")).toBe(true);
  });

  it("unknown method: never ships with a guessed amount", async () => {
    const ctx = setup();
    const { tn } = await confirmedOrder(ctx, { payment: "manual" });
    expect(tn).toBeUndefined();
    expect(ctx.events.some((e) => e.event === "order.awaiting_payment" && e.data.reason === "payment_mode_unknown")).toBe(true);
  });

  it("a forced ship of a blocked order dead-letters with the reason instead of shipping", async () => {
    const ctx = setup();
    const o = ctx.shop.addOrder({ payment: "bank" });
    await ctx.engine.shipOrder(o.id);
    await settle(ctx.engine, ctx.store, ctx.clock);
    expect(ctx.bosta.deliveries.size).toBe(0);
    const dead = await ctx.store.jobs({ status: "dead" });
    expect(dead[0].lastError).toMatch(/awaiting_payment/);
  });

  it("picks up a payment made in the same second as the order (no lost update)", async () => {
    const ctx = setup();
    const o = ctx.shop.addOrder({ payment: "bank", tags: ["mizan-confirmed"] });
    const t = ctx.clock.now();
    const created = ctx.shop.webhook("orders/create", o);
    await ctx.engine.handleShopifyWebhook(created.headers, created.body);
    await settle(ctx.engine, ctx.store, ctx.clock);
    ctx.clock.t = t; // same second
    ctx.shop.paid(o.id);
    ctx.shop.orders.get(o.id)!.updatedAt = o.createdAt;
    const updated = ctx.shop.webhook("orders/updated", ctx.shop.orders.get(o.id)!);
    await ctx.engine.handleShopifyWebhook(updated.headers, updated.body);
    await settle(ctx.engine, ctx.store, ctx.clock);
    expect((await ctx.store.get<{ trackingNumber?: string }>("order", o.id))?.trackingNumber).toBeTruthy();
  });

  it("the reconciliation poll catches a payment change even when updated_at did not move", async () => {
    const ctx = setup();
    const o = ctx.shop.addOrder({ payment: "bank", tags: ["mizan-confirmed"] });
    const created = ctx.shop.webhook("orders/create", o);
    await ctx.engine.handleShopifyWebhook(created.headers, created.body);
    await settle(ctx.engine, ctx.store, ctx.clock);
    ctx.shop.paid(o.id);
    ctx.shop.orders.get(o.id)!.updatedAt = o.createdAt; // webhook lost, timestamp unchanged
    ctx.clock.advance(6 * 60_000);
    await ctx.engine.scheduleReconcile();
    await settle(ctx.engine, ctx.store, ctx.clock);
    expect((await ctx.store.get<{ trackingNumber?: string }>("order", o.id))?.trackingNumber).toBeTruthy();
  });

  it("reports refunds made in Shopify", async () => {
    const ctx = setup();
    const { order } = await confirmedOrder(ctx, { payment: "card" });
    ctx.shop.refund(order.id, "1150.00");
    const wh = ctx.shop.webhook("orders/updated", ctx.shop.orders.get(order.id)!);
    await ctx.engine.handleShopifyWebhook(wh.headers, wh.body);
    await settle(ctx.engine, ctx.store, ctx.clock);
    expect(ctx.events.some((e) => e.event === "order.payment_changed" && e.data.to === "refunded" && e.data.refunded === "1150.00")).toBe(true);
  });

  it("falls back to an older query when the shop's API version lacks the money fields", async () => {
    const ctx = setup();
    for (const f of ["totalOutstandingSet", "totalReceivedSet", "totalRefundedSet"]) ctx.shop.dropPaths.add(f); // older version: fields absent
    ctx.shop.rejectFields.add("totalOutstandingSet");
    const { tn, rec } = await confirmedOrder(ctx, { payment: "cod" });
    expect(rec!.order.outstanding).toBeUndefined();
    expect(ctx.bosta.deliveries.get(tn!)!.cod).toBe(1150); // derived from total when outstanding is unknown
    expect(ctx.engine.drift.has((d) => d.entity === "MizanOrder" && /switching to variant 2/.test(d.detail))).toBe(true);
  });
});
