import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { SqlStore } from "../src/sync/sql-store.js";
import { settle, setup } from "./fakes/setup.js";

describe("PostgreSQL store (PGlite)", () => {
  it("dedupes inbound events and jobs, leases, retries, buries and replays", async () => {
    const db = new PGlite();
    const s = new SqlStore(db);
    await s.migrate();

    expect(await s.markInbound("evt-1", 1)).toBe(true);
    expect(await s.markInbound("evt-1", 2)).toBe(false);

    const a = await s.enqueue({ kind: "k", connection: "c", payload: { n: 1 }, idempotencyKey: "same" }, 100);
    const b = await s.enqueue({ kind: "k", connection: "c", payload: { n: 2 }, idempotencyKey: "same" }, 101);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);

    const [claimed] = await s.claimDue(100, 10, 1_000);
    expect(claimed.attempts).toBe(1);
    expect(await s.claimDue(500, 10, 1_000)).toHaveLength(0); // leased
    expect(await s.claimDue(1_200, 10, 1_000)).toHaveLength(1); // lease expired: worker crashed, job re-claimed

    await s.retryLater(a.job.id, "transient", 5_000, 1_300);
    expect(await s.claimDue(4_999, 10, 1_000)).toHaveLength(0);
    const [again] = await s.claimDue(5_000, 10, 1_000);
    await s.bury(again.id, "validation: bad city", 5_001);
    expect((await s.jobs({ status: "dead" }))[0].lastError).toBe("validation: bad city");
    expect(await s.replay(again.id, 6_000)).toBe(true);
    expect((await s.jobs({ status: "pending" }))).toHaveLength(1);

    await s.put("order", "o1", { a: 1 }, 1);
    await s.put("order", "o1", { a: 2 }, 2);
    expect(await s.get("order", "o1")).toEqual({ a: 2 });
    expect(await s.list("order")).toEqual([{ key: "o1", value: { a: 2 } }]);
  });

  it("runs the full Shopify → Bosta flow on PostgreSQL and survives a restart", async () => {
    const db = new PGlite();
    const store = new SqlStore(db);
    await store.migrate();
    const ctx = setup({}, store);
    const o = ctx.shop.addOrder({ tags: ["mizan-confirmed"] });
    const wh = ctx.shop.webhook("orders/create", o);
    await ctx.engine.handleShopifyWebhook(wh.headers, wh.body);
    ctx.bosta.faults.push({ path: "deliveries", fault: "500" });
    await ctx.engine.drain(); // ingest runs; create hits a 503 → scheduled for later

    // "Restart": a brand-new store object on the same database picks the work up.
    const restarted = new SqlStore(db);
    const ctx2 = setup({}, restarted);
    Object.assign(ctx2.shop, { orders: ctx.shop.orders, products: ctx.shop.products });
    Object.assign(ctx2.bosta, { deliveries: ctx.bosta.deliveries });
    ctx2.clock.t = ctx.clock.t;
    await settle(ctx2.engine, restarted, ctx2.clock);
    expect(ctx.bosta.deliveries.size).toBe(1);
    expect(ctx.shop.orders.get(o.id)!.fulfillments).toHaveLength(1);
  });
});
