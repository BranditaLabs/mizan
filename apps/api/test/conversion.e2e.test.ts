import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { EventDispatcher } from "../src/platform/events/dispatcher.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E14-3: COD to prepaid conversion. An offer (all, or a deposit) on a COD order with where to pay
 * and the message to send; recording the payment marks it paid through the ledger event, the
 * courier's cash drops, and a shipment booked with the old cash goes to review.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
let n = 0;
async function codOrder(total = "1250") {
  const r = await http().post("/v1/orders").set(as("owner")).send({
    source: "phone", customer: { name: "Mona Adel", phone: `0100200${String(++n).padStart(4, "0")}` }, address: { line1: "12 Abbas El Akkad St", city: "Cairo" },
    lines: [{ title: "Abaya", quantity: 1, unitPrice: total }], shipping: "0", payment: { mode: "cod" },
  }).expect(201);
  await drain();
  await db.tenant(store, (trx) => trx.updateTable("orders").set({ status: "confirmed", confirmed_at: new Date() }).where("id", "=", r.body.id).execute());
  return r.body as { id: string; number: string };
}
const conversion = async (id: string) => (await http().get(`/v1/orders/${id}/conversion`).set(as("owner")).expect(200)).body;

beforeAll(async () => {
  app = await createApp(loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" }), { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  fake.add("owner", { uid: "fb-owner-cv", email: "owner@cv.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Conversion", country: "EG" }).expect(201)).body.id;
  for (const [name, phone, role] of [["agent", "01201116661", "agent"], ["keeper", "01201116662", "warehouse"]] as const) {
    const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone, role }).expect(201);
    fake.add(name, { uid: `fb-${name}-cv`, phone: inv.body.phone });
    await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: `Bearer ${name}` }).expect(200);
  }
});
afterAll(() => app.close());

describe("COD to prepaid conversion (E14-3)", () => {
  it("needs where to pay; a deposit is offered with the message, paid through the ledger, and the courier's cash drops", async () => {
    const o = await codOrder();
    const before = await conversion(o.id);
    expect(before).toMatchObject({ eligible: true, reason: null, owed: { amount: "1250.00" }, deposit: { amount: "375.00" }, methods: [], current: null, message: null });
    expect((await http().post(`/v1/orders/${o.id}/conversion`).set(as("agent")).send({ purpose: "full", method: "instapay" }).expect(422)).body.code).toBe("no_instructions");
    await http().put("/v1/settings/conversion").set(as("agent")).send({ methods: { instapay: "nile@instapay" } }).expect(403);
    expect((await http().put("/v1/settings/conversion").set(as("owner")).send({ depositPct: 20, methods: { instapay: "nile@instapay", wallet: "01009998888" } }).expect(200)).body)
      .toEqual({ depositPct: 20, expiresHours: 24, methods: { instapay: "nile@instapay", wallet: "01009998888" } });
    await http().post(`/v1/orders/${o.id}/conversion`).set(as("keeper")).send({ purpose: "deposit", method: "instapay" }).expect(403);
    const offered = (await http().post(`/v1/orders/${o.id}/conversion`).set(as("agent")).send({ purpose: "deposit", method: "instapay" }).expect(201)).body;
    expect(offered).toMatchObject({ deposit: { amount: "250.00" }, methods: ["instapay", "wallet"], current: { purpose: "deposit", method: "instapay", status: "open", amount: { amount: "250.00" }, instructions: "nile@instapay", source: "manual" } });
    expect(offered.message.en).toContain("Pay 250.00 EGP now by InstaPay: nile@instapay");
    expect(offered.message.en).toContain("(the rest, 1000.00 EGP, on delivery)");
    expect(offered.message.ar).toContain("إنستاباي");
    expect((await http().post(`/v1/orders/${o.id}/conversion`).set(as("agent")).send({ purpose: "full", method: "wallet" }).expect(409)).body.code).toBe("offer_open");

    // The customer paid on InstaPay; the team records it in the ledger.
    await http().post(`/v1/orders/${o.id}/payments`).set(as("owner")).send({ type: "received", method: "instapay", amount: "250" }).expect(201);
    await drain();
    const paid = await conversion(o.id);
    expect(paid).toMatchObject({ owed: { amount: "1000.00" }, current: { status: "paid" }, message: null });
    const order = await db.tenant(store, (trx) => trx.selectFrom("orders").select(["cod_minor", "paid_minor", "payment_mode"]).where("id", "=", o.id).executeTakeFirstOrThrow());
    expect([Number(order.cod_minor), Number(order.paid_minor), order.payment_mode]).toEqual([100000, 25000, "cod"]);
    const events = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select("type").where("entity_id", "=", o.id).where("type", "like", "payment.link%").execute());
    expect(events.map((e) => e.type).sort()).toEqual(["payment.link_paid", "payment.link_sent"]);
  });

  it("a shipment already booked with the old cash goes to review once the customer pays in full", async () => {
    const o = await codOrder("800");
    await http().post(`/v1/orders/${o.id}/conversion`).set(as("owner")).send({ purpose: "full", method: "wallet" }).expect(201);
    const shipment = (await http().post(`/v1/orders/${o.id}/ship/manual`).set(as("owner")).send({ courier: "J&T Express", trackingNumber: "JT-CV-1" }).expect(201)).body;
    expect(shipment.cod).toMatchObject({ amount: "800.00" });
    await http().post(`/v1/orders/${o.id}/payments`).set(as("owner")).send({ type: "received", method: "wallet", amount: "800" }).expect(201);
    await drain();
    expect((await conversion(o.id)).current.status).toBe("paid");
    const s = await db.tenant(store, (trx) => trx.selectFrom("shipments").select(["needs_review", "cod_minor"]).where("id", "=", shipment.id).executeTakeFirstOrThrow());
    expect(s.needs_review).toBe(true);
    const review = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select("data").where("type", "=", "shipment.needs_review").where("entity_id", "=", shipment.id).executeTakeFirstOrThrow());
    expect(review.data).toMatchObject({ reason: "cod_changed", fromMinor: "80000", toMinor: "0" });
  });

  it("an offer is cancelled or expires; only COD orders with something owed qualify", async () => {
    const o = await codOrder("500");
    await http().post(`/v1/orders/${o.id}/conversion`).set(as("owner")).send({ purpose: "deposit", amount: "600", method: "wallet" }).expect(422);
    await http().post(`/v1/orders/${o.id}/conversion`).set(as("owner")).send({ purpose: "deposit", amount: "100", method: "wallet" }).expect(201);
    expect((await http().post(`/v1/orders/${o.id}/conversion/cancel`).set(as("owner")).expect(200)).body.current.status).toBe("cancelled");
    expect((await http().post(`/v1/orders/${o.id}/conversion/cancel`).set(as("owner")).expect(409)).body.code).toBe("no_open_offer");
    // An offer past its time no longer blocks a new one.
    await http().post(`/v1/orders/${o.id}/conversion`).set(as("owner")).send({ purpose: "full", method: "instapay" }).expect(201);
    await db.tenant(store, (trx) => trx.updateTable("payment_links").set({ expires_at: new Date(Date.now() - 60_000) }).where("order_id", "=", o.id).where("status", "=", "open").execute());
    expect((await conversion(o.id)).current.status).toBe("expired");
    await http().post(`/v1/orders/${o.id}/conversion`).set(as("owner")).send({ purpose: "full", method: "instapay" }).expect(201);

    const prepaid = (await http().post("/v1/orders").set(as("owner")).send({
      source: "phone", customer: { name: "Sara Nabil", phone: "01009997777" }, address: { line1: "5 Makram Ebeid", city: "Cairo" },
      lines: [{ title: "Scarf", quantity: 1, unitPrice: "300" }], shipping: "0", payment: { mode: "prepaid", method: "wallet" },
    }).expect(201)).body;
    await drain();
    expect(await conversion(prepaid.id)).toMatchObject({ eligible: false, reason: "not_cod" });
    expect((await http().post(`/v1/orders/${prepaid.id}/conversion`).set(as("owner")).send({ purpose: "full", method: "instapay" }).expect(409)).body.code).toBe("not_cod");
  });

  it("the automation action makes the offer and tells the team to send it", async () => {
    const created = (await http().post("/v1/automations").set(as("owner")).send({
      name: "COD rescue", trigger: "order.confirmed", steps: [{ action: "order.convert_to_prepaid", params: { purpose: "deposit", method: "instapay" } }],
    }).expect(201)).body;
    await http().patch(`/v1/automations/${created.id}`).set(as("owner")).send({ enabled: true }).expect(200);
    const o = await codOrder("1000");
    // The automation reacts to the order's confirmation event.
    await db.tenant(store, async (trx) => {
      const { EventsService } = await import("../src/platform/events/events.service.js");
      await app.get(EventsService).emit(trx, { type: "order.confirmed", tenantId: store, entity: { type: "order", id: o.id }, actor: { type: "system" }, data: { number: o.number } });
    });
    await drain();
    const c = await conversion(o.id);
    expect(c.current).toMatchObject({ purpose: "deposit", status: "open", amount: { amount: "200.00" }, source: "automation" });
    const notes = await db.tenant(store, (trx) => trx.selectFrom("notifications").select("text").where("entity_id", "=", o.id).execute());
    expect(notes.map((x) => x.text)).toEqual([`${o.number}: send the customer the payment message (order → Convert to prepaid)`]);
  });
});
