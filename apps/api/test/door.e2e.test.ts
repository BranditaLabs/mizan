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
 * E10-4: what happened at the door. A partial delivery: delivered, the customer owes for what they
 * kept, the courier's cash in the ledger, a deposit beyond it is a refund due, the rest is inspected
 * when it comes back. A refusal: its reason and whether the box was opened.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
let abaya: string;
let scarf: string;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
const detail = async (id: string) => (await http().get(`/v1/orders/${id}`).set(as("owner")).expect(200)).body;
async function shipped(payment: object) {
  const r = await http().post("/v1/orders").set(as("owner")).send({
    source: "phone", customer: { name: "Mona Adel", phone: "01001234821" }, address: { line1: "12 Abbas El Akkad St", city: "Nasr City" },
    lines: [{ variantId: abaya, quantity: 2 }, { variantId: scarf, quantity: 1 }], shipping: "50", payment,
  }).expect(201);
  await drain();
  await db.tenant(store, (trx) => trx.updateTable("orders").set({ status: "shipped", confirmed_at: new Date(), shipped_at: new Date() }).where("id", "=", r.body.id).execute());
  const lines = await db.tenant(store, (trx) => trx.selectFrom("order_lines").select(["id", "variant_id"]).where("order_id", "=", r.body.id).execute());
  return { id: r.body.id as string, abayaLine: lines.find((l) => l.variant_id === abaya)!.id, scarfLine: lines.find((l) => l.variant_id === scarf)!.id };
}
const partial = (id: string, body: object, token = "wh") => http().post(`/v1/orders/${id}/partial-delivery`).set(as(token)).send(body);
const refusal = (id: string, body: object, token = "agent") => http().post(`/v1/orders/${id}/refusal`).set(as(token)).send(body);

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null);
  fake.add("owner", { uid: "fb-owner-door", email: "owner@door.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Door", country: "EG" }).expect(201)).body.id;
  for (const [token, role, phone] of [["agent", "agent", "01201117771"], ["wh", "warehouse", "01201117772"]] as const) {
    const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone, role }).expect(201);
    fake.add(token, { uid: `fb-${token}-door`, phone: inv.body.phone });
    await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: `Bearer ${token}` }).expect(200);
  }
  ({ abaya, scarf } = await db.tenant(store, async (trx) => {
    const p = (await trx.insertInto("products").values({ tenant_id: store, title: "Abaya" }).returning("id").executeTakeFirstOrThrow()).id;
    const v = (sku: string, title: string, price: number) => trx.insertInto("variants").values({ tenant_id: store, product_id: p, sku, title, currency: "EGP", price_minor: price, cogs_minor: 40000, cogs_set_at: new Date() }).returning("id").executeTakeFirstOrThrow();
    return { abaya: (await v("AB-L", "Black / L", 125000)).id, scarf: (await v("SC-1", "Scarf", 15000)).id };
  }));
});
afterAll(() => app.close());

describe("partial delivery (E10-4)", () => {
  it("COD: delivered, the customer owes for what they kept, the courier's cash in the ledger, the rest comes back", async () => {
    const o = await shipped({ mode: "cod" }); // 2 × 1,250 + 150 + 50 shipping = 2,700
    const r = (await partial(o.id, { kept: [{ lineId: o.abayaLine, quantity: 1 }, { lineId: o.scarfLine, quantity: 1 }], note: "One didn't fit" }).expect(200)).body;
    expect(r).toMatchObject({
      status: "delivered", due: { amount: "1450.00" }, collected: { amount: "1450.00" }, refundDue: { amount: "0.00" },
      comingBack: [{ lineId: o.abayaLine, title: "Abaya — Black / L", quantity: 1 }],
    });
    await drain();
    const d = await detail(o.id);
    expect(d).toMatchObject({ status: "delivered", paid: { amount: "1450.00" }, balance: { amount: "0.00" }, cod: { amount: "0.00" }, paymentStatus: "paid", partialDelivery: { due: { amount: "1450.00" } } });
    expect(d.events.map((e: { type: string }) => e.type)).toContain("partially_delivered");
    expect((await http().get(`/v1/orders/${o.id}/pnl`).set(as("owner")).expect(200)).body).toMatchObject({ revenue: { amount: "1450.00" } });
    // What came back is inspected like any return.
    await http().post(`/v1/orders/${o.id}/returns/inspect`).set(as("wh")).send({ items: [{ lineId: o.abayaLine, quantity: 1, outcome: "restock" }] }).expect(200);
    expect((await partial(o.id, { kept: [{ lineId: o.scarfLine, quantity: 1 }] }).expect(409)).body.code).toBe("already_recorded");
    const ev = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select("type").where("entity_id", "=", o.id).where("type", "=", "order.partially_delivered").execute());
    expect(ev).toHaveLength(1);
  });

  it("a deposit beyond what they kept is a refund due; nothing to collect", async () => {
    const o = await shipped({ mode: "partial", method: "wallet", paid: "2000" });
    const r = (await partial(o.id, { kept: [{ lineId: o.scarfLine, quantity: 1 }] }).expect(200)).body;
    expect(r).toMatchObject({ due: { amount: "200.00" }, collected: { amount: "0.00" }, refundDue: { amount: "1800.00" } });
    expect(await detail(o.id)).toMatchObject({ cod: { amount: "0.00" }, balance: { amount: "0.00" }, paymentStatus: "paid" });
  });

  it("refuses what doesn't add up", async () => {
    const o = await shipped({ mode: "cod" });
    expect((await partial(o.id, { kept: [{ lineId: o.abayaLine, quantity: 2 }, { lineId: o.scarfLine, quantity: 1 }] }).expect(422)).body.code).toBe("nothing_returned");
    expect((await partial(o.id, { kept: [{ lineId: o.abayaLine, quantity: 3 }] }).expect(409)).body.code).toBe("over_quantity");
    expect((await partial(o.id, { kept: [{ lineId: o.abayaLine, quantity: 1 }], collected: "5000" }).expect(409)).body.code).toBe("over_collected");
    await partial(o.id, { kept: [{ lineId: o.abayaLine, quantity: 1 }] }, "agent").expect(403);
    await db.tenant(store, (trx) => trx.updateTable("orders").set({ status: "confirmed" }).where("id", "=", o.id).execute());
    expect((await partial(o.id, { kept: [{ lineId: o.abayaLine, quantity: 1 }] }).expect(409)).body.code).toBe("not_shipped");
  });
});

describe("refused at the door (E10-4)", () => {
  it("records the reason and whether the box was opened, apart from plain RTO; a later call corrects it", async () => {
    const o = await shipped({ mode: "cod" });
    const r = (await refusal(o.id, { reason: "changed_mind", openBox: true }).expect(200)).body;
    expect(r).toMatchObject({ reason: "changed_mind", openBox: true });
    await db.tenant(store, (trx) => trx.updateTable("orders").set({ status: "returned" }).where("id", "=", o.id).execute());
    await refusal(o.id, { reason: "not_as_described", openBox: true, note: "Said the colour was off" }).expect(200);
    expect((await detail(o.id)).refusal).toMatchObject({ reason: "not_as_described", openBox: true });
    const ev = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select("data").where("entity_id", "=", o.id).where("type", "=", "order.refused").orderBy("occurred_at").execute());
    expect(ev.map((e) => (e.data as { reason: string }).reason)).toEqual(["changed_mind", "not_as_described"]);
    await refusal(o.id, { reason: "bored", openBox: false }).expect(422);
    const done = await shipped({ mode: "cod" });
    await db.tenant(store, (trx) => trx.updateTable("orders").set({ status: "delivered" }).where("id", "=", done.id).execute());
    expect((await refusal(done.id, { reason: "price", openBox: false }).expect(409)).body.code).toBe("not_shipped");
  });
});
