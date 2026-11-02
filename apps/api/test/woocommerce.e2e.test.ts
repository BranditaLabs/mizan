import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import { FakeClock, FakeWooCommerce, seeded, testRuntime } from "@mizan/engine/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { EventDispatcher } from "../src/platform/events/dispatcher.js";
import { EngineJobRunner } from "../src/integrations/engine-runner.js";
import { MessagingRegistry } from "../src/modules/confirmation/messaging.registry.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E5-7 through the real API, worker and engine against a fake WooCommerce: a store with no
 * Shopify at all connects with its REST keys, the keys are checked by pointing the webhooks at
 * Mizan, the last 60 days come in, then signed webhooks bring each new order; refused keys,
 * HTTP stores and a store already in another account are refused.
 */
const clock = new FakeClock();
const woo = new FakeWooCommerce(clock, seeded(41));
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store = "";
const http = () => request(app.getHttpServer());
const as = (token: string, tenant = store) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", ...(tenant ? { "X-Tenant-Id": tenant } : {}) });
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
async function runJobs(rounds = 60) {
  const runner = app.get(EngineJobRunner);
  for (let i = 0; i < rounds; i++) {
    await drain(); // events first: their consumers queue engine jobs
    const started = await runner.cycle(Math.max(Date.now(), clock.now()));
    await runner.idle();
    await drain();
    if (started === 0) return;
    clock.advance(60_000);
  }
}
const keys = { siteUrl: woo.siteUrl, consumerKey: woo.consumerKey, consumerSecret: woo.consumerSecret };
const connection = (id: string) => db.tenant(store, (trx) => trx.selectFrom("connections").select(["status", "status_reason", "external_account", "kind"]).where("id", "=", id).executeTakeFirstOrThrow());

beforeAll(async () => {
  app = await createApp(loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" }), {
    logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake,
    engineRuntime: () => testRuntime(clock, { [woo.host]: woo.handler }, seeded(42)),
  });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null);
  fake.add("owner", { uid: "fb-owner-woo", email: "owner@woo.test", emailVerified: true, secondFactor: "phone" });
  fake.add("other", { uid: "fb-other-woo", email: "other@woo.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set(as("owner", "")).send({ name: "Nile Woo", country: "EG" }).expect(201)).body.id;
});
afterAll(() => app.close());

describe("WooCommerce store (E5-7)", () => {
  let id = "";

  it("refuses an HTTP store, malformed keys and a member who is not an owner or admin", async () => {
    expect((await http().post("/v1/connections/woocommerce").set(as("owner")).send({ ...keys, siteUrl: "http://shop.example.com" }).expect(422)).body.code).toBe("site_not_https");
    await http().post("/v1/connections/woocommerce").set(as("owner")).send({ ...keys, consumerKey: "nope" }).expect(422);
    await http().post("/v1/connections/woocommerce").set(as("other")).send(keys).expect(403); // not a member of this store
  });

  it("connects with its keys: webhooks pointed at Mizan, the store goes active, the last 60 days come in", async () => {
    const old = [woo.addOrder({ payment: "cod" }), woo.addOrder({ payment: "card" }), woo.addOrder({ payment: "bank" })];
    const res = (await http().post("/v1/connections/woocommerce").set(as("owner")).send({ ...keys, siteUrl: `${woo.host}/wp-admin/` }).expect(201)).body;
    id = res.id;
    expect(res).toMatchObject({ kind: "store", provider: "woocommerce", account: woo.host, status: "pending" });
    await runJobs();
    expect(await connection(id)).toMatchObject({ status: "active", status_reason: null });
    const hooks = [...woo.webhooks.values()];
    expect(hooks.map((w) => w.topic).sort()).toEqual(["order.created", "order.deleted", "order.updated", "product.created", "product.updated"]);
    expect(new Set(hooks.map((w) => w.delivery_url))).toEqual(new Set([`https://api.mizan.test/webhooks/woocommerce/${id}`]));
    expect(hooks.every((w) => w.secret.length >= 32 && w.secret !== woo.webhookSecret)).toBe(true); // Mizan's own secret

    const list = (await http().get("/v1/orders?limit=100").set(as("owner")).expect(200)).body.data as Array<{ number: string; paymentMode: string; paymentStatus: string; store: { provider: string } }>;
    for (const o of old) expect(list.find((x) => x.number === `#${o.id}`)).toBeTruthy();
    expect(list.find((x) => x.number === `#${old[0]!.id}`)).toMatchObject({ paymentMode: "cod", paymentStatus: "unpaid", store: { provider: "woocommerce" } });
    expect(list.find((x) => x.number === `#${old[2]!.id}`)).toMatchObject({ paymentMode: "bank_transfer", paymentStatus: "unpaid" });
    const audit = (await http().get("/v1/audit-log?action=connection.key_saved").set(as("owner")).expect(200)).body.data;
    expect(JSON.stringify(audit)).not.toMatch(/ck_|cs_/);
  });

  it("products come in with the history; an order's line links to its product, so costs and profit apply", async () => {
    const product = woo.addProduct({ name: "عباية كريب", price: "600.00", stock: 5 });
    const wh = woo.webhook("product.created", product);
    await http().post(`/webhooks/woocommerce/${id}`).set(wh.headers).set("content-type", "application/json").send(wh.body).expect(200);
    await runJobs();
    const products = (await http().get("/v1/products?q=" + encodeURIComponent("كريب")).set(as("owner")).expect(200)).body.data;
    expect(products).toEqual([expect.objectContaining({ title: "عباية كريب" })]);
    clock.advance(60_000);
    const o = woo.addOrder({ payment: "cod", product });
    const owh = woo.webhook("order.created", o);
    await http().post(`/webhooks/woocommerce/${id}`).set(owh.headers).set("content-type", "application/json").send(owh.body).expect(200);
    await runJobs();
    const line = await db.tenant(store, (trx) => trx.selectFrom("order_lines as l").innerJoin("orders as o", "o.id", "l.order_id").select(["l.variant_id"]).where("o.number", "=", `#${o.id}`).executeTakeFirstOrThrow());
    expect(line.variant_id).not.toBeNull();
  });

  it("with stock push on, Mizan's count goes to WooCommerce, where WooCommerce keeps it (a shared count is summed)", async () => {
    const simple = woo.addProduct({ name: "طرحة", stock: 20 });
    const sized = woo.addProduct({ name: "عباية مقاسات", sizes: ["S", "M", "L"], stock: 9 }); // S shares the product's count
    for (const p of [simple, sized]) {
      const wh = woo.webhook("product.created", p);
      await http().post(`/webhooks/woocommerce/${id}`).set(wh.headers).set("content-type", "application/json").send(wh.body).expect(200);
    }
    await runJobs();
    const variant = (sku: string) => db.tenant(store, (trx) => trx.selectFrom("variants").select("id").where("sku", "=", sku).executeTakeFirstOrThrow()).then((r) => r.id);
    const [m, l] = woo.variationsOf.get(sized.id)!.slice(1);
    clock.t = Math.max(clock.t, Date.now()); // stock pushes are queued at the real time, as in production
    await http().put("/v1/settings/inventory").set(as("owner")).send({ pushToStore: true }).expect(200);
    const items = [{ variantId: await variant(simple.sku), kind: "count", quantity: 6 }, { variantId: await variant(`AB-${sized.id}-S`), kind: "count", quantity: 2 },
      { variantId: await variant(m!.sku), kind: "count", quantity: 1 }];
    await http().post("/v1/stock/movements").set(as("owner")).send({ items }).expect(200);
    await runJobs();
    expect(woo.products.get(simple.id)!.stock_quantity).toBe(6);
    expect(woo.products.get(sized.id)!.stock_quantity).toBe(2); // S, which shares the product's count
    expect(m!.stock_quantity).toBe(1);
    expect(l!.stock_quantity).toBe(5); // never counted in Mizan: left to the store
  });

  it("a signed webhook brings a new order; the ping is answered; a bad signature or unknown connection is refused", async () => {
    const ping = woo.ping();
    await http().post(`/webhooks/woocommerce/${id}`).set(ping.headers).send(ping.body).expect(200);
    clock.advance(60_000);
    const o = woo.addOrder({ payment: "cod", state: "EGGZ" });
    const wh = woo.webhook("order.created", o);
    await http().post(`/webhooks/woocommerce/${id}`).set({ ...wh.headers, "x-wc-webhook-signature": "AAAA" }).set("content-type", "application/json").send(wh.body).expect(401);
    await http().post("/webhooks/woocommerce/00000000-0000-4000-8000-000000000000").set(wh.headers).set("content-type", "application/json").send(wh.body).expect(404);
    expect((await http().post(`/webhooks/woocommerce/${id}`).set(wh.headers).set("content-type", "application/json").send(wh.body).expect(200)).body).toEqual({ accepted: true });
    await runJobs();
    const row = (await http().get(`/v1/orders?q=${o.id}`).set(as("owner")).expect(200)).body.data[0];
    expect(row).toMatchObject({ number: `#${o.id}`, paymentMode: "cod", cod: { amount: "1250.00" } });
    const detail = (await http().get(`/v1/orders/${row.id}`).set(as("owner")).expect(200)).body;
    expect(detail.shippingAddress ?? detail.address ?? {}).not.toHaveProperty("line1", expect.stringContaining("عباس")); // masked until revealed
  });

  it("cancelling in Mizan cancels the WooCommerce order, with the team's note, once", async () => {
    clock.advance(60_000);
    const o = woo.addOrder({ payment: "cod" });
    const wh = woo.webhook("order.created", o);
    await http().post(`/webhooks/woocommerce/${id}`).set(wh.headers).set("content-type", "application/json").send(wh.body).expect(200);
    await runJobs();
    const row = (await http().get(`/v1/orders?q=${o.id}`).set(as("owner")).expect(200)).body.data[0];
    const bulk = (await http().post("/v1/orders/bulk").set(as("owner")).send({ action: "cancel", orderIds: [row.id], reason: "customer_cancelled" }).expect(202)).body;
    await runJobs();
    expect((await http().get(`/v1/orders/bulk/${bulk.id}`).set(as("owner")).expect(200)).body).toMatchObject({ done: 1, skipped: 0 });
    expect(woo.orders.get(o.id)!.status).toBe("cancelled");
    expect(woo.notes.get(o.id)).toEqual(["Mizan: cancelled by the team"]);
    expect((await http().get(`/v1/orders/${row.id}`).set(as("owner")).expect(200)).body.status).toBe("cancelled");
  });

  it("a store already in another Mizan account is refused; new keys for the same store keep its webhooks", async () => {
    const other = (await http().post("/v1/tenants").set(as("other", "")).send({ name: "Copycat", country: "EG" }).expect(201)).body.id;
    expect((await http().post("/v1/connections/woocommerce").set(as("other", other)).send(keys).expect(409)).body.code).toBe("store_connected_elsewhere");
    const again = (await http().post("/v1/connections/woocommerce").set(as("owner")).send(keys).expect(201)).body;
    expect(again.id).toBe(id);
    await runJobs();
    expect(woo.webhookCreates).toBe(5);
    expect(await connection(id)).toMatchObject({ status: "active" });
  });

  it("refused keys: the store needs attention, with why", async () => {
    await http().post("/v1/connections/woocommerce").set(as("owner")).send({ ...keys, consumerSecret: "cs_wrongwrongwrong" }).expect(201);
    await runJobs();
    expect(await connection(id)).toMatchObject({ status: "needs_attention", status_reason: "key_refused" });
    const list = (await http().get("/v1/connections").set(as("owner")).expect(200)).body.data;
    expect(list.find((c: { id: string }) => c.id === id)).toMatchObject({ status: "needs_attention", reason: "key_refused" });
  });

  it("one click: WooCommerce's approval page, then its post with the keys saves them for the store that asked", async () => {
    const link = (await http().post("/v1/connections/woocommerce/authorize").set(as("owner")).send({ siteUrl: woo.host, locale: "en" }).expect(200)).body;
    const url = new URL(link.url);
    expect(`${url.origin}${url.pathname}`).toBe(`${woo.siteUrl}/wc-auth/v1/authorize`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      app_name: "Mizan", scope: "read_write", callback_url: "https://api.mizan.test/webhooks/woocommerce-auth",
      return_url: "https://app.mizan.test/en/settings/integrations?woo=returned",
    });
    const token = url.searchParams.get("user_id")!;
    const post = (body: object) => http().post("/webhooks/woocommerce-auth").set("content-type", "application/json;charset=UTF-8").send(JSON.stringify(body));
    const keysBody = { key_id: 7, user_id: token, consumer_key: woo.consumerKey, consumer_secret: woo.consumerSecret, key_permissions: "read_write" };
    await post({ ...keysBody, user_id: `${token}x` }).expect(401);
    await post({ ...keysBody, key_permissions: "read" }).expect(400);
    await post({ ...keysBody, consumer_key: "nope" }).expect(400);
    await http().post("/v1/connections/woocommerce/authorize").set(as("owner")).send({ siteUrl: "http://plain.example" }).expect(422);
    expect((await post(keysBody).expect(200)).body).toEqual({ saved: true });
    await runJobs();
    expect(await connection(id)).toMatchObject({ status: "active", status_reason: null }); // the same store: new keys, checked again
    const audit = (await http().get("/v1/audit-log?action=connection.key_saved").set(as("owner")).expect(200)).body.data;
    expect(audit[0]).toMatchObject({ after: expect.objectContaining({ provider: "woocommerce", reconnected: true }) });
  });
});
