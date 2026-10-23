import { describe, expect, it } from "vitest";
import { MizanEngine, type OfferOutcome } from "../src/engine/engine.js";
import { settle, setup } from "./fakes/setup.js";

/**
 * E6-13: an accepted offer joins the customer's Shopify order through an order edit, exactly
 * once: a repeated job, a commit whose response was lost, and faults at every step never add
 * it twice; a sold-out item or a cancelled order is reported, not retried forever.
 */
function world(rate = 0) {
  const results = new Map<string, OfferOutcome>();
  const ctx = setup({ hooks: { onOfferResult: async (id, r) => { results.set(id, r); } } });
  ctx.shop.randomFaultRate = rate;
  const scarf = ctx.shop.addProduct({ title: "Matching scarf", price: "150.00", sku: "SC-1", stock: 50 });
  const job = (orderId: string, offerId: string, pct = "10") => ctx.store.enqueue(MizanEngine.shopifyOfferJob({ offerId, orderId, variantId: scarf.variantId, qty: 1, discountPct: pct, note: "Mizan: accepted offer" }), ctx.clock.now());
  const offerLines = (orderId: string) => ctx.shop.orders.get(orderId)!.lines.filter((l) => l.sku === "SC-1");
  return { ...ctx, scarf, results, job, offerLines };
}

describe("adding an accepted offer to the Shopify order (E6-13)", () => {
  it("adds the item at the offer's price, tags the order, and reads the order again", async () => {
    const w = world();
    const o = w.shop.addOrder({ total: "1250.00" });
    await w.job(o.id, "offer-1");
    await settle(w.engine, w.store, w.clock);
    expect(w.offerLines(o.id)).toEqual([expect.objectContaining({ quantity: 1, price: "135.00" })]);
    expect(w.shop.orders.get(o.id)!.total).toBe("1385.00");
    expect(w.shop.orders.get(o.id)!.tags).toContain("mizan-offer-offer-1");
    expect(w.results.get("offer-1")).toEqual({ ok: true, outcome: "added" });
    expect(w.events.some((e) => e.event === "order.ingested" || e.event === "order.updated" || e.event === "offer.applied")).toBe(true);
  });

  it("a repeated job, or the same offer again, adds nothing", async () => {
    const w = world();
    const o = w.shop.addOrder();
    await w.job(o.id, "offer-2");
    await settle(w.engine, w.store, w.clock);
    const r = await w.engine.shopify.addOfferToOrder({ orderId: o.id, variantId: w.scarf.variantId, qty: 1, discountPct: "10", marker: "offer-2", note: "x" });
    expect(r).toBe("already_added");
    expect(w.offerLines(o.id)).toHaveLength(1);
    expect(w.shop.committedEdits).toBe(1);
  });

  it("a commit whose response is lost is verified by reading the order, never committed twice", async () => {
    const w = world();
    const o = w.shop.addOrder();
    w.shop.faults.push({ op: "MizanOrderEditCommit", fault: "lost" });
    await w.job(o.id, "offer-3");
    await settle(w.engine, w.store, w.clock);
    expect(w.shop.committedEdits).toBe(1);
    expect(w.offerLines(o.id)).toHaveLength(1);
    expect(w.shop.orders.get(o.id)!.tags).toContain("mizan-offer-offer-3");
    expect(w.results.get("offer-3")).toEqual({ ok: true, outcome: "added" });
  });

  it("the tag lost after a commit: the line already there counts as added", async () => {
    const w = world();
    const o = w.shop.addOrder();
    w.shop.faults.push({ op: "MizanTagsAdd", fault: "500" }, { op: "MizanTagsAdd", fault: "500" }, { op: "MizanTagsAdd", fault: "500" }, { op: "MizanTagsAdd", fault: "500" }, { op: "MizanTagsAdd", fault: "500" });
    await w.job(o.id, "offer-4");
    await settle(w.engine, w.store, w.clock);
    expect(w.shop.committedEdits).toBe(1);
    expect(w.offerLines(o.id)).toHaveLength(1);
    expect(w.results.get("offer-4")?.ok).toBe(true);
  });

  it("a sold-out item or a cancelled order is reported once, not retried", async () => {
    const w = world();
    const soldOut = w.shop.addProduct({ title: "Gone", price: "99.00", sku: "GONE", stock: 0 });
    const o = w.shop.addOrder();
    await w.store.enqueue(MizanEngine.shopifyOfferJob({ offerId: "offer-5", orderId: o.id, variantId: soldOut.variantId, qty: 1, discountPct: "0", note: "x" }), w.clock.now());
    const c = w.shop.addOrder();
    w.shop.orders.get(c.id)!.cancelledAt = new Date(w.clock.now()).toISOString();
    await w.job(c.id, "offer-6");
    await settle(w.engine, w.store, w.clock);
    expect(w.results.get("offer-5")).toMatchObject({ ok: false, reason: "validation" });
    expect(w.results.get("offer-6")).toMatchObject({ ok: false, reason: "validation" });
    expect(w.shop.committedEdits).toBe(0);
    expect(await w.store.jobs({ status: "dead" })).toHaveLength(0);
  });

  it.each([0.1, 0.25, 0.5])("10 offers with %s of calls failing and lost commits: each added exactly once, nothing dead", async (rate) => {
    const w = world(rate);
    const orders = Array.from({ length: 10 }, () => w.shop.addOrder({ total: "1000.00" }));
    for (let i = 0; i < 4; i++) w.shop.faults.push({ op: "MizanOrderEditCommit", fault: "lost" });
    for (const [i, o] of orders.entries()) await w.job(o.id, `chaos-${i}`);
    await settle(w.engine, w.store, w.clock, 400);
    for (const [i, o] of orders.entries()) {
      expect(w.offerLines(o.id), o.id).toHaveLength(1);
      expect(w.shop.orders.get(o.id)!.total).toBe("1135.00");
      expect(w.results.get(`chaos-${i}`)?.ok).toBe(true);
    }
    expect(await w.store.jobs({ status: "dead" })).toHaveLength(0);
  });
});
