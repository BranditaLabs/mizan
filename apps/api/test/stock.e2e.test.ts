import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import type { CanonicalProduct } from "@mizan/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { EventDispatcher } from "../src/platform/events/dispatcher.js";
import { EventsService } from "../src/platform/events/events.service.js";
import { ProductProjector } from "../src/modules/catalog/product-projector.js";
import { MessagingRegistry } from "../src/modules/confirmation/messaging.registry.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E8-2: stock. Counted items are reserved when an order is confirmed, released when it is
 * cancelled and leave on hand when it ships. An order that would oversell waits and is reserved
 * when stock arrives. Every level is the sum of its ledger.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
let abaya: string;
let scarf: string;
let n = 0;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
const move = (items: object[], status = 200) => http().post("/v1/stock/movements").set(as("owner")).send({ items }).expect(status).then((r) => r.body);
const level = async (variantId: string) => (await http().get(`/v1/stock?search=${variantId === abaya ? "ABY" : "SCF"}`).set(as("owner")).expect(200)).body.data[0];
const stockOf = (orderId: string) => db.tenant(store, (trx) => trx.selectFrom("orders").select("stock_status").where("id", "=", orderId).executeTakeFirstOrThrow()).then((o) => o.stock_status);
async function order(lines: Array<{ variantId: string; quantity: number }>, confirm = true): Promise<string> {
  n++;
  const r = await http().post("/v1/orders").set(as("owner")).send({
    source: "phone", customer: { name: "Mona Adel", phone: `0100${String(2000000 + n)}` }, address: { line1: "12 Abbas El Akkad St", city: "Nasr City" },
    lines, payment: { mode: "cod" },
  }).expect(201);
  await drain();
  if (confirm) {
    await http().post(`/v1/orders/${r.body.id}/confirmation`).set(as("owner")).send({ answer: "confirm", byCall: true }).expect(200);
    await drain();
  }
  return r.body.id;
}
const ledgerSum = (variantId: string) => db.tenant(store, async (trx) => {
  const rows = await trx.selectFrom("stock_movements").select(["reason", "delta"]).where("variant_id", "=", variantId).execute();
  return {
    onHand: rows.filter((r) => r.reason !== "reserve" && r.reason !== "release").reduce((a, r) => a + r.delta, 0),
    reserved: rows.filter((r) => r.reason === "reserve" || r.reason === "release").reduce((a, r) => a + r.delta, 0),
  };
});

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null);
  fake.add("owner", { uid: "fb-owner-stock", email: "owner@stock.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Stock", country: "EG" }).expect(201)).body.id;
  await http().put("/v1/settings/orders").set(as("owner")).send({ duplicateWindowHours: 0 }).expect(200);
  const connectionId = await db.tenant(store, async (trx) => (await trx.insertInto("connections")
    .values({ tenant_id: store, kind: "store", provider: "shopify", external_account: "nile-stock.myshopify.com" }).returning("id").executeTakeFirstOrThrow()).id);
  const at = new Date().toISOString();
  const product = (id: string, title: string, sku: string, price: string): CanonicalProduct => ({
    connector: "shopify", externalId: `gid://shopify/Product/${id}`, title, status: "active", tags: [], updatedAt: at,
    variants: [{ externalId: `gid://shopify/ProductVariant/${id}1`, sku, title: "Default Title", price: { amount: price, currency: "EGP" }, available: 50 }],
  });
  await app.get(ProductProjector).project(store, connectionId, product("1", "Abaya", "ABY-1", "1150.00"));
  await app.get(ProductProjector).project(store, connectionId, product("2", "Scarf", "SCF-1", "150.00"));
  const ids = await db.tenant(store, (trx) => trx.selectFrom("variants").select(["id", "sku"]).execute());
  abaya = ids.find((v) => v.sku === "ABY-1")!.id;
  scarf = ids.find((v) => v.sku === "SCF-1")!.id;
  const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone: "01201118888", role: "agent" }).expect(201);
  fake.add("agent", { uid: "fb-agent-stock", phone: inv.body.phone });
  await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: "Bearer agent" }).expect(200);
});
afterAll(() => app.close());

describe("stock (E8-2)", () => {
  let first: string;
  let second: string;

  it("counts stock; a confirmed order reserves counted items and leaves the rest to the store", async () => {
    expect((await level(abaya))).toMatchObject({ sku: "ABY-1", counted: false, onHand: null, available: null, storeAvailable: 50 });
    const r = await move([{ variantId: abaya, kind: "count", quantity: 5 }]);
    expect(r).toMatchObject({ applied: 1, levels: [{ variantId: abaya, onHand: 5, reserved: 0, available: 5 }] });

    first = await order([{ variantId: abaya, quantity: 2 }, { variantId: scarf, quantity: 1 }]);
    expect(await level(abaya)).toMatchObject({ counted: true, onHand: 5, reserved: 2, available: 3 });
    expect(await stockOf(first)).toBe("reserved");
    expect((await http().get(`/v1/orders/${first}`).set(as("owner")).expect(200)).body.stock).toBe("reserved");

    // A repeated event changes nothing.
    await app.get(EventDispatcher).runOnce();
    await db.tenant(store, (trx) => app.get(EventsService).emit(trx, { type: "order.updated", tenantId: store, entity: { type: "order", id: first }, actor: { type: "system" }, data: {} }));
    await drain();
    expect(await level(abaya)).toMatchObject({ reserved: 2 });
  });

  it("an order that would oversell waits, and is reserved when stock arrives", async () => {
    second = await order([{ variantId: abaya, quantity: 4 }]);
    expect(await stockOf(second)).toBe("short");
    expect(await level(abaya)).toMatchObject({ reserved: 2, available: 3 }); // nothing taken
    const list = (await http().get("/v1/orders?stock=short").set(as("owner")).expect(200)).body;
    expect(list.data.map((o: { id: string }) => o.id)).toEqual([second]);
    expect(list.waitingStock).toBe(1);
    expect((await http().get("/v1/stock").set(as("owner")).expect(200)).body.counts).toMatchObject({ variants: 2, counted: 1, waitingOrders: 1 });

    const r = await move([{ variantId: abaya, kind: "receive", quantity: 2 }]);
    expect(r).toMatchObject({ applied: 1, ordersReserved: 1, levels: [{ onHand: 7, reserved: 6, available: 1 }] });
    expect(await stockOf(second)).toBe("reserved");
    const short = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select("type").where("entity_id", "=", second).where("type", "like", "stock.%").orderBy("occurred_at").execute());
    expect(short.map((e) => e.type)).toEqual(["stock.short", "stock.reserved"]);
  });

  it("cancel releases; shipping takes the items off the shelf; stock never goes under what orders hold", async () => {
    await http().post("/v1/orders/bulk").set(as("owner")).send({ action: "cancel", orderIds: [first], reason: "customer_cancelled" }).expect(202);
    await drain();
    expect(await level(abaya)).toMatchObject({ onHand: 7, reserved: 4, available: 3 });
    expect(await stockOf(first)).toBeNull();

    const below = await move([{ variantId: abaya, kind: "count", quantity: 3 }], 422);
    expect(below).toMatchObject({ code: "below_reserved", errors: [{ path: "items.0.quantity", code: "below_reserved" }] });
    expect((await move([{ variantId: abaya, kind: "adjust", quantity: -1 }], 422)).code).toBe("validation_failed"); // a reason is required
    await move([{ variantId: abaya, kind: "adjust", quantity: -1, reason: "damaged" }]);

    await db.tenant(store, async (trx) => {
      await trx.updateTable("orders").set({ status: "shipped" }).where("id", "=", second).execute();
      await app.get(EventsService).emit(trx, { type: "order.updated", tenantId: store, entity: { type: "order", id: second }, actor: { type: "system" }, data: {} });
    });
    await drain();
    expect(await level(abaya)).toMatchObject({ onHand: 2, reserved: 0, available: 2 });
    expect(await ledgerSum(abaya)).toEqual({ onHand: 2, reserved: 0 }); // every number is its ledger

    const history = (await http().get(`/v1/stock/${abaya}/movements`).set(as("owner")).expect(200)).body.data;
    expect(history.map((h: { kind: string; delta: number }) => `${h.kind}${h.delta}`)).toEqual(["pick-4", "release-4", "adjust-1", "release-2", "reserve4", "receive2", "reserve2", "count5"]);
    expect(history.find((h: { kind: string }) => h.kind === "adjust")).toMatchObject({ reason: "damaged" });
    expect(history.find((h: { kind: string }) => h.kind === "pick").order).toMatchObject({ id: second });
  });

  it("counting an item for the first time reserves it for confirmed orders already waiting", async () => {
    const third = await order([{ variantId: scarf, quantity: 3 }]);
    expect(await stockOf(third)).toBe("untracked");
    const r = await move([{ variantId: scarf, kind: "count", quantity: 10 }]);
    expect(r.ordersReserved).toBe(1);
    expect(await level(scarf)).toMatchObject({ onHand: 10, reserved: 3, available: 7 });
    expect(await stockOf(third)).toBe("reserved");
  });

  it("refuses other roles and unknown variants", async () => {
    await http().get("/v1/stock").set(as("agent")).expect(403);
    await http().post("/v1/stock/movements").set(as("agent")).send({ items: [{ variantId: abaya, kind: "receive", quantity: 1 }] }).expect(403);
    await move([{ variantId: "33333333-3333-4333-8333-333333333333", kind: "receive", quantity: 1 }], 404);
    await http().get("/v1/stock/33333333-3333-4333-8333-333333333333/movements").set(as("owner")).expect(404);
  });
});
