import { describe, expect, it } from "vitest";
import type { CanonicalOrder } from "@mizan/shared";
import { MizanEngine, type ShipOutcome } from "../src/engine/engine.js";
import { settle, setup } from "./fakes/setup.js";

/**
 * E7-1: the platform ships its own orders (a store's or one the team typed). The courier collects
 * cashToCollect(order); a booking whose answer is lost is found by its reference, never made
 * twice; refusals (city, payment, cancelled) are reported once and not retried.
 */
function order(id: string, over: Partial<CanonicalOrder> = {}): CanonicalOrder {
  const at = "2026-10-27T09:00:00.000Z";
  const egp = (amount: string) => ({ amount, currency: "EGP" });
  return {
    connector: "manual", externalId: id, number: `#M${id}`, createdAt: at, updatedAt: at, currency: "EGP",
    total: egp("1250.00"), subtotal: egp("1250.00"), shipping: egp("0.00"), paymentMode: "cod", paymentStatus: "unpaid", gateways: ["Cash on Delivery (COD)"],
    received: egp("0.00"), outstanding: egp("1250.00"), refunded: egp("0.00"), cancelled: false, tags: [],
    customer: { name: "Mona Adel", phone: "01001234821" },
    shippingAddress: { name: "Mona Adel", line1: "12 Abbas El Akkad St", city: "Cairo", phone: "01001234821", countryCode: "EG" },
    lines: [{ externalLineId: "L1", title: "Abaya", quantity: 2, unitPrice: egp("625.00") }],
    ...over,
  } as CanonicalOrder;
}

function world(rate = 0) {
  const orders = new Map<string, CanonicalOrder>();
  const results = new Map<string, ShipOutcome[]>();
  const ctx = setup({ hooks: {
    loadOrder: async (id) => orders.get(id),
    onShipment: async (shipmentId, r) => { results.set(shipmentId, [...(results.get(shipmentId) ?? []), r]); },
  } });
  ctx.bosta.randomFaultRate = rate;
  const ship = (shipmentId: string, orderId: string, storeOrderId?: string) =>
    ctx.store.enqueue(MizanEngine.bostaShipJob({ shipmentId, orderId, ...(storeOrderId ? { storeOrderId } : {}) }), ctx.clock.now());
  return { ...ctx, orders, results, ship };
}

describe("shipping a Mizan order (E7-1)", () => {
  it("books once with the cash still owed, and reports the tracking number", async () => {
    const w = world();
    w.orders.set("o1", order("o1", { paymentMode: "partial", paymentStatus: "partially_paid", received: { amount: "250.00", currency: "EGP" }, outstanding: { amount: "1000.00", currency: "EGP" } }));
    await w.ship("s1", "o1");
    await w.ship("s1", "o1"); // the same job again: one booking
    await settle(w.engine, w.store, w.clock);
    expect(w.bosta.deliveries.size).toBe(1);
    const d = [...w.bosta.deliveries.values()][0]!;
    expect(d).toMatchObject({ businessReference: "s1", cod: 1000 });
    const [r] = w.results.get("s1")!;
    expect(r).toMatchObject({ ok: true, adopted: false, shipment: { trackingNumber: d.trackingNumber, status: "pickup_requested", cod: { amount: "1000" } } });
    expect(w.results.get("s1")).toHaveLength(1);
    expect(w.events.find((e) => e.event === "shipment.created")?.data).toMatchObject({ shipmentId: "s1", orderId: "o1", trackingNumber: d.trackingNumber });
  });

  it("a prepaid order ships with nothing to collect; an unpaid transfer is blocked, not booked", async () => {
    const w = world();
    w.orders.set("paid", order("paid", { paymentMode: "prepaid", paymentStatus: "paid", received: { amount: "1250.00", currency: "EGP" }, outstanding: { amount: "0.00", currency: "EGP" } }));
    w.orders.set("transfer", order("transfer", { paymentMode: "bank_transfer", paymentStatus: "unpaid" }));
    await w.ship("s-paid", "paid");
    await w.ship("s-transfer", "transfer");
    await settle(w.engine, w.store, w.clock);
    expect([...w.bosta.deliveries.values()].map((d) => [d.businessReference, d.cod])).toEqual([["s-paid", 0]]);
    expect(w.results.get("s-transfer")).toEqual([expect.objectContaining({ ok: false, reason: "blocked", blockReason: "awaiting_payment" })]);
    expect(await w.store.jobs({ status: "dead" })).toHaveLength(0);
  });

  it("a city the courier doesn't know, a cancelled order and a missing one are reported once", async () => {
    const w = world();
    w.orders.set("far", order("far", { shippingAddress: { name: "Mona", line1: "Main St", city: "Atlantis", phone: "01001234821", countryCode: "EG" } }));
    w.orders.set("gone", order("gone", { cancelled: true }));
    await w.ship("s-far", "far");
    await w.ship("s-gone", "gone");
    await w.ship("s-none", "none");
    await settle(w.engine, w.store, w.clock);
    expect(w.bosta.deliveries.size).toBe(0);
    expect(w.results.get("s-far")).toEqual([expect.objectContaining({ ok: false, reason: "validation", message: expect.stringContaining("Atlantis"), details: expect.objectContaining({ city: "Atlantis" }) })]);
    expect(w.results.get("s-gone")).toEqual([expect.objectContaining({ ok: false, reason: "validation", details: { cancelled: true } })]);
    expect(w.results.get("s-none")).toEqual([expect.objectContaining({ ok: false, reason: "not_found" })]);
  });

  it("a booking whose answer was lost is found by its reference and adopted", async () => {
    const w = world();
    w.orders.set("o1", order("o1"));
    w.bosta.loseNextCreateResponses = 1;
    await w.ship("s1", "o1");
    await settle(w.engine, w.store, w.clock);
    expect(w.bosta.deliveries.size).toBe(1);
    expect(w.bosta.count("POST", "deliveries")).toBe(1);
    expect(w.results.get("s1")).toEqual([expect.objectContaining({ ok: true, adopted: true })]);
  });

  it("a store's order is fulfilled in Shopify with the tracking number", async () => {
    const w = world();
    const o = w.shop.addOrder();
    w.orders.set("o-shop", order("o-shop"));
    await w.ship("s-shop", "o-shop", o.id);
    await settle(w.engine, w.store, w.clock);
    const tn = [...w.bosta.deliveries.keys()][0]!;
    expect(w.shop.orders.get(o.id)!.fulfillments[0]!.trackingInfo[0]).toMatchObject({ number: tn });
  });

  it.each([0.1, 0.25, 0.5])("10 orders with %s of courier calls failing: each booked exactly once, nothing dead", async (rate) => {
    const w = world(rate);
    for (let i = 0; i < 10; i++) w.orders.set(`o${i}`, order(`o${i}`));
    w.bosta.loseNextCreateResponses = 3;
    for (let i = 0; i < 10; i++) await w.ship(`s${i}`, `o${i}`);
    await settle(w.engine, w.store, w.clock, 400);
    const refs = [...w.bosta.deliveries.values()].map((d) => d.businessReference).sort();
    expect(refs).toEqual(Array.from({ length: 10 }, (_, i) => `s${i}`).sort());
    for (let i = 0; i < 10; i++) expect(w.results.get(`s${i}`)?.[0]?.ok, `s${i}`).toBe(true);
    expect(await w.store.jobs({ status: "dead" })).toHaveLength(0);
  });
});
