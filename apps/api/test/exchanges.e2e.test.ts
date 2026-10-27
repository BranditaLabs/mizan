import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { EventDispatcher } from "../src/platform/events/dispatcher.js";
import { MessagingRegistry } from "../src/modules/confirmation/messaging.registry.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E10-2: an exchange from a delivered order — a replacement order linked both ways, the money
 * already paid moved as store credit (counted once), the difference collected or a refund due,
 * never more units than the order has, and returned once inspection covers the items.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
let black: string;
let blackM: string;
let scarf: string;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
const detail = async (id: string) => (await http().get(`/v1/orders/${id}`).set(as("owner")).expect(200)).body;
async function delivered(payment: object) {
  const r = await http().post("/v1/orders").set(as("owner")).send({
    source: "phone", customer: { name: "Mona Adel", phone: "01001234821" }, address: { line1: "12 Abbas El Akkad St", city: "Nasr City" },
    lines: [{ variantId: black, quantity: 2 }], shipping: "0", payment,
  }).expect(201);
  await drain();
  await db.tenant(store, (trx) => trx.updateTable("orders").set({ status: "delivered", confirmed_at: new Date(), shipped_at: new Date(), delivered_at: new Date() }).where("id", "=", r.body.id).execute());
  const line = await db.tenant(store, (trx) => trx.selectFrom("order_lines").select("id").where("order_id", "=", r.body.id).executeTakeFirstOrThrow());
  return { id: r.body.id as string, number: r.body.number as string, line: line.id };
}
const exchange = (body: object, token = "owner") => http().post("/v1/exchanges").set(as(token)).send(body);

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null);
  fake.add("owner", { uid: "fb-owner-exchange", email: "owner@exchange.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Exchanges", country: "EG" }).expect(201)).body.id;
  for (const [token, role, phone] of [["agent", "agent", "01201116661"], ["wh", "warehouse", "01201116662"]] as const) {
    const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone, role }).expect(201);
    fake.add(token, { uid: `fb-${token}-exchange`, phone: inv.body.phone });
    await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: `Bearer ${token}` }).expect(200);
  }
  ({ black, blackM, scarf } = await db.tenant(store, async (trx) => {
    const p = (await trx.insertInto("products").values({ tenant_id: store, title: "Abaya" }).returning("id").executeTakeFirstOrThrow()).id;
    const v = (sku: string, title: string, price: number) => trx.insertInto("variants").values({ tenant_id: store, product_id: p, sku, title, currency: "EGP", price_minor: price, cogs_minor: 40000, cogs_set_at: new Date() }).returning("id").executeTakeFirstOrThrow();
    return { black: (await v("AB-L", "Black / L", 125000)).id, blackM: (await v("AB-M", "Black / M", 125000)).id, scarf: (await v("SC-1", "Scarf", 15000)).id };
  }));
  await http().post("/v1/stock/movements").set(as("owner")).send({ items: [{ variantId: blackM, kind: "count", quantity: 5 }] }).expect(200);
});
afterAll(() => app.close());

describe("exchanges (E10-2)", () => {
  it("a replacement linked both ways; the paid money moves as store credit, the difference is collected", async () => {
    const o = await delivered({ mode: "prepaid", method: "card" }); // 2 × 1,250 paid
    const x = (await exchange({ orderId: o.id, items: [{ lineId: o.line, quantity: 1 }], lines: [{ variantId: blackM, quantity: 1 }], shipping: "50", reason: "wrong_size", note: "L was big" }, "agent").expect(201)).body;
    expect(x).toMatchObject({
      original: { id: o.id, number: o.number }, replacement: { number: `${o.number}-X1`, status: "confirmed" }, reason: "wrong_size", status: "awaiting_return",
      items: [{ lineId: o.line, title: "Abaya — Black / L", quantity: 1 }],
      returnedValue: { amount: "1250.00" }, credit: { amount: "1250.00" }, toCollect: { amount: "50.00" }, refundDue: { amount: "0.00" },
    });
    await drain();
    const r = await detail(x.replacement.id);
    expect(r).toMatchObject({ status: "confirmed", paid: { amount: "1250.00" }, cod: { amount: "50.00" }, paymentStatus: "partially_paid", stock: "reserved" });
    const orig = await detail(o.id);
    expect(orig).toMatchObject({ refunded: { amount: "1250.00" } });
    for (const d of [orig, r]) expect(d.events.map((e: { type: string }) => e.type)).toContain("exchange_created");
    const ledger = await db.tenant(store, (trx) => trx.selectFrom("payments").select(["order_id", "kind", "method", "amount_minor"]).where("method", "=", "store_credit").orderBy("amount_minor").execute());
    expect(ledger).toEqual([
      { order_id: o.id, kind: "refund", method: "store_credit", amount_minor: -125000n },
      { order_id: x.replacement.id, kind: "sale", method: "store_credit", amount_minor: 125000n },
    ]);
    // The customer asked for it: no confirmation run for the replacement.
    expect(await db.tenant(store, (trx) => trx.selectFrom("confirmation_runs").select("id").where("order_id", "=", x.replacement.id).execute())).toEqual([]);

    // A cheaper replacement: the credit covers it and the rest is a refund due.
    const y = (await exchange({ orderId: o.id, items: [{ lineId: o.line, quantity: 1 }], lines: [{ variantId: scarf, quantity: 1 }], reason: "changed_mind" }).expect(201)).body;
    expect(y).toMatchObject({ replacement: { number: `${o.number}-X2` }, credit: { amount: "150.00" }, toCollect: { amount: "0.00" }, refundDue: { amount: "1100.00" } });
    // Nothing left to exchange.
    const over = (await exchange({ orderId: o.id, items: [{ lineId: o.line, quantity: 1 }], lines: [{ variantId: blackM, quantity: 1 }], reason: "wrong_size" }).expect(409)).body;
    expect(over.code).toBe("over_quantity");

    const list = (await http().get(`/v1/orders/${o.id}/exchanges`).set(as("wh")).expect(200)).body;
    expect(list.outgoing.map((e: { id: string }) => e.id)).toEqual([x.id, y.id]);
    expect(list.exchangeOf).toBeNull();
    expect((await http().get(`/v1/orders/${x.replacement.id}/exchanges`).set(as("owner")).expect(200)).body.exchangeOf).toMatchObject({ id: x.id, original: { id: o.id } });

    // Inspection of what came back closes them, the earlier first.
    await http().post(`/v1/orders/${o.id}/returns/inspect`).set(as("wh")).send({ items: [{ lineId: o.line, quantity: 1, outcome: "restock" }] }).expect(200);
    await drain();
    let after = (await http().get(`/v1/orders/${o.id}/exchanges`).set(as("owner")).expect(200)).body.outgoing;
    expect(after.map((e: { status: string }) => e.status)).toEqual(["returned", "awaiting_return"]);
    await http().post(`/v1/orders/${o.id}/returns/inspect`).set(as("wh")).send({ items: [{ lineId: o.line, quantity: 1, outcome: "damaged" }] }).expect(200);
    await drain();
    after = (await http().get(`/v1/orders/${o.id}/exchanges`).set(as("owner")).expect(200)).body.outgoing;
    expect(after.map((e: { status: string }) => e.status)).toEqual(["returned", "returned"]);
    const ev = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select("type").where("type", "in", ["exchange.created", "exchange.returned"]).execute());
    expect(ev.map((e) => e.type).sort()).toEqual(["exchange.created", "exchange.created", "exchange.returned", "exchange.returned"]);
    expect(await db.tenant(store, (trx) => trx.selectFrom("audit_log").select("action").where("action", "=", "exchange.created").execute())).toHaveLength(2);
  });

  it("an unpaid delivered order exchanges with no credit; only delivered orders, by the team that handles customers", async () => {
    const cod = await delivered({ mode: "cod" }); // delivered, the courier's cash not recorded
    const x = (await exchange({ orderId: cod.id, items: [{ lineId: cod.line, quantity: 1 }], lines: [{ variantId: blackM, quantity: 1 }], reason: "wrong_size" }).expect(201)).body;
    expect(x).toMatchObject({ credit: { amount: "0.00" }, toCollect: { amount: "1250.00" } });

    const open = await http().post("/v1/orders").set(as("owner")).send({
      source: "phone", customer: { name: "Mona Adel", phone: "01001234821" }, address: { line1: "12 Abbas El Akkad St", city: "Nasr City" },
      lines: [{ variantId: black, quantity: 1 }], shipping: "0", payment: { mode: "cod" },
    }).expect(201);
    const line = await db.tenant(store, (trx) => trx.selectFrom("order_lines").select("id").where("order_id", "=", open.body.id).executeTakeFirstOrThrow());
    expect((await exchange({ orderId: open.body.id, items: [{ lineId: line.id, quantity: 1 }], lines: [{ variantId: blackM, quantity: 1 }], reason: "wrong_size" }).expect(409)).body.code).toBe("not_delivered");
    await exchange({ orderId: cod.id, items: [{ lineId: cod.line, quantity: 1 }], lines: [{ variantId: blackM, quantity: 1 }], reason: "wrong_size" }, "wh").expect(403);
    await exchange({ orderId: cod.id, items: [{ lineId: "00000000-0000-4000-8000-000000000000", quantity: 1 }], lines: [{ variantId: blackM, quantity: 1 }], reason: "wrong_size" }).expect(422);
  });
});
