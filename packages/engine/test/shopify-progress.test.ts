import { describe, expect, it } from "vitest";
import { fulfillmentEventFor } from "../src/engine/progress.js";
import { settle, setup } from "./fakes/setup.js";

/**
 * E7-7: courier progress reaches the store's order as Shopify fulfillment events, each once,
 * at the time the courier reported it; refusals and lost parcels show as failures; per-store
 * switches turn events and tags off.
 */
async function shippedOrder(overrides: Parameters<typeof setup>[0] = {}) {
  const ctx = setup(overrides);
  const o = ctx.shop.addOrder({ tags: ["mizan-confirmed"], payment: "cod", city: "Nasr City", province: "Cairo", total: "750.00" });
  const wh = ctx.shop.webhook("orders/create", o);
  await ctx.engine.handleShopifyWebhook(wh.headers, wh.body);
  await settle(ctx.engine, ctx.store, ctx.clock);
  const d = [...ctx.bosta.deliveries.values()].find((x) => x.businessReference === o.id)!;
  const step = async (code: number, label: string, times = 1) => {
    ctx.clock.advance(60_000);
    ctx.bosta.setState(d.trackingNumber, code, label);
    const body = ctx.bosta.webhook(d.trackingNumber, { withLabel: true });
    for (let i = 0; i < times; i++) await ctx.engine.handleBostaWebhook({ token: "whsec-bosta" }, {}, body);
    await settle(ctx.engine, ctx.store, ctx.clock);
    return new Date(ctx.clock.now()).toISOString();
  };
  const events = () => (ctx.shop.orders.get(o.id)!.fulfillments[0]!.events ?? []).map((e) => e.status);
  return { ...ctx, order: o, tn: d.trackingNumber, step, events };
}

describe("courier progress → Shopify (E7-7)", () => {
  it("maps statuses to Shopify's fulfillment events", () => {
    expect(fulfillmentEventFor("picked_up")).toEqual({ status: "CARRIER_PICKED_UP" });
    expect(fulfillmentEventFor("failed_attempt")).toEqual({ status: "ATTEMPTED_DELIVERY" });
    expect(fulfillmentEventFor("lost")).toMatchObject({ status: "FAILURE", message: expect.stringMatching(/lost/i) });
    for (const s of ["created", "pickup_requested", "cancelled", "unknown", "returned"] as const) expect(fulfillmentEventFor(s)).toBeNull();
  });

  it("each step once, at the courier's time, even with duplicate webhooks", async () => {
    const c = await shippedOrder();
    await c.step(21, "Picked up", 2);
    await c.step(24, "In transit");
    const failedAt = await c.step(30, "Customer not available");
    await c.step(41, "Out for delivery", 3);
    await c.step(45, "Delivered", 2);
    expect(c.events()).toEqual(["CARRIER_PICKED_UP", "IN_TRANSIT", "ATTEMPTED_DELIVERY", "OUT_FOR_DELIVERY", "DELIVERED"]);
    const attempt = c.shop.orders.get(c.order.id)!.fulfillments[0]!.events!.find((e) => e.status === "ATTEMPTED_DELIVERY")!;
    expect(attempt.happenedAt).toBe(failedAt);
    expect(c.shop.orders.get(c.order.id)!.displayFinancialStatus).toBe("PAID"); // still marked paid on delivery (COD)
    expect(await c.store.jobs({ status: "dead" })).toEqual([]);
  });

  it("a lost response is verified, never sent twice", async () => {
    const c = await shippedOrder();
    c.shop.faults.push({ op: "MizanFulfillmentEventCreate", fault: "lost" });
    await c.step(21, "Picked up");
    expect(c.events()).toEqual(["CARRIER_PICKED_UP"]);
    expect(c.shop.calls.filter((x) => x.op === "MizanFulfillmentEventCreate")).toHaveLength(1);
  });

  it("an API version without CARRIER_PICKED_UP gets IN_TRANSIT, recorded as drift", async () => {
    const c = await shippedOrder();
    c.shop.eventStatuses.delete("CARRIER_PICKED_UP");
    await c.step(21, "Picked up");
    expect(c.events()).toEqual(["IN_TRANSIT"]);
    expect(c.engine.drift.report().some((d) => d.entity === "fulfillmentEvent" && d.kind === "fallback_field")).toBe(true);
  });

  it("refused and lost parcels show as failures; returned and lost orders are tagged", async () => {
    const back = await shippedOrder();
    await back.step(24, "In transit");
    await back.step(30, "Customer refused");
    await back.step(60, "Returning to business");
    await back.step(46, "Returned to business");
    expect(back.events()).toEqual(["IN_TRANSIT", "ATTEMPTED_DELIVERY", "FAILURE"]);
    expect(back.shop.orders.get(back.order.id)!.tags).toContain("mizan-returned");

    const lost = await shippedOrder();
    await lost.step(24, "In transit");
    await lost.step(47, "Lost");
    expect(lost.events()).toEqual(["IN_TRANSIT", "FAILURE"]);
    expect(lost.shop.orders.get(lost.order.id)!.fulfillments[0]!.events!.at(-1)!.message).toMatch(/lost/i);
    expect(lost.shop.orders.get(lost.order.id)!.tags).toContain("mizan-lost");
  });

  it("per-store switches: no events, no tags, no mark-paid", async () => {
    const c = await shippedOrder({ fulfillmentEvents: false, tagOnReturn: null, tagOnLost: null, markCodPaidOnDelivery: false });
    await c.step(24, "In transit");
    await c.step(45, "Delivered");
    expect(c.events()).toEqual([]);
    expect(c.shop.orders.get(c.order.id)!.displayFinancialStatus).not.toBe("PAID");
    expect(c.shop.calls.some((x) => x.op === "MizanFulfillmentEventCreate" || x.op === "MizanOrderMarkPaid")).toBe(false);
  });
});
