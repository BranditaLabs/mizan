import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import { FakeClock, FakeShopify, seeded, testRuntime } from "@mizan/engine/testing";
import type { CanonicalOrder } from "@mizan/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { EventDispatcher } from "../src/platform/events/dispatcher.js";
import { SecretsService } from "../src/platform/secrets/secrets.service.js";
import { EngineJobRunner } from "../src/integrations/engine-runner.js";
import { OrderProjector } from "../src/modules/orders/order-projector.js";
import { FakeVerifier } from "./support/fake-auth.js";

const clock = new FakeClock();
const shop = new FakeShopify(clock, seeded(1));
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
const T: Record<string, string> = {};
const conn: Record<string, string> = {};
const ext: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const as = (user: string, tenant = T[user]!) => ({ Authorization: `Bearer ${user}`, "X-Tenant-Id": tenant });
const send = (wh: { headers: Record<string, string>; body: string }, path = "/webhooks/shopify/gdpr") =>
  http().post(path).set(wh.headers).set("Content-Type", "application/json").send(wh.body);
const numeric = (gid: string) => Number(gid.split("/").pop());

async function work() {
  const runner = app.get(EngineJobRunner);
  for (let i = 0; i < 6; i++) {
    await runner.cycle();
    await runner.idle();
    await app.get(EventDispatcher).runOnce();
    clock.advance(60_000);
  }
}
const orders = (tenant: string) => db.tenant(tenant, (trx) => trx.selectFrom("orders")
  .select(["external_id", "connection_id", "ship_name", "ship_phone", "ship_line1", "ship_city", "total_minor", "pii_redacted_at", "customer_id"]).orderBy("external_id").execute());
const record = (tenant: string, key: string) => db.tenant(tenant, (trx) => trx.selectFrom("mz_records").select("value").where("type", "=", "order").where("key", "=", key).executeTakeFirstOrThrow());

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "http://localhost:3000", SHOPIFY_API_KEY: shop.clientId, SHOPIFY_API_SECRET: shop.secret });
  app = await createApp(config, {
    logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake,
    engineRuntime: () => testRuntime(clock, { [shop.host]: shop.handler }, seeded(3)),
  });
  await app.init();
  db = app.get(Database);
  for (const user of ["sara", "omar"]) {
    fake.add(user, { uid: `fb-${user}` });
    T[user] = (await http().post("/v1/tenants").set({ Authorization: `Bearer ${user}` }).send({ name: `${user} store`, country: "EG" }).expect(201)).body.id;
  }
  const secrets = app.get(SecretsService);
  await db.tenant(T.sara!, async (trx) => {
    const ref = await secrets.create(trx, T.sara!, JSON.stringify({ accessToken: "shpat_fake" }), { actor: { type: "system" } });
    conn.shop = (await trx.insertInto("connections").values({ tenant_id: T.sara!, kind: "store", provider: "shopify", external_account: shop.host, secret_ref: ref }).returning("id").executeTakeFirstOrThrow()).id;
    conn.woo = (await trx.insertInto("connections").values({ tenant_id: T.sara!, kind: "store", provider: "woocommerce", external_account: "mona-shop.example" }).returning("id").executeTakeFirstOrThrow()).id;
  });
  // Omar held the same shop once (disconnected since): Shopify's requests concern him too.
  conn.old = await db.tenant(T.omar!, async (trx) => (await trx.insertInto("connections").values({ tenant_id: T.omar!, kind: "store", provider: "shopify", external_account: shop.host, status: "disconnected" }).returning("id").executeTakeFirstOrThrow()).id);

  // Mona: two Shopify orders and one from WooCommerce. Karim: one Shopify order.
  const o1 = shop.addOrder({ phone: "+20 100 123 4821" });
  const o2 = shop.addOrder({ phone: "01001234821" });
  const o3 = shop.addOrder({ phone: "+20 111 222 3333" });
  Object.assign(ext, { o1: o1.id, o2: o2.id, o3: o3.id });
  for (const o of [o1, o2, o3]) await http().post(`/webhooks/shopify/${conn.shop}`).set(shop.webhook("orders/create", o).headers).set("Content-Type", "application/json").send(shop.webhook("orders/create", o).body);
  await work();
  const mona = (await record(T.sara!, o1.id)).value as unknown as { order: CanonicalOrder };
  await app.get(OrderProjector).project(T.sara!, conn.woo!, { ...mona.order, externalId: "woo-77", number: "W-77" });
});
afterAll(() => app.close());

describe("Shopify compliance webhooks", () => {
  it("are verified, recorded once per store that held the shop, and routed before connection ids", async () => {
    const wh = shop.complianceWebhook("customers/redact", { customer: { id: 191167, email: "mona@example.com", phone: "+201001234821" }, orders_to_redact: [numeric(ext.o1!)] });
    await send({ ...wh, headers: { ...wh.headers, "X-Shopify-Hmac-SHA256": "forged" } }).expect(401);
    expect((await send(wh).expect(200)).body).toEqual({ accepted: true, recorded: 2 });
    expect((await send(wh).expect(200)).body).toEqual({ accepted: true, recorded: 0 }); // redelivery

    const stored = await db.tenant(T.sara!, (trx) => trx.selectFrom("privacy_requests").selectAll().execute());
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ source: "shopify_customers_redact", status: "received", connection_id: conn.shop });
    expect(JSON.stringify(stored[0]!.payload)).not.toMatch(/mona@example|4821/); // ids and a phone hash only
    expect(stored[0]!.due_at.getTime() - Date.now()).toBeGreaterThan(29 * 86_400_000);

  });

  it("customers/redact removes the customer's personal data from this shop's orders, keeps totals, and survives re-ingest", async () => {
    await work();
    const rows = await orders(T.sara!);
    const by = Object.fromEntries(rows.map((r) => [r.external_id, r]));
    for (const k of ["o1", "o2"]) {
      expect(by[ext[k]!]).toMatchObject({ ship_name: null, ship_phone: null, ship_line1: null, ship_city: "Nasr City", total_minor: 115000n });
      expect(by[ext[k]!]!.pii_redacted_at).not.toBeNull();
      const rec = JSON.stringify((await record(T.sara!, ext[k]!)).value);
      expect(rec).not.toMatch(/Mona|4821|Abbas|mona@/);
      expect(rec).toContain("Nasr City");
    }
    expect(by[ext.o3!]!.ship_name).toMatch(/^pii:v1:/); // Karim untouched
    expect(by["woo-77"]!.ship_name).toMatch(/^pii:v1:/); // other channel untouched
    // Mona is also a WooCommerce customer: her customer record stays.
    const mona = await db.tenant(T.sara!, (trx) => trx.selectFrom("customers").select(["name", "redacted_at"]).where("id", "=", by["woo-77"]!.customer_id!).executeTakeFirstOrThrow());
    expect(mona.redacted_at).toBeNull();

    // Shopify sends the order again: its personal data does not come back.
    const wh = shop.webhook("orders/updated", shop.orders.get(ext.o1!)!);
    await http().post(`/webhooks/shopify/${conn.shop}`).set(wh.headers).set("Content-Type", "application/json").send(wh.body).expect(200);
    await work();
    expect((await orders(T.sara!)).find((r) => r.external_id === ext.o1)).toMatchObject({ ship_name: null, ship_phone: null, customer_id: by[ext.o1!]!.customer_id });

    const list = await http().get("/v1/privacy-requests").set(as("sara")).expect(200);
    expect(list.body.data).toEqual([expect.objectContaining({ source: "shopify_customers_redact", status: "done", hasExport: false })]);
    const audit = await http().get("/v1/audit-log?action=privacy.").set(as("sara")).expect(200);
    expect(audit.body.data.map((e: { action: string }) => e.action).sort()).toEqual(["privacy.request_completed", "privacy.request_received"]);
  });

  it("customers/data_request compiles the customer's data for the store, encrypted until an owner downloads it", async () => {
    await send(shop.complianceWebhook("customers/data_request", { customer: { id: 2, phone: "+201112223333" }, orders_requested: [numeric(ext.o3!)], data_request: { id: 9999 } })).expect(200);
    await work();
    const row = await db.tenant(T.sara!, (trx) => trx.selectFrom("privacy_requests").select(["id", "result", "status"]).where("source", "=", "shopify_customers_data_request").executeTakeFirstOrThrow());
    expect(row.status).toBe("done");
    expect(row.result).toMatch(/^pii:v1:/);

    await http().get(`/v1/privacy-requests/${row.id}/export`).set({ Authorization: "Bearer omar", "X-Tenant-Id": T.sara! }).expect(403);
    const exp = await http().get(`/v1/privacy-requests/${row.id}/export`).set(as("sara")).expect(200);
    expect(exp.body).toMatchObject({ shopifyDataRequestId: "9999", customers: [{ name: "Mona Adel", phone: "+201112223333" }] });
    expect(exp.body.orders).toEqual([expect.objectContaining({ externalId: ext.o3, total: { amount: "1150.00", currency: "EGP" }, shipping: expect.objectContaining({ line1: "12 Abbas El Akkad St" }) })]);
    const audit = await http().get("/v1/audit-log?action=privacy.export_downloaded").set(as("sara")).expect(200);
    expect(audit.body.data).toHaveLength(1);

    const redactReq = (await http().get("/v1/privacy-requests").set(as("sara")).expect(200)).body.data.find((r: { source: string }) => r.source === "shopify_customers_redact");
    await http().get(`/v1/privacy-requests/${redactReq.id}/export`).set(as("sara")).expect(409);
  });

  it("shop/redact removes personal data of every order and Shopify-only customer of the shop", async () => {
    await send(shop.complianceWebhook("shop/redact", {}, "evt-shop-redact-2")).expect(200);
    await work();
    const rows = await orders(T.sara!);
    for (const r of rows.filter((x) => x.connection_id === conn.shop)) expect(r).toMatchObject({ ship_name: null, ship_phone: null, ship_line1: null });
    expect(rows.find((r) => r.external_id === "woo-77")!.ship_name).toMatch(/^pii:v1:/);
    const karim = rows.find((r) => r.external_id === ext.o3)!;
    const c = await db.tenant(T.sara!, (trx) => trx.selectFrom("customers").select(["name", "phone_e164", "phone_hash", "redacted_at"]).where("id", "=", karim.customer_id!).executeTakeFirstOrThrow());
    expect(c).toMatchObject({ name: null, phone_e164: null, phone_hash: null });
    expect(c.redacted_at).not.toBeNull();
  });
});
