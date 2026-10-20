import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import { FakeBosta, FakeClock, FakeShopify, seeded, testRuntime } from "@mizan/engine/testing";
import type { CanonicalOrder } from "@mizan/shared";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { PiiCipher } from "../src/platform/pii/pii-cipher.js";
import { SecretsService } from "../src/platform/secrets/secrets.service.js";
import { EngineRegistry } from "../src/integrations/engine-registry.js";
import { EngineJobRunner } from "../src/integrations/engine-runner.js";
import { OrderProjector } from "../src/modules/orders/order-projector.js";

const T = "aaaaaaaa-0000-4000-8000-000000000001";
const U = "bbbbbbbb-0000-4000-8000-000000000002";
const clock = new FakeClock();
const shop = new FakeShopify(clock, seeded(1));
const bosta = new FakeBosta(clock, seeded(2));

let app: INestApplication;
let db: Database;
let projector: OrderProjector;
let connectionId: string;

const order = (over: Partial<CanonicalOrder> = {}): CanonicalOrder => ({
  connector: "shopify", externalId: "gid://shopify/Order/9001", number: "#9001",
  createdAt: "2026-10-20T10:00:00Z", updatedAt: "2026-10-20T10:00:00Z", currency: "EGP",
  total: { amount: "1150.00", currency: "EGP" }, subtotal: { amount: "1100.00", currency: "EGP" }, shipping: { amount: "50.00", currency: "EGP" },
  paymentMode: "cod", paymentStatus: "unpaid", gateways: ["Cash on Delivery (COD)"],
  received: { amount: "0.00", currency: "EGP" }, outstanding: { amount: "1150.00", currency: "EGP" }, refunded: { amount: "0.00", currency: "EGP" },
  cancelled: false,
  customer: { name: "Mona Adel", phone: "+201001234821", email: "mona@example.com" },
  shippingAddress: { name: "Mona Adel", phone: "010 0123 4821", line1: "12 Abbas El Akkad St", line2: "Floor 3", city: "Nasr City", province: "Cairo", countryCode: "EG" },
  lines: [{ externalLineId: "L1", sku: "SER-30", title: "Vitamin C serum", quantity: 2, unitPrice: { amount: "550.00", currency: "EGP" } }],
  fulfillmentGroups: [], tags: [],
  ...over,
});

const rows = (table: "orders" | "customers" | "order_lines" | "order_events", tenant = T) =>
  db.tenant(tenant, (trx) => trx.selectFrom(table).selectAll().execute());
const events = (type: string, tenant = T) =>
  db.kysely.selectFrom("domain_events").select(["type", "entity_id", "data"]).where("tenant_id", "=", tenant).where("type", "=", type).execute();

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "http://localhost:3000", SHOPIFY_API_SECRET: shop.secret, BOSTA_BASE_URL: bosta.baseUrl });
  app = await createApp(config, {
    logDestination: new Writable({ write: (_c, _e, d) => d() }),
    engineRuntime: () => testRuntime(clock, { [shop.host]: shop.handler, [bosta.host]: bosta.handler }, seeded(3)),
  });
  await app.init();
  db = app.get(Database);
  projector = app.get(OrderProjector);
  await db.kysely.insertInto("tenants").values([
    { id: T, name: "Nile", slug: "nile", settings: JSON.stringify({ phoneCountry: "EG" }) },
    { id: U, name: "Other", slug: "other" },
  ]).execute();
  const secrets = app.get(SecretsService);
  connectionId = await db.tenant(T, async (trx) => {
    const ref = await secrets.create(trx, T, JSON.stringify({ accessToken: "shpat_fake_token" }), { actor: { type: "system" } });
    return (await trx.insertInto("connections").values({ tenant_id: T, kind: "store", provider: "shopify", external_account: shop.host, secret_ref: ref }).returning("id").executeTakeFirstOrThrow()).id;
  });
});
afterAll(() => app.close());

describe("engine → orders (acceptance)", () => {
  it("replaying the same webhook 3× creates one order, one customer and one order.created event", async () => {
    const o = shop.addOrder({ tags: [] });
    const { engine } = await app.get(EngineRegistry).get(T);
    const wh = shop.webhook("orders/create", o);
    // Three deliveries of the same event, plus a re-sent copy under a new event id (Shopify does that too).
    for (let i = 0; i < 3; i++) await engine.handleShopifyWebhook(wh.headers, wh.body);
    const again = shop.webhook("orders/updated", o);
    await engine.handleShopifyWebhook(again.headers, again.body);
    const runner = app.get(EngineJobRunner);
    for (let i = 0; i < 5; i++) { await runner.cycle(); await runner.idle(); }

    const orders = (await rows("orders")).filter((r) => r.external_id === o.id);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ number: o.name, status: "new", connection_id: connectionId, total_minor: 115000n, cod_minor: 115000n, payment_mode: "cod" });
    expect((await events("order.created")).filter((e) => e.entity_id === orders[0]!.id)).toHaveLength(1);
    expect((await events("order.updated")).filter((e) => e.entity_id === orders[0]!.id)).toHaveLength(0);
    expect((await rows("order_lines")).filter((l) => l.order_id === orders[0]!.id)).toHaveLength(1);
  });
});

describe("OrderProjector", () => {
  it("stores money in minor units, lines, and city in clear; personal data only encrypted", async () => {
    const r = await projector.project(T, connectionId, order());
    expect(r.created).toBe(true);
    const o = (await rows("orders")).find((x) => x.id === r.orderId)!;
    expect(o).toMatchObject({ subtotal_minor: 110000n, shipping_minor: 5000n, total_minor: 115000n, paid_minor: 0n, ship_city: "Nasr City", ship_country: "EG" });
    for (const col of ["ship_name", "ship_phone", "ship_line1", "ship_line2"] as const) expect(o[col]).toMatch(/^pii:v1:/);

    const dump = JSON.stringify([await rows("orders"), await rows("customers")], (_k, v) => (typeof v === "bigint" ? String(v) : v));
    for (const plain of ["1001234821", "Mona", "Abbas", "mona@example.com"]) expect(dump).not.toContain(plain);

    const pii = await db.tenant(T, (trx) => app.get(PiiCipher).forTenant(trx, T));
    expect(pii.decrypt(o.ship_phone, "orders.ship_phone")).toBe("+201001234821");
    expect(pii.decrypt(o.ship_line1, "orders.ship_line1")).toBe("12 Abbas El Akkad St");
    expect(() => pii.decrypt(o.ship_phone, "orders.ship_name")).toThrow(); // bound to its column
    const lines = (await rows("order_lines")).filter((l) => l.order_id === r.orderId);
    expect(lines).toEqual([expect.objectContaining({ external_line_id: "L1", sku: "SER-30", quantity: 2, unit_price_minor: 55000n })]);
  });

  it("matches the customer by phone hash across orders and phone formats", async () => {
    const before = (await rows("customers")).length;
    const r = await projector.project(T, connectionId, order({ externalId: "gid://shopify/Order/9002", number: "#9002", shippingAddress: { ...order().shippingAddress!, phone: "٠١٠٠١٢٣٤٨٢١" } }));
    const customers = await rows("customers");
    expect(customers).toHaveLength(before);
    const o = (await rows("orders")).find((x) => x.id === r.orderId)!;
    const c = customers.find((x) => x.id === o.customer_id)!;
    expect(c.orders_count).toBeGreaterThanOrEqual(2);
    expect(c.phone_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("the same phone hashes differently in another tenant", async () => {
    const connU = await db.tenant(U, async (trx) => (await trx.insertInto("connections").values({ tenant_id: U, kind: "store", provider: "shopify", external_account: "other.myshopify.com" }).returning("id").executeTakeFirstOrThrow()).id);
    await projector.project(U, connU, order());
    const [hu] = await rows("customers", U);
    const ht = (await rows("customers")).map((c) => c.phone_hash);
    expect(ht).not.toContain(hu!.phone_hash);
  });

  it("emits order.updated with what changed, and nothing when nothing changed", async () => {
    const base = order({ externalId: "gid://shopify/Order/9100", number: "#9100" });
    const { orderId } = await projector.project(T, connectionId, base);
    expect((await projector.project(T, connectionId, base)).changed).toEqual([]);

    const paid = await projector.project(T, connectionId, {
      ...base, paymentStatus: "paid", received: { amount: "1150.00", currency: "EGP" }, outstanding: { amount: "0.00", currency: "EGP" }, tags: ["vip"],
    });
    expect(paid.changed.sort()).toEqual(["cod_minor", "paid_minor", "payment_status", "tags"]);
    const updated = (await events("order.updated")).filter((e) => e.entity_id === orderId);
    expect(updated).toHaveLength(1);
    expect(updated[0]!.data).toMatchObject({ number: "#9100", paymentStatus: "paid", codMinor: "0", changed: expect.arrayContaining(["payment_status"]) });
    expect(JSON.stringify(updated[0]!.data)).not.toMatch(/Mona|1001234821/);
    const timeline = (await rows("order_events")).filter((e) => e.order_id === orderId).map((e) => e.type);
    expect(timeline).toEqual(["created", "updated"]);
  });

  it("a store cancellation cancels a new order once; lines follow the store", async () => {
    const base = order({ externalId: "gid://shopify/Order/9200", number: "#9200", lines: [
      { externalLineId: "A", title: "A", quantity: 1, unitPrice: { amount: "100.00", currency: "EGP" } },
      { externalLineId: "B", title: "B", quantity: 1, unitPrice: { amount: "100.00", currency: "EGP" } },
    ] });
    const { orderId } = await projector.project(T, connectionId, base);
    await projector.project(T, connectionId, { ...base, cancelled: true, lines: [{ ...base.lines[0]!, quantity: 3 }] });
    await projector.project(T, connectionId, { ...base, cancelled: true, lines: [{ ...base.lines[0]!, quantity: 3 }] });
    const o = (await rows("orders")).find((x) => x.id === orderId)!;
    expect(o.status).toBe("cancelled");
    expect(o.cancelled_at).toBeInstanceOf(Date);
    expect((await events("order.cancelled")).filter((e) => e.entity_id === orderId)).toHaveLength(1);
    expect((await rows("order_lines")).filter((l) => l.order_id === orderId).map((l) => [l.external_line_id, l.quantity])).toEqual([["A", 3]]);
  });

  it("concurrent first use of a tenant's PII key creates exactly one key", async () => {
    const fresh = "eeeeeeee-0000-4000-8000-000000000005";
    await db.kysely.insertInto("tenants").values({ id: fresh, name: "F", slug: "fresh" }).execute();
    const c = await db.tenant(fresh, async (trx) => (await trx.insertInto("connections").values({ tenant_id: fresh, kind: "store", provider: "shopify", external_account: "f.myshopify.com" }).returning("id").executeTakeFirstOrThrow()).id);
    app.get(PiiCipher).forget(fresh);
    await Promise.all([1, 2, 3].map((i) => projector.project(fresh, c, order({ externalId: `gid://shopify/Order/F${i}`, number: `#F${i}` }))));
    const keys = await db.tenant(fresh, (trx) => trx.selectFrom("secrets").select("id").execute());
    expect(keys).toHaveLength(1);
    const settings = await sql<{ ref: string }>`SELECT settings->>'piiKeyRef' AS ref FROM tenants WHERE id = ${fresh}`.execute(db.kysely);
    expect(settings.rows[0]!.ref).toBe(keys[0]!.id);
  });
});
