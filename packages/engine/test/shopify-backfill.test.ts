import { describe, expect, it } from "vitest";
import { MizanEngine, type BackfillProgress } from "../src/engine/engine.js";
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

  it("A2: a store that cuts Mizan off midway ends the import as failed, with why, and reports the store", async () => {
    const store = new MemoryStore();
    const runs: BackfillProgress[] = [];
    const access: Array<[string, boolean]> = [];
    const { engine, shop, clock, events } = setup({
      hooks: { onBackfill: async (p) => { runs.push(p); }, onAccessChecked: async (provider, r) => { access.push([provider, r.ok]); } },
    }, store);
    for (let i = 0; i < 120; i++) shop.addOrder({ name: `#N${i}` });
    await store.enqueue(MizanEngine.shopifyBackfillJob("connect-1", clock.now() - 60 * DAY, clock.now()), clock.now());
    await engine.drain(1);
    shop.uninstall(); // tokens revoked: Shopify answers 401 from here on
    await settle(engine, store, clock);
    await new Promise((r) => setTimeout(r, 0)); // the dead-letter handler records after the job

    const status = await engine.backfillStatus();
    expect(status).toMatchObject({ runKey: "connect-1", connector: "shopify", status: "failed", orders: 50, error: { kind: "auth" } });
    expect(status!.finishedAt).toEqual(expect.any(String));
    expect(runs.map((r) => r.status)).toEqual(["failed"]);
    expect(access).toContainEqual(["shopify", false]);
    expect(events.filter((e) => e.event === "backfill.failed")).toHaveLength(1);
  });

  it("A2: a finished import is reported once", async () => {
    const store = new MemoryStore();
    const runs: BackfillProgress[] = [];
    const { engine, shop, clock } = setup({ hooks: { onBackfill: async (p) => { runs.push(p); } } }, store);
    for (let i = 0; i < 10; i++) shop.addOrder({ name: `#N${i}` });
    await store.enqueue(MizanEngine.shopifyBackfillJob("connect-1", clock.now() - 60 * DAY, clock.now()), clock.now());
    await settle(engine, store, clock);
    expect(runs.map((r) => [r.status, r.orders])).toEqual([["done", 10]]);
  });

  it("A2: a retry refused on its first page replaces the last finished run's record with the failure", async () => {
    const store = new MemoryStore();
    const { engine, shop, clock } = setup({}, store);
    for (let i = 0; i < 5; i++) shop.addOrder({ name: `#N${i}` });
    await store.enqueue(MizanEngine.shopifyBackfillJob("connect-1", clock.now() - 60 * DAY, clock.now()), clock.now());
    await settle(engine, store, clock);
    shop.uninstall();
    clock.advance(1000);
    await store.enqueue(MizanEngine.shopifyBackfillJob("retry-1", clock.now() - 60 * DAY, clock.now()), clock.now());
    await settle(engine, store, clock);
    await new Promise((r) => setTimeout(r, 0));
    expect(await engine.backfillStatus()).toMatchObject({ runKey: "retry-1", status: "failed", orders: 0, error: { kind: "auth" } });
  });
});
