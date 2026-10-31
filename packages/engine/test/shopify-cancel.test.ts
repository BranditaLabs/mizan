import { describe, expect, it } from "vitest";
import { MizanEngine, type CancelOutcome } from "../src/engine/engine.js";
import { settle, setup } from "./fakes/setup.js";

/**
 * E5-4: cancelling the store's order (bulk cancel, a merged duplicate) happens once: a repeated
 * job, a cancel whose response was lost, and faults on every call never cancel twice or refund;
 * an order the store does not have is reported, not retried forever.
 */
function world(rate = 0) {
  const results = new Map<string, CancelOutcome>();
  const ctx = setup({ hooks: { onCancelResult: async (id, r) => { results.set(id, r); } } });
  ctx.shop.randomFaultRate = rate;
  const job = (orderId: string) => ctx.store.enqueue(MizanEngine.shopifyCancelJob({ orderId, reason: "CUSTOMER", note: "Mizan: cancelled by the team" }), ctx.clock.now());
  return { ...ctx, results, job };
}

describe("cancelling the Shopify order (E5-4)", () => {
  it("cancels without refunding or emailing, then reads the order again", async () => {
    const w = world();
    const o = w.shop.addOrder();
    await w.job(o.id);
    await settle(w.engine, w.store, w.clock);
    expect(w.shop.orders.get(o.id)!.cancelledAt).not.toBeNull();
    expect(w.shop.cancels).toBe(1);
    const call = w.shop.calls.find((c) => c.op === "MizanOrderCancel")!;
    expect(call.variables).toMatchObject({ orderId: o.id, reason: "CUSTOMER", staffNote: "Mizan: cancelled by the team" });
    expect(w.results.get(o.id)).toEqual({ ok: true, outcome: "cancelled" });
    expect(w.events.some((e) => e.event === "order.cancelled_in_store")).toBe(true);
  });

  it("an order already cancelled (in Shopify, or by a repeated job) is left alone", async () => {
    const w = world();
    const o = w.shop.addOrder();
    w.shop.orders.get(o.id)!.cancelledAt = new Date(w.clock.now()).toISOString();
    await w.job(o.id);
    await settle(w.engine, w.store, w.clock);
    expect(w.shop.count("MizanOrderCancel")).toBe(0);
    expect(w.results.get(o.id)).toEqual({ ok: true, outcome: "already_cancelled" });
    expect(await w.engine.shopify.cancelOrder({ orderId: o.id, reason: "STAFF" })).toBe("already_cancelled");
  });

  it("a cancel whose response is lost is verified by reading the order, never sent twice", async () => {
    const w = world();
    const o = w.shop.addOrder();
    w.shop.faults.push({ op: "MizanOrderCancel", fault: "lost" });
    await w.job(o.id);
    await settle(w.engine, w.store, w.clock);
    expect(w.shop.cancels).toBe(1);
    expect(w.shop.count("MizanOrderCancel")).toBe(1);
    expect(w.results.get(o.id)).toEqual({ ok: true, outcome: "cancelled" });
  });

  it("an order the store does not have is reported once, not retried", async () => {
    const w = world();
    await w.job("gid://shopify/Order/404404");
    await settle(w.engine, w.store, w.clock);
    expect(w.results.get("gid://shopify/Order/404404")).toMatchObject({ ok: false, reason: "not_found" });
    expect(await w.store.jobs({ status: "dead" })).toHaveLength(0);
  });

  it.each([0.1, 0.25, 0.5])("10 orders with %s of calls failing and lost responses: each cancelled exactly once, nothing dead", async (rate) => {
    const w = world(rate);
    const orders = Array.from({ length: 10 }, () => w.shop.addOrder());
    for (let i = 0; i < 4; i++) w.shop.faults.push({ op: "MizanOrderCancel", fault: "lost" });
    for (const o of orders) await w.job(o.id);
    await settle(w.engine, w.store, w.clock, 400);
    for (const o of orders) {
      expect(w.shop.orders.get(o.id)!.cancelledAt, o.id).not.toBeNull();
      expect(w.results.get(o.id)?.ok).toBe(true);
    }
    expect(w.shop.cancels).toBe(10);
    expect(await w.store.jobs({ status: "dead" })).toHaveLength(0);
  });
});
