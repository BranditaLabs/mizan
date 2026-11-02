import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import { FakeBosta, FakeClock, FakeShopify, seeded, testRuntime } from "@mizan/engine/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { EventDispatcher } from "../src/platform/events/dispatcher.js";
import { SecretsService } from "../src/platform/secrets/secrets.service.js";
import { EngineJobRunner } from "../src/integrations/engine-runner.js";
import { MessagingRegistry } from "../src/modules/confirmation/messaging.registry.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E2-7: one account, two Shopify stores, one Bosta account. Each store runs its own engine: the
 * stores hand out the same order ids, yet each order lands once with its own store, ships once,
 * and a Bosta update reaches the store that booked the shipment (and only that one). A cancel
 * goes to the right store; jobs, cursors and dedupe keys never mix.
 */
const WEBHOOK_TOKEN = ["whsec", "bosta", "multi", "0123456789"].join("-");
const fake = new FakeVerifier();
const clock = new FakeClock();
clock.t = Date.now();
const nile = new FakeShopify(clock, seeded(91), "nile-abayas.myshopify.com");
const delta = new FakeShopify(clock, seeded(92), "delta-scarves.myshopify.com");
const bosta = new FakeBosta(clock, seeded(93));
let app: INestApplication;
let db: Database;
let store: string;
const conn: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
async function settle() {
  const runner = app.get(EngineJobRunner);
  for (let i = 0; i < 25; i++) { await drain(); await runner.cycle(clock.now()); await runner.idle(); clock.advance(30_000); }
  await drain();
}
const send = (connectionId: string, wh: { headers: Record<string, string>; body: string }) =>
  http().post(`/webhooks/shopify/${connectionId}`).set(wh.headers).set("Content-Type", "application/json").send(wh.body).expect(200);

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test", SHOPIFY_API_SECRET: nile.secret, BOSTA_BASE_URL: bosta.baseUrl });
  app = await createApp(config, {
    logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake,
    engineRuntime: () => testRuntime(clock, { [nile.host]: nile.handler, [delta.host]: delta.handler, [bosta.host]: bosta.handler }, seeded(94)),
  });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null);
  fake.add("owner", { uid: "fb-owner-multi", email: "owner@multi.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Group", country: "EG" }).expect(201)).body.id;
  await http().put("/v1/settings/orders").set(as("owner")).send({ duplicateWindowHours: 0 }).expect(200);
  await db.tenant(store, async (trx) => {
    const secrets = app.get(SecretsService);
    const by = { actor: { type: "system" as const } };
    for (const [name, shop] of [["nile", nile], ["delta", delta]] as const) {
      const ref = await secrets.create(trx, store, JSON.stringify({ accessToken: `shpat_${name}_token` }), by);
      conn[name] = (await trx.insertInto("connections").values({ tenant_id: store, kind: "store", provider: "shopify", external_account: shop.host, secret_ref: ref }).returning("id").executeTakeFirstOrThrow()).id;
    }
    const b = await secrets.create(trx, store, JSON.stringify({ apiKey: bosta.apiKey, webhookToken: WEBHOOK_TOKEN }), by);
    conn.bosta = (await trx.insertInto("connections").values({ tenant_id: store, kind: "courier", provider: "bosta", external_account: "bosta-1", secret_ref: b }).returning("id").executeTakeFirstOrThrow()).id;
  });
});
afterAll(() => app.close());

describe("several Shopify stores in one account (E2-7)", () => {
  let nileOrder: string;
  let deltaOrder: string;

  it("the same order id from two stores: two orders, each with its store, each shipped once", async () => {
    nileOrder = nile.addOrder({ tags: ["mizan-confirmed"] }).id;
    deltaOrder = delta.addOrder({ tags: ["mizan-confirmed"] }).id;
    expect(nileOrder).toBe(deltaOrder); // both fakes start at 1, like two real shops' numbering would never guarantee otherwise
    // Same Shopify event id too: dedupe keys are per store.
    await send(conn.nile!, nile.webhook("orders/create", nile.orders.get(nileOrder)!, "evt-1"));
    await send(conn.delta!, delta.webhook("orders/create", delta.orders.get(deltaOrder)!, "evt-1"));
    await settle();

    const orders = await db.tenant(store, (trx) => trx.selectFrom("orders").select(["external_id", "connection_id"]).orderBy("connection_id").execute());
    expect(orders.map((o) => o.connection_id).sort()).toEqual([conn.nile, conn.delta].sort());
    expect(new Set(orders.map((o) => o.external_id))).toEqual(new Set([nileOrder]));
    expect(bosta.deliveries.size).toBe(2);
    expect(nile.orders.get(nileOrder)!.fulfillments).toHaveLength(1);
    expect(delta.orders.get(deltaOrder)!.fulfillments).toHaveLength(1);

    const scopes = await db.tenant(store, (trx) => trx.selectFrom("mz_outbox").select("scope").distinct().execute());
    expect(scopes.map((s) => s.scope).sort()).toEqual([conn.nile, conn.delta].sort());
    expect(await db.tenant(store, (trx) => trx.selectFrom("mz_outbox").select("id").where("status", "=", "dead").execute())).toEqual([]);
  });

  it("a Bosta update reaches the store that booked the shipment, and only it", async () => {
    const byRef = new Map([...bosta.deliveries.values()].map((d) => [d.trackingNumber, d]));
    const deltaTn = await db.tenant(store, async (trx) => {
      const rows = await trx.selectFrom("mz_records").select(["key", "scope"]).where("type", "=", "shipment").execute();
      return rows.find((r) => r.scope === conn.delta)!.key;
    });
    expect(byRef.has(deltaTn)).toBe(true);
    bosta.setState(deltaTn, 45, "Delivered");
    await http().post(`/webhooks/bosta/${conn.bosta}?token=${WEBHOOK_TOKEN}`).set("Content-Type", "application/json").send(bosta.webhook(deltaTn, { withLabel: true })).expect(200);
    // The webhook's job is queued in the store that booked the shipment.
    const queued = await db.tenant(store, (trx) => trx.selectFrom("mz_outbox").select("scope")
      .where("kind", "=", "bosta.ingestStatus").where("idempotency_key", "like", `bosta:${deltaTn}:%`).where("idempotency_key", "not like", "bosta:poll:%").execute());
    expect(queued.map((q) => q.scope)).toEqual([conn.delta]);
    await settle();
    expect(delta.orders.get(deltaOrder)!.displayFinancialStatus).toBe("PAID"); // COD collected → paid in its own store
    expect(nile.orders.get(nileOrder)!.displayFinancialStatus).not.toBe("PAID");
    await http().post(`/webhooks/bosta/${conn.bosta}?token=wrong`).set("Content-Type", "application/json").send(bosta.webhook(deltaTn)).expect(401);
  });

  it("a cancel reaches the order's own store; admin views cover every store", async () => {
    const extra = nile.addOrder({ tags: [] });
    await send(conn.nile!, nile.webhook("orders/create", extra));
    await settle();
    const id = (await db.tenant(store, (trx) => trx.selectFrom("orders").select("id").where("connection_id", "=", conn.nile!).where("external_id", "=", extra.id).executeTakeFirstOrThrow())).id;
    await http().post("/v1/orders/bulk").set(as("owner")).send({ action: "cancel", orderIds: [id], reason: "customer_cancelled" }).expect(202);
    await settle();
    expect(nile.orders.get(extra.id)!.cancelledAt).not.toBeNull();
    expect(delta.cancels).toBe(0);

    const health = (await http().get(`/v1/admin/integrations/health?connectionId=${conn.delta}`).set(as("owner")).expect(200)).body;
    expect(health.connected).toBe(true);
    expect(health.connections.filter((c: { provider: string }) => c.provider === "shopify")).toHaveLength(2);
    expect((await http().get("/v1/admin/integrations/dead-letters").set(as("owner")).expect(200)).body.data).toEqual([]);
  });
});
