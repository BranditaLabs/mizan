import { describe, expect, it } from "vitest";
import { MizanEngine } from "../src/engine/engine.js";
import { settle, setup } from "./fakes/setup.js";

/**
 * O2: the team's tags reach the Shopify order, and a tag taken off in Mizan comes off there too.
 * Both are outbox jobs; tagsAdd and tagsRemove are idempotent, so faults and repeats change nothing.
 */
describe("order tags in Shopify (O2)", () => {
  it("adds and removes tags through the outbox; the store's own tags stay", async () => {
    const w = setup();
    const o = w.shop.addOrder({ tags: ["wholesale"] });
    await w.store.enqueue(MizanEngine.shopifyTagJob(o.id, ["vip", "gift"], "op-1"), w.clock.now());
    await settle(w.engine, w.store, w.clock);
    expect(w.shop.orders.get(o.id)!.tags).toEqual(["wholesale", "vip", "gift"]);

    await w.store.enqueue(MizanEngine.shopifyUntagJob(o.id, ["gift"], "op-2"), w.clock.now());
    await settle(w.engine, w.store, w.clock);
    expect(w.shop.orders.get(o.id)!.tags).toEqual(["wholesale", "vip"]);
  });

  it("with faults on every call, each change lands once and removing a tag twice is a no-op", async () => {
    const w = setup();
    w.shop.randomFaultRate = 0.4;
    const o = w.shop.addOrder();
    await w.store.enqueue(MizanEngine.shopifyTagJob(o.id, ["vip"], "op-1"), w.clock.now());
    await settle(w.engine, w.store, w.clock);
    await w.store.enqueue(MizanEngine.shopifyUntagJob(o.id, ["vip"], "op-2"), w.clock.now());
    await w.store.enqueue(MizanEngine.shopifyUntagJob(o.id, ["vip"], "op-3"), w.clock.now());
    await settle(w.engine, w.store, w.clock);
    expect(w.shop.orders.get(o.id)!.tags).toEqual([]);
    expect(w.shop.count("MizanTagsRemove")).toBeGreaterThanOrEqual(2);
  });
});
