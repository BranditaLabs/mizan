import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import { FakeClock, FakeShopify, seeded, testRuntime } from "@mizan/engine/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { EventDispatcher } from "../src/platform/events/dispatcher.js";
import { SecretsService } from "../src/platform/secrets/secrets.service.js";
import { EngineRegistry } from "../src/integrations/engine-registry.js";
import { EngineJobRunner } from "../src/integrations/engine-runner.js";
import { ReconciliationService, storeDayBounds } from "../src/modules/orders/reconciliation.service.js";

/**
 * E5-8: once a store day is over, the store's orders of that day are read again; an order whose
 * webhook never arrived is ingested; Mizan's count is recorded next to the store's; a gap left
 * over raises orders.reconciliation_gap. Scheduling the same day twice queues one job.
 */
const T = "aaaaaaaa-0000-4000-8000-0000000000e8";
const clock = new FakeClock();
const shop = new FakeShopify(clock, seeded(81));
let app: INestApplication;
let db: Database;
let connectionId: string;

const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
async function settle() {
  const runner = app.get(EngineJobRunner);
  for (let i = 0; i < 30; i++) { await drain(); await runner.cycle(clock.now()); await runner.idle(); clock.advance(5_000); }
  await drain();
}
const webhook = async (o: { id: string }) => {
  const wh = shop.webhook("orders/create", shop.orders.get(o.id)!);
  await (await app.get(EngineRegistry).get(T)).engine.handleShopifyWebhook(wh.headers, wh.body);
};
const day = (d: string) => db.tenant(T, (trx) => trx.selectFrom("order_reconciliations").select(["store_orders", "recovered", "mizan_orders", "gap"]).where("day", "=", new Date(`${d}T00:00:00Z`)).executeTakeFirst());
const events = (type: string) => db.tenant(T, (trx) => trx.selectFrom("domain_events").select("data").where("type", "=", type).execute());

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "http://localhost:3000", SHOPIFY_API_SECRET: shop.secret });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), engineRuntime: () => testRuntime(clock, { [shop.host]: shop.handler }, seeded(82)) });
  await app.init();
  db = app.get(Database);
  await db.kysely.insertInto("tenants").values({ id: T, name: "Nile Sync", slug: "nile-sync", settings: JSON.stringify({ phoneCountry: "EG", orders: { duplicateWindowHours: 0 } }) }).execute();
  connectionId = await db.tenant(T, async (trx) => {
    const ref = await app.get(SecretsService).create(trx, T, JSON.stringify({ accessToken: "shpat_fake_token" }), { actor: { type: "system" } });
    return (await trx.insertInto("connections").values({ tenant_id: T, kind: "store", provider: "shopify", external_account: shop.host, secret_ref: ref, status: "active" }).returning("id").executeTakeFirstOrThrow()).id;
  });
});
afterAll(() => app.close());

describe("store days in the store's time zone", () => {
  it("Cairo: summer time (UTC+3) and winter time (UTC+2)", () => {
    expect(storeDayBounds("2026-10-22", "Africa/Cairo")).toEqual({ from: "2026-10-21T21:00:00.000Z", to: "2026-10-22T21:00:00.000Z" });
    expect(storeDayBounds("2026-12-01", "Africa/Cairo")).toEqual({ from: "2026-11-30T22:00:00.000Z", to: "2026-12-01T22:00:00.000Z" });
    expect(storeDayBounds("2026-10-22", "Asia/Riyadh")).toEqual({ from: "2026-10-21T21:00:00.000Z", to: "2026-10-22T21:00:00.000Z" });
  });
});

describe("nightly reconciliation (E5-8)", () => {
  it("before 03:00 store time nothing is queued; after, yesterday is, once", async () => {
    const svc = app.get(ReconciliationService);
    expect(await svc.schedule(new Date("2026-10-23T23:30:00.000Z"))).toBe(0); // 02:30 in Cairo
    expect(await svc.schedule(new Date("2026-10-24T01:00:00.000Z"))).toBe(1); // 04:00 in Cairo: 2026-10-23
    expect(await svc.schedule(new Date("2026-10-24T02:00:00.000Z"))).toBe(0); // same day again: one job
    const jobs = await db.tenant(T, (trx) => trx.selectFrom("mz_outbox").select(["kind", "payload", "connection_id"]).where("kind", "=", "shopify.reconcile").execute());
    expect(jobs).toEqual([{ kind: "shopify.reconcile", connection_id: connectionId, payload: { day: "2026-10-23", from: "2026-10-22T21:00:00.000Z", to: "2026-10-23T21:00:00.000Z" } }]);
  });

  it("a lost webhook: the order is ingested, the day recorded as complete", async () => {
    const at = (h: number) => new Date(Date.parse("2026-10-22T21:00:00.000Z") + h * 3_600_000).toISOString();
    const a = shop.addOrder({ createdAt: at(2) });
    const b = shop.addOrder({ createdAt: at(5) });
    shop.addOrder({ createdAt: at(9) }); // its webhook never comes
    await webhook(a);
    await webhook(b);
    await settle();
    expect(await db.tenant(T, (trx) => trx.selectFrom("orders").select("id").execute())).toHaveLength(2);

    clock.t = Math.max(clock.now(), Date.parse("2026-10-24T01:05:00.000Z")); // the night it was queued for
    await settle(); // runs the queued shopify.reconcile for 2026-10-23
    expect(await db.tenant(T, (trx) => trx.selectFrom("orders").select("id").execute())).toHaveLength(3);
    expect(await day("2026-10-23")).toEqual({ store_orders: 3, recovered: 1, mizan_orders: 3, gap: 0 });
    expect((await events("orders.reconciled")).map((e) => e.data)).toEqual([expect.objectContaining({ day: "2026-10-23", recovered: 1, gap: 0 })]);
    expect(await events("orders.reconciliation_gap")).toEqual([]);
  });

  it("an order the store has and Mizan lost is a gap: recorded and raised", async () => {
    const at = (h: number) => new Date(Date.parse("2026-10-23T21:00:00.000Z") + h * 3_600_000).toISOString();
    const a = shop.addOrder({ createdAt: at(3) });
    const b = shop.addOrder({ createdAt: at(4) });
    await webhook(a);
    await webhook(b);
    await settle();
    // Something removed one from Mizan behind the engine's back (the engine still has it recorded).
    await db.tenant(T, async (trx) => {
      const o = await trx.selectFrom("orders").select("id").where("external_id", "=", b.id).executeTakeFirstOrThrow();
      await trx.deleteFrom("order_pnl").where("order_id", "=", o.id).execute();
      await trx.deleteFrom("payments").where("order_id", "=", o.id).execute();
      await trx.deleteFrom("order_lines").where("order_id", "=", o.id).execute();
      await trx.deleteFrom("order_events").where("order_id", "=", o.id).execute();
      await trx.deleteFrom("confirmation_runs").where("order_id", "=", o.id).execute();
      await trx.deleteFrom("orders").where("id", "=", o.id).execute();
    });
    expect(await app.get(ReconciliationService).schedule(new Date("2026-10-25T01:30:00.000Z"))).toBe(1);
    clock.t = Math.max(clock.now(), Date.parse("2026-10-25T01:35:00.000Z"));
    await settle();
    expect(await day("2026-10-24")).toEqual({ store_orders: 2, recovered: 0, mizan_orders: 1, gap: 1 });
    expect((await events("orders.reconciliation_gap")).map((e) => e.data)).toEqual([{ day: "2026-10-24", storeOrders: 2, mizanOrders: 1, recovered: 0, gap: 1 }]);
  });
});
