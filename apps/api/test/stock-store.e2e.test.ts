import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import { FakeClock, FakeShopify, seeded, testRuntime } from "@mizan/engine/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { EventDispatcher } from "../src/platform/events/dispatcher.js";
import { SecretsService } from "../src/platform/secrets/secrets.service.js";
import { EngineRegistry } from "../src/integrations/engine-registry.js";
import { EngineJobRunner } from "../src/integrations/engine-runner.js";
import { MessagingRegistry } from "../src/modules/confirmation/messaging.registry.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E8-5: low-stock alerts, and Mizan's count sent to Shopify. Off by default; once on, every
 * counted item's available count (on hand − reserved) is pushed to the location that stocks it,
 * through the outbox, and follows every change (orders confirmed, stock received). Items not
 * counted in Mizan stay the store's.
 */
const fake = new FakeVerifier();
const clock = new FakeClock();
clock.t = Date.now(); // jobs are queued at the real time
const shop = new FakeShopify(clock, seeded(81));
const LOCATION = "gid://shopify/Location/1";
let app: INestApplication;
let db: Database;
let store: string;
let tote: { productId: string; variantId: string; inventoryItemId: string };
let toteId: string;
let scarf: { productId: string; inventoryItemId: string };
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
async function settle() {
  const runner = app.get(EngineJobRunner);
  for (let i = 0; i < 20; i++) { await drain(); await runner.cycle(clock.now()); await runner.idle(); clock.advance(5_000); }
  await drain();
}
const inShop = (itemId: string) => shop.inventory.get(`${itemId}|${LOCATION}`);
const move = (variantId: string, kind: string, quantity: number) => http().post("/v1/stock/movements").set(as("owner")).send({ items: [{ variantId, kind, quantity }] }).expect(200);
const events = (type: string) => db.tenant(store, (trx) => trx.selectFrom("domain_events").select(["entity_id", "data"]).where("type", "=", type).execute());

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test", SHOPIFY_API_SECRET: shop.secret });
  app = await createApp(config, {
    logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake,
    engineRuntime: () => testRuntime(clock, { [shop.host]: shop.handler }, seeded(82)),
  });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null);
  fake.add("owner", { uid: "fb-owner-stock-store", email: "owner@stockstore.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Totes", country: "EG" }).expect(201)).body.id;
  await http().put("/v1/settings/orders").set(as("owner")).send({ duplicateWindowHours: 0 }).expect(200);
  await db.tenant(store, async (trx) => {
    const ref = await app.get(SecretsService).create(trx, store, JSON.stringify({ accessToken: "shpat_fake_token" }), { actor: { type: "system" } });
    await trx.insertInto("connections").values({ tenant_id: store, kind: "store", provider: "shopify", external_account: shop.host, secret_ref: ref }).execute();
  });
  tote = shop.addProduct({ title: "Tote bag", price: "300.00", sku: "BAG-TT", stock: 40, location: LOCATION });
  scarf = shop.addProduct({ title: "Scarf", price: "150.00", sku: "SCF-1", stock: 12, location: LOCATION });
  for (const p of [tote, scarf]) {
    const wh = shop.webhook("products/update", { id: p.productId });
    await (await app.get(EngineRegistry).get(store)).engine.handleShopifyWebhook(wh.headers, wh.body);
  }
  await settle();
  toteId = (await db.tenant(store, (trx) => trx.selectFrom("variants").select("id").where("sku", "=", "BAG-TT").executeTakeFirstOrThrow())).id;
});
afterAll(() => app.close());

describe("stock alerts and the store's count (E8-5)", () => {
  it("off by default: counting in Mizan doesn't touch the store", async () => {
    expect((await http().get("/v1/settings/inventory").set(as("owner")).expect(200)).body).toEqual({ pushToStore: false });
    await move(toteId, "count", 6);
    await settle();
    expect(inShop(tote.inventoryItemId)).toBe(40);
  });

  it("on: counted items get Mizan's available count; uncounted ones stay the store's", async () => {
    await http().put("/v1/settings/inventory").set(as("owner")).send({ pushToStore: true }).expect(200);
    await settle();
    expect(inShop(tote.inventoryItemId)).toBe(6);
    expect(inShop(scarf.inventoryItemId)).toBe(12);
  });

  it("a confirmed order lowers the store's count; stock that arrives raises it", async () => {
    const order = await http().post("/v1/orders").set(as("owner")).send({
      source: "phone", customer: { name: "Mona Adel", phone: "01001234567" }, address: { line1: "12 Abbas El Akkad St", city: "Nasr City" },
      lines: [{ variantId: toteId, quantity: 2 }], payment: { mode: "cod" },
    }).expect(201);
    await drain();
    await http().post(`/v1/orders/${order.body.id}/confirmation`).set(as("owner")).send({ answer: "confirm", byCall: true }).expect(200);
    await settle();
    expect(inShop(tote.inventoryItemId)).toBe(4);
    await move(toteId, "receive", 10);
    await settle();
    expect(inShop(tote.inventoryItemId)).toBe(14);
  });

  it("alerts once when available falls to the threshold, and when it runs out", async () => {
    await http().patch(`/v1/stock/${toteId}`).set(as("owner")).send({ lowStockAt: 5 }).expect(200);
    await http().post("/v1/stock/movements").set(as("owner")).send({ items: [{ variantId: toteId, kind: "adjust", quantity: -8, reason: "damaged" }] }).expect(200); // 14 → 6: not yet
    expect(await events("stock.low")).toHaveLength(0);
    await http().post("/v1/stock/movements").set(as("owner")).send({ items: [{ variantId: toteId, kind: "adjust", quantity: -2, reason: "lost" }] }).expect(200); // 6 → 4
    await http().post("/v1/stock/movements").set(as("owner")).send({ items: [{ variantId: toteId, kind: "adjust", quantity: -1, reason: "lost" }] }).expect(200); // 4 → 3: already low
    expect((await events("stock.low")).map((e) => e.data)).toEqual([expect.objectContaining({ available: 4, threshold: 5 })]);
    await move(toteId, "count", 2); // on hand 2, reserved 2 → available 0
    expect((await events("stock.out")).map((e) => e.entity_id)).toEqual([toteId]);
    await settle();
    expect(inShop(tote.inventoryItemId)).toBe(0);
    expect((await http().get("/v1/stock?filter=low").set(as("owner")).expect(200)).body.data.map((r: { sku: string }) => r.sku)).toEqual(["BAG-TT"]);
  });

  it("a threshold needs a counted item; settings are for managers", async () => {
    const scarfId = (await db.tenant(store, (trx) => trx.selectFrom("variants").select("id").where("sku", "=", "SCF-1").executeTakeFirstOrThrow())).id;
    expect((await http().patch(`/v1/stock/${scarfId}`).set(as("owner")).send({ lowStockAt: 3 }).expect(409)).body.code).toBe("not_counted");
    await http().patch("/v1/stock/33333333-3333-4333-8333-333333333333").set(as("owner")).send({ lowStockAt: 3 }).expect(404);
    const audit = await db.tenant(store, (trx) => trx.selectFrom("audit_log").select("action").where("action", "in", ["stock.settings_updated", "stock.threshold_set"]).execute());
    expect(audit.map((a) => a.action).sort()).toEqual(["stock.settings_updated", "stock.threshold_set"]);
  });
});
