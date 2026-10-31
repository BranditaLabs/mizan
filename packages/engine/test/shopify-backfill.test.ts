import { describe, expect, it } from "vitest";
import { MizanEngine } from "../src/engine/engine.js";
import { MemoryStore } from "../src/sync/store.js";
import { settle, setup } from "./fakes/setup.js";

const DAY = 86_400_000;

describe("Shopify backfill on connect", () => {
  it("imports 60 days of orders, then all products, page by page, through outages", async () => {
    const store = new MemoryStore();
    const ingested: string[] = [];
    const { engine, shop, clock, events } = setup({ hooks: { onOrder: async (o) => { ingested.push(o.number); } } }, store);
    const old = shop.addOrder({ name: "#OLD", createdAt: new Date(clock.now() - 90 * DAY).toISOString() });
    for (let i = 0; i < 120; i++) shop.addOrder({ name: `#N${i}` });
    for (let i = 0; i < 60; i++) shop.addProduct({ title: `P${i}`, price: "100.00", sku: `SKU-${i}` });
    shop.faults.push({ op: "MizanOrders", fault: "500" }, { op: "MizanProducts", fault: "timeout" }, { op: "MizanOrders", fault: "throttle" });

    const job = MizanEngine.shopifyBackfillJob("connect-1", clock.now() - 60 * DAY, clock.now());
    await store.enqueue(job, clock.now());
    await store.enqueue(job, clock.now()); // same connect: one run
    await settle(engine, store, clock);

    expect(new Set(ingested).size).toBe(120);
    expect(ingested).not.toContain("#OLD");
    expect(await store.get("order", old.id)).toBeUndefined();
    expect(await engine.backfillStatus()).toMatchObject({ runKey: "connect-1", status: "done", phase: "done", orders: 120, products: 60, pages: 3 + 2 });
    expect(events.filter((e) => e.event === "backfill.completed")).toHaveLength(1);
    expect((await store.jobs({ status: "dead" }))).toEqual([]);
  });

  it("a reconnect supersedes a run still in progress", async () => {
    const store = new MemoryStore();
    const { engine, shop, clock } = setup({}, store);
    for (let i = 0; i < 120; i++) shop.addOrder({ name: `#N${i}` });
    await store.enqueue(MizanEngine.shopifyBackfillJob("connect-1", clock.now() - 60 * DAY, clock.now()), clock.now());
    await engine.drain(1); // first page of the old run only
    clock.advance(1000);
    await store.enqueue(MizanEngine.shopifyBackfillJob("connect-2", clock.now() - 60 * DAY, clock.now()), clock.now());
    await settle(engine, store, clock);
    expect(await engine.backfillStatus()).toMatchObject({ runKey: "connect-2", status: "done", orders: 120 });
  });

  it("two connects queued at the same moment end with one complete run", async () => {
    const store = new MemoryStore();
    const { engine, shop, clock } = setup({}, store);
    for (let i = 0; i < 70; i++) shop.addOrder({ name: `#N${i}` });
    for (const key of ["connect-a", "connect-b"]) await store.enqueue(MizanEngine.shopifyBackfillJob(key, clock.now() - 60 * DAY, clock.now()), clock.now());
    await settle(engine, store, clock);
    expect(await engine.backfillStatus()).toMatchObject({ runKey: "connect-b", status: "done", orders: 70 });
  });
});
