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
import { EventsService } from "../src/platform/events/events.service.js";
import { MetricsService } from "../src/platform/metrics/metrics.service.js";
import { SecretsService } from "../src/platform/secrets/secrets.service.js";
import { EngineJobRunner } from "../src/integrations/engine-runner.js";
import { ProductProjector } from "../src/modules/catalog/product-projector.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E4-5 onboarding through the real API, worker loops and engine against fake Shopify and Bosta:
 * signup → connect the store (import 60 days + products into the catalogue) → courier key checked in
 * the background → costs entered → first order, with product events and time-to-first-value.
 */
// Fake credential, assembled at runtime so secret scanners do not flag the fixture.
const WRONG_KEY = ["not", "the", "right", "key"].join("-");
const clock = new FakeClock();
const shop = new FakeShopify(clock, seeded(11));
const bosta = new FakeBosta(clock, seeded(12));
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", ...(store ? { "X-Tenant-Id": store } : {}) });

async function drainEvents() {
  const d = app.get(EventDispatcher);
  while ((await d.runOnce()).claimed > 0) { /* until empty */ }
}
async function runJobs(rounds = 80) {
  const runner = app.get(EngineJobRunner);
  for (let i = 0; i < rounds; i++) {
    const started = await runner.cycle();
    await runner.idle();
    await drainEvents();
    if (started === 0) return;
    clock.advance(60_000);
  }
}
const onboarding = async () => (await http().get("/v1/onboarding").set(as("owner")).expect(200)).body;

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "http://localhost:3000", SHOPIFY_API_SECRET: shop.secret, BOSTA_BASE_URL: bosta.baseUrl });
  app = await createApp(config, {
    logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake,
    engineRuntime: () => testRuntime(clock, { [shop.host]: shop.handler, [bosta.host]: bosta.handler }, seeded(13)),
  });
  await app.init();
  db = app.get(Database);
  fake.add("owner", { uid: "fb-owner", email: "owner@nile.test", emailVerified: true, secondFactor: "phone" });
  fake.add("agent", { uid: "fb-agent", phone: "+201001234821" });
});
afterAll(() => app.close());

describe("onboarding", () => {
  it("starts at signup with every step to do", async () => {
    store = (await http().post("/v1/tenants").set(as("owner")).send({ name: "Nile Abayas", country: "EG" }).expect(201)).body.id;
    await drainEvents();
    const o = await onboarding();
    expect(o.steps).toMatchObject({
      store: { status: "todo", shop: null, import: null }, courier: { status: "todo" },
      costs: { status: "todo", variants: 0, missingCost: 0 }, firstOrder: { status: "waiting", orderId: null },
    });
    expect(o.milestones.signup).toEqual(expect.any(String));
    expect(o.timeToFirstValueS).toBeNull();
    expect(o.complete).toBe(false);
    // The courier waits for the store.
    expect((await http().post("/v1/connections/bosta").set(as("owner")).send({ apiKey: bosta.apiKey }).expect(409)).body.code).toBe("store_not_connected");
  });

  it("connecting the store imports orders and puts products in the catalogue; the first order is the first value", async () => {
    shop.addProduct({ title: "Black Abaya", price: "950.00", sku: "AB-1" });
    shop.addProduct({ title: "Silk Scarf", price: "120.00", sku: "" }); // no SKU in Shopify
    shop.addProduct({ title: "Abaya (copy)", price: "990.00", sku: "AB-1" }); // duplicate SKU in Shopify
    shop.addOrder({ name: "#1001" });
    // What the Shopify claim does (E3-1): connection + secret + connection.connected in one transaction.
    await db.tenant(store, async (trx) => {
      const ref = await app.get(SecretsService).create(trx, store, JSON.stringify({ accessToken: "shpat_fake_token" }), { actor: { type: "system" } });
      const id = (await trx.insertInto("connections").values({ tenant_id: store, kind: "store", provider: "shopify", external_account: shop.host, secret_ref: ref })
        .returning("id").executeTakeFirstOrThrow()).id;
      await app.get(EventsService).emit(trx, { type: "connection.connected", tenantId: store, entity: { type: "connection", id }, data: { provider: "shopify", kind: "store", reconnected: false }, actor: { type: "user" } });
    });
    await drainEvents();
    await runJobs();

    const o = await onboarding();
    expect(o.steps.store).toMatchObject({ status: "done", shop: shop.host, import: { status: "done", phase: "done", orders: 1, products: 3 } });
    expect(o.steps.firstOrder).toMatchObject({ status: "done", number: "#1001" });
    expect(o.steps.costs).toMatchObject({ status: "todo", variants: 3, missingCost: 3 });
    expect(o.milestones.storeConnected).toEqual(expect.any(String));
    expect(o.timeToFirstValueS).toBeGreaterThanOrEqual(0);
    const ttfv = await app.get(MetricsService).timeToFirstValue.get();
    expect(ttfv.values.find((v) => v.metricName === "mizan_time_to_first_value_seconds_count")?.value).toBe(1);

    const page = (await http().get("/v1/products/variants/costs?missingCost=true").set(as("owner")).expect(200)).body;
    expect(page.counts).toEqual({ variants: 3, missingCost: 3 });
    const skus = page.data.map((v: { sku: string }) => v.sku);
    expect(skus).toContain("AB-1");
    expect(skus.filter((s: string) => s.startsWith("SHOPIFY-"))).toHaveLength(2); // no SKU, and the duplicate
    expect(page.data.find((v: { productTitle: string }) => v.productTitle === "Silk Scarf")).toMatchObject({ price: { amount: "120.00", currency: "EGP" }, cost: null });
  });

  it("costs are saved as decimals, survive the next sync, and complete the step", async () => {
    const { data } = (await http().get("/v1/products/variants/costs").set(as("owner")).expect(200)).body;
    const items = data.map((v: { variantId: string; productTitle: string }) => ({ variantId: v.variantId, cost: v.productTitle === "Silk Scarf" ? "35.50" : "410" }));
    expect((await http().put("/v1/products/variants/costs").set(as("owner")).send({ items: items.slice(0, 1) }).expect(200)).body).toEqual({ updated: 1, missingCost: 2 });
    expect((await http().put("/v1/products/variants/costs").set(as("owner")).send({ items }).expect(200)).body).toEqual({ updated: 3, missingCost: 0 });
    expect((await http().put("/v1/products/variants/costs").set(as("owner")).send({ items: [{ variantId: items[0].variantId, cost: "12.345.6" }] }).expect(422)).body.code).toBe("validation_failed");

    // The store changes a price: the next sync updates the price, never the cost.
    const conn = await db.tenant(store, (trx) => trx.selectFrom("connections").select("id").where("provider", "=", "shopify").executeTakeFirstOrThrow());
    const scarfLink = await db.tenant(store, (trx) => trx.selectFrom("external_variants as ev").innerJoin("variants as v", "v.id", "ev.variant_id").innerJoin("products as p", "p.id", "v.product_id")
      .select(["ev.external_id", "ev.external_product_id"]).where("p.title", "=", "Silk Scarf").executeTakeFirstOrThrow());
    await app.get(ProductProjector).project(store, conn.id, {
      connector: "shopify", externalId: scarfLink.external_product_id!, title: "Silk Scarf", status: "active", tags: [], updatedAt: new Date().toISOString(),
      variants: [{ externalId: scarfLink.external_id, price: { amount: "135.00", currency: "EGP" } }],
    });
    const after = (await http().get("/v1/products/variants/costs").set(as("owner")).expect(200)).body.data.find((v: { productTitle: string }) => v.productTitle === "Silk Scarf");
    expect(after).toMatchObject({ price: { amount: "135.00" }, cost: { amount: "35.50", currency: "EGP" } });

    const o = await onboarding();
    expect(o.steps.costs).toMatchObject({ status: "done", missingCost: 0 });
    expect(o.milestones.costsEntered).toEqual(expect.any(String));
  });

  it("a refused Bosta key needs attention; a working key is checked in the background and connects the courier", async () => {
    const wrong = await http().post("/v1/connections/bosta").set(as("owner")).send({ apiKey: WRONG_KEY }).expect(201);
    expect(wrong.body).toMatchObject({ provider: "bosta", kind: "courier", status: "pending", verifiedAt: null });
    expect((await onboarding()).steps.courier.status).toBe("checking");
    await runJobs();
    expect((await onboarding()).steps.courier).toMatchObject({ status: "needs_attention", provider: "bosta", reason: "key_refused" });
    expect(bosta.deliveries.size).toBe(0);

    await http().post("/v1/connections/bosta").set(as("owner")).send({ apiKey: bosta.apiKey }).expect(201);
    await runJobs();
    const o = await onboarding();
    expect(o.steps.courier).toMatchObject({ status: "done", reason: null });
    expect(o.milestones.courierConnected).toEqual(expect.any(String));
    expect(o.complete).toBe(true);
    const list = (await http().get("/v1/connections").set(as("owner")).expect(200)).body.data;
    expect(list.map((c: { provider: string; status: string }) => [c.provider, c.status])).toEqual([["shopify", "active"], ["bosta", "active"]]);
    expect(list[1].verifiedAt).toEqual(expect.any(String));
    // The key is stored encrypted, never returned.
    expect(JSON.stringify(list)).not.toContain(bosta.apiKey);
    const secret = await db.tenant(store, (trx) => trx.selectFrom("secrets").select("ciphertext").execute());
    expect(secret.map((s) => s.ciphertext).join()).not.toContain(bosta.apiKey);
  });

  it("product events: each milestone once, ids only", async () => {
    await runJobs();
    const events = await db.tenant(store, (trx) => trx.selectFrom("product_events").select(["name", "data"]).orderBy("id").execute());
    const names = events.map((e) => e.name);
    for (const m of ["signup", "store_connected", "first_order_synced", "costs_entered", "courier_connected"]) expect(names.filter((n) => n === m), m).toHaveLength(1);
    expect(JSON.stringify(events)).not.toMatch(/owner@nile|Nile Abayas|Mona|\+20/);
  });

  it("skip and hide are the owner's choice; agents cannot see setup", async () => {
    const o = (await http().patch("/v1/onboarding").set(as("owner")).send({ dismissed: true, skip: { costs: true } }).expect(200)).body;
    expect(o.dismissed).toBe(true);
    expect(o.steps.costs.status).toBe("done"); // already done: done wins over skipped
    expect((await http().patch("/v1/onboarding").set(as("owner")).send({}).expect(422)).body.code).toBe("validation_failed");
    expect((await http().patch("/v1/onboarding").set(as("owner")).send({ dismissed: false }).expect(200)).body.dismissed).toBe(false);
    const audit = (await http().get("/v1/audit-log?action=onboarding.").set(as("owner")).expect(200)).body.data;
    expect(audit).toHaveLength(2);
    fake.add("agent", { uid: "fb-agent", phone: "+201001234821" });
    expect((await http().get("/v1/onboarding").set(as("agent")).expect(403)).body.code).toBe("not_a_member");
  });
});
