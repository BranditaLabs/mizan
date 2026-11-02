import { createPglite, createPgliteDb, migrate, pgliteMigrationClient, tenantQueryClient } from "@mizan/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SqlStore } from "../src/sync/sql-store.js";
import { settle, setup } from "./fakes/setup.js";

/**
 * The engine on the platform schema (packages/db migrations, RLS on), two
 * tenants at once. Their fake Shopify stores hand out the *same* order ids,
 * so any key that is not tenant-scoped would collide.
 */
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

const pglite = await createPglite();
const db = createPgliteDb(pglite);
const conn: Record<string, string> = {};

beforeAll(async () => {
  await migrate(pgliteMigrationClient(pglite));
  await db.insertInto("tenants").values([{ id: A, name: "A", slug: "a" }, { id: B, name: "B", slug: "b" }]).execute();
  for (const [t, label] of [[A, "a"], [B, "b"], [A, "a2"], [A, "a3"]] as const) {
    for (const provider of ["shopify", "bosta"] as const) {
      const row = await db.insertInto("connections").values({
        tenant_id: t, kind: provider === "shopify" ? "store" : "courier", provider, external_account: `${label}-${provider}`,
      }).returning("id").executeTakeFirstOrThrow();
      conn[`${label}:${provider}`] = row.id;
    }
  }
});
afterAll(() => pglite.close());

const storeFor = (tenantId: string, label: string) =>
  new SqlStore(tenantQueryClient(db, tenantId), { tenantId, connections: { shopify: conn[`${label}:shopify`]!, bosta: conn[`${label}:bosta`]! } });

describe("engine on the platform schema", () => {
  it("two tenants with identical Shopify order ids sync independently, each exactly once", async () => {
    const a = setup({}, storeFor(A, "a"));
    const b = setup({}, storeFor(B, "b"));
    const oa = a.shop.addOrder({ tags: ["mizan-confirmed"] });
    const ob = b.shop.addOrder({ tags: ["mizan-confirmed"] });
    expect(oa.id).toBe(ob.id); // same external id in both stores

    for (const ctx of [a, b]) {
      const o = [...ctx.shop.orders.values()][0]!;
      const wh = ctx.shop.webhook("orders/create", o);
      // The same webhook delivered three times: one ingest per tenant.
      for (let i = 0; i < 3; i++) await ctx.engine.handleShopifyWebhook(wh.headers, wh.body);
    }
    await settle(a.engine, a.store, a.clock);
    await settle(b.engine, b.store, b.clock);

    for (const ctx of [a, b]) {
      expect(ctx.bosta.deliveries.size).toBe(1);
      expect([...ctx.shop.orders.values()][0]!.fulfillments).toHaveLength(1);
      expect(await ctx.store.jobs({ status: "dead" })).toEqual([]);
    }
  });

  it("jobs carry tenant and connection; each tenant's client sees only its own rows (RLS)", async () => {
    const rowsA = await tenantQueryClient(db, A).query<{ tenant_id: string; connection: string; connection_id: string }>(
      "SELECT tenant_id, connection, connection_id FROM mz_outbox");
    expect(rowsA.rows.length).toBeGreaterThan(0);
    for (const r of rowsA.rows) {
      expect(r.tenant_id).toBe(A);
      expect(r.connection_id).toBe(conn[`a:${r.connection}`]);
    }
    const recordsB = await tenantQueryClient(db, B).query<{ tenant_id: string }>("SELECT DISTINCT tenant_id FROM mz_records");
    expect(recordsB.rows).toEqual([{ tenant_id: B }]);

    // A store scoped to A, even handed B's job id, cannot touch B's jobs.
    const bJob = (await tenantQueryClient(db, B).query<{ id: string }>("SELECT id FROM mz_outbox LIMIT 1")).rows[0]!;
    expect(await storeFor(A, "a").replay(bJob.id, Date.now())).toBe(false);

    // And a store that lies about its tenant is stopped by RLS.
    const liar = new SqlStore(tenantQueryClient(db, A), { tenantId: B });
    await expect(liar.put("order", "x", {}, 1)).rejects.toThrow(/row-level security/);
  });

  it("webhook dedupe keys are per tenant", async () => {
    expect(await storeFor(A, "a").markInbound("shopify:evt-1", 1)).toBe(true);
    expect(await storeFor(B, "b").markInbound("shopify:evt-1", 1)).toBe(true);
    expect(await storeFor(A, "a").markInbound("shopify:evt-1", 2)).toBe(false);
  });

  it("two stores of one tenant: same order ids, separate records, cursors, dedupe keys and jobs (E2-7)", async () => {
    // Two fresh stores (store "a" already synced order 1 above).
    const one = setup({}, storeFor(A, "a2"));
    const two = setup({}, storeFor(A, "a3"));
    // Fresh fakes hand out ids from 1 again: the second store's order has the first store's id.
    const o1 = one.shop.addOrder({ tags: ["mizan-confirmed"] });
    const o2 = two.shop.addOrder({ tags: ["mizan-confirmed"] });
    expect(o1.id).toBe(o2.id);
    for (const ctx of [one, two]) {
      const o = [...ctx.shop.orders.values()].at(-1)!;
      const wh = ctx.shop.webhook("orders/create", o, "evt-same-id");
      await ctx.engine.handleShopifyWebhook(wh.headers, wh.body);
    }
    await settle(one.engine, one.store, one.clock);
    await settle(two.engine, two.store, two.clock);
    for (const ctx of [one, two]) {
      expect([...ctx.shop.orders.values()].at(-1)!.fulfillments).toHaveLength(1);
      expect(await ctx.store.jobs({ status: "dead" })).toEqual([]);
    }
    // Each store's engine sees only its own jobs and records.
    const scopes = await tenantQueryClient(db, A).query<{ scope: string; n: string }>("SELECT scope, count(*)::text AS n FROM mz_outbox GROUP BY scope ORDER BY scope");
    expect(scopes.rows.map((r) => r.scope).sort()).toEqual([conn["a:shopify"], conn["a2:shopify"], conn["a3:shopify"]].sort());
    await storeFor(A, "a").put("cursor", "orders", { at: 1 }, 1);
    await storeFor(A, "a2").put("cursor", "orders", { at: 2 }, 1);
    expect(await storeFor(A, "a").get("cursor", "orders")).toEqual({ at: 1 });
    expect(await storeFor(A, "a2").get("cursor", "orders")).toEqual({ at: 2 });
    expect(await storeFor(A, "a2").markInbound("shopify:evt-shared", 1)).toBe(true);
    expect(await storeFor(A, "a").markInbound("shopify:evt-shared", 1)).toBe(true);
  });
});
