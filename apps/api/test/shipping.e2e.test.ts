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
import { SecretsService } from "../src/platform/secrets/secrets.service.js";
import { EngineJobRunner } from "../src/integrations/engine-runner.js";
import { MessagingRegistry } from "../src/modules/confirmation/messaging.registry.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E7-1 through the real API, worker and engine against fake Shopify and Bosta: a confirmed order
 * (typed by the team, or the store's) is booked once with the cash still owed; the order becomes
 * shipped with its tracking number; refusals (payment, status, an unknown city) say why.
 */
const clock = new FakeClock();
const shop = new FakeShopify(clock, seeded(21));
const bosta = new FakeBosta(clock, seeded(22));
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", ...(store ? { "X-Tenant-Id": store } : {}) });
const drainEvents = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
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
async function manual(payment: object, city = "Cairo") {
  const r = await http().post("/v1/orders").set(as("owner")).send({
    source: "phone", customer: { name: "Mona Adel", phone: "01001234821" }, address: { line1: "12 Abbas El Akkad St", city },
    lines: [{ title: "Abaya", quantity: 1, unitPrice: "1250" }], shipping: "0", payment,
  }).expect(201);
  await drainEvents();
  return r.body.id as string;
}
const confirm = (id: string) => db.tenant(store, (trx) => trx.updateTable("orders").set({ status: "confirmed", confirmed_at: new Date() }).where("id", "=", id).execute());
const ship = (id: string, token = "owner") => http().post(`/v1/orders/${id}/ship`).set(as(token));
const detail = async (id: string) => (await http().get(`/v1/orders/${id}`).set(as("owner")).expect(200)).body;

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "http://localhost:3000", SHOPIFY_API_SECRET: shop.secret, BOSTA_BASE_URL: bosta.baseUrl });
  app = await createApp(config, {
    logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake,
    engineRuntime: () => testRuntime(clock, { [shop.host]: shop.handler, [bosta.host]: bosta.handler }, seeded(23)),
  });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null);
  fake.add("owner", { uid: "fb-owner-ship", email: "owner@ship.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set(as("owner")).send({ name: "Nile Shipping", country: "EG" }).expect(201)).body.id;
  for (const [token, role, phone] of [["wh", "warehouse", "01201115551"], ["agent", "agent", "01201115552"]] as const) {
    const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone, role }).expect(201);
    fake.add(token, { uid: `fb-${token}-ship`, phone: inv.body.phone });
    await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: `Bearer ${token}` }).expect(200);
  }
  // What the Shopify claim does (E3-1), then the courier key through the API (checked in the background).
  await db.tenant(store, async (trx) => {
    const ref = await app.get(SecretsService).create(trx, store, JSON.stringify({ accessToken: "shpat_fake_token" }), { actor: { type: "system" } });
    const id = (await trx.insertInto("connections").values({ tenant_id: store, kind: "store", provider: "shopify", external_account: shop.host, secret_ref: ref }).returning("id").executeTakeFirstOrThrow()).id;
    await app.get(EventsService).emit(trx, { type: "connection.connected", tenantId: store, entity: { type: "connection", id }, data: { provider: "shopify", kind: "store", reconnected: false }, actor: { type: "user" } });
  });
  await runJobs();
  await http().post("/v1/connections/bosta").set(as("owner")).send({ apiKey: bosta.apiKey }).expect(201);
  await runJobs();
});
afterAll(() => app.close());

describe("shipping (E7-1)", () => {
  it("books a confirmed order once with the cash owed; the order is shipped with its tracking number", async () => {
    const id = await manual({ mode: "partial", method: "wallet", paid: "250" });
    await confirm(id);
    const first = (await ship(id, "wh").expect(202)).body;
    expect(first).toMatchObject({ orderId: id, provider: "bosta", booking: "pending", trackingNumber: null, cod: { amount: "1000.00", currency: "EGP" }, error: null });
    const again = (await ship(id).expect(200)).body; // asked twice (a double click): the same booking
    expect(again.id).toBe(first.id);
    // The job carries ids only: the address and phone are read when it runs.
    const jobs = await db.tenant(store, (trx) => trx.selectFrom("mz_outbox").select(["kind", "payload"]).where("kind", "=", "bosta.ship").execute());
    expect(jobs).toHaveLength(1);
    expect(JSON.stringify(jobs[0]!.payload)).not.toMatch(/0100|Abbas|Mona/);

    await runJobs();
    const d = [...bosta.deliveries.values()].find((x) => x.businessReference === first.id)!;
    expect(d).toMatchObject({ cod: 1000, dropOffAddress: expect.objectContaining({ city: "Cairo", firstLine: "12 Abbas El Akkad St" }) });
    const o = await detail(id);
    expect(o.status).toBe("shipped");
    expect(o.timestamps.shippedAt).toEqual(expect.any(String));
    expect(o.shipments).toEqual([expect.objectContaining({ id: first.id, booking: "booked", trackingNumber: d.trackingNumber, status: "pickup_requested", errorCode: null, cod: { amount: "1000.00", currency: "EGP" } })]);
    expect(o.events.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(["ship_requested", "shipped"]));
    const ev = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select(["type", "data"]).where("type", "=", "shipment.created").execute());
    expect(ev.map((e) => (e.data as { trackingNumber: string }).trackingNumber)).toContain(d.trackingNumber);
    const audit = await db.tenant(store, (trx) => trx.selectFrom("audit_log").select("action").where("entity_id", "=", id).where("action", "=", "shipment.requested").execute());
    expect(audit).toHaveLength(1);
    await ship(id).expect(200); // shipped: still the same booking, never a second delivery
    expect([...bosta.deliveries.values()].filter((x) => x.businessReference === first.id)).toHaveLength(1);
  });

  it("a store's order is fulfilled in Shopify with the tracking number", async () => {
    const o = shop.addOrder({ name: "#2001" });
    const wh = shop.webhook("orders/create", o);
    await http().post(`/webhooks/shopify/${(await db.tenant(store, (trx) => trx.selectFrom("connections").select("id").where("provider", "=", "shopify").executeTakeFirstOrThrow())).id}`).set(wh.headers).send(wh.body);
    await runJobs();
    const row = await db.tenant(store, (trx) => trx.selectFrom("orders").select("id").where("number", "=", "#2001").executeTakeFirstOrThrow());
    await confirm(row.id);
    await ship(row.id).expect(202);
    await runJobs();
    const s = (await detail(row.id)).shipments[0];
    expect(s).toMatchObject({ booking: "booked", trackingNumber: expect.any(String) });
    expect(shop.orders.get(o.id)!.fulfillments[0]!.trackingInfo[0]).toMatchObject({ number: s.trackingNumber });
  });

  it("refuses what must not ship, and says why a booking failed", async () => {
    const open = await manual({ mode: "cod" });
    expect((await ship(open).expect(409)).body.code).toBe("not_confirmed");
    const transfer = await manual({ mode: "bank_transfer" });
    await confirm(transfer);
    const blocked = (await ship(transfer).expect(409)).body;
    expect(blocked).toMatchObject({ code: "payment_blocks_shipping", errors: [expect.objectContaining({ code: "awaiting_payment" })] });
    const prepaid = await manual({ mode: "prepaid", method: "card" });
    await confirm(prepaid);
    const p = (await ship(prepaid).expect(202)).body;
    expect(p.cod).toEqual({ amount: "0.00", currency: "EGP" });

    const far = await manual({ mode: "cod" }, "Atlantis");
    await confirm(far);
    await ship(far).expect(202);
    await runJobs();
    const o = await detail(far);
    expect(o.status).toBe("confirmed");
    expect(o.shipments[0]).toMatchObject({ booking: "failed", errorCode: "city_unknown", trackingNumber: null });
    const ev = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select("type").where("type", "=", "shipment.booking_failed").execute());
    expect(ev).toHaveLength(1);
    // Fixed city or not, a failed booking can be asked again.
    expect((await ship(far).expect(202)).body.booking).toBe("pending");

    await ship(open, "agent").expect(403);
    await http().post("/v1/orders/00000000-0000-4000-8000-000000000000/ship").set(as("owner")).expect(404);
  });

  it("the courier's statuses move the shipment and the order; an unmapped one waits for a person (E7-3)", async () => {
    const id = await manual({ mode: "cod" });
    await confirm(id);
    const shipped = (await ship(id).expect(202)).body;
    await runJobs();
    const tn = (await detail(id)).shipments[0].trackingNumber as string;
    const courier = await db.tenant(store, (trx) => trx.selectFrom("connections").select(["id", "secret_ref"]).where("provider", "=", "bosta").executeTakeFirstOrThrow());
    const token = (JSON.parse((await db.tenant(store, (trx) => app.get(SecretsService).read(trx, store, courier.secret_ref!))).reveal()) as { webhookToken: string }).webhookToken;
    const courierSays = async (code: number, label: string) => {
      clock.advance(60_000);
      bosta.setState(tn, code, label);
      await http().post(`/webhooks/bosta/${courier.id}?token=${encodeURIComponent(token)}`).set("Content-Type", "application/json").send(bosta.webhook(tn, { withLabel: true })).expect(200);
      await runJobs();
    };
    const list = async (view: string, as_ = "owner") => (await http().get(`/v1/shipments?view=${view}`).set(as(as_)).expect(200)).body;

    await courierSays(24, "In transit");
    expect((await detail(id)).shipments[0]).toMatchObject({ status: "in_transit" });
    const active = await list("active", "agent");
    expect(active.data.find((r: { id: string }) => r.id === shipped.id)).toMatchObject({ status: "in_transit", trackingNumber: tn, needsReview: false, area: { city: "Cairo" }, order: { id } });
    expect(JSON.stringify(active)).not.toMatch(/Abbas|0100/); // the area, never the address

    await courierSays(77, "Parcel on a camel");
    let r = (await list("review")).data.find((x: { id: string }) => x.id === shipped.id);
    expect(r).toMatchObject({ needsReview: true, status: "in_transit", statusRaw: "Parcel on a camel" });
    expect((await list("review")).counts.review).toBeGreaterThanOrEqual(2); // and the Atlantis booking

    await courierSays(45, "Delivered");
    const o = await detail(id);
    expect(o).toMatchObject({ status: "delivered" });
    expect(o.timestamps.deliveredAt).toEqual(expect.any(String));
    expect(o.shipments[0]).toMatchObject({ status: "delivered" });
    r = (await list("delivered")).data.find((x: { id: string }) => x.id === shipped.id);
    expect(r).toMatchObject({ needsReview: false });
    const types = (await db.tenant(store, (trx) => trx.selectFrom("domain_events").select("type").where("entity_id", "=", shipped.id).execute())).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["shipment.status_changed", "shipment.needs_review", "shipment.delivered"]));

    // Final: a later courier status that disagrees goes to review; a person corrects it (audited).
    await courierSays(46, "Returned to business");
    expect((await detail(id)).status).toBe("delivered");
    expect((await list("review")).data.some((x: { id: string }) => x.id === shipped.id)).toBe(true);
    await http().post(`/v1/shipments/${shipped.id}/status`).set(as("wh")).send({ status: "returned" }).expect(403);
    await http().post(`/v1/shipments/${shipped.id}/status`).set(as("owner")).send({ status: "unknown" }).expect(422);
    await http().post(`/v1/shipments/${shipped.id}/status`).set(as("owner")).send({ status: "returned", note: "Bosta confirmed on the phone" }).expect(200);
    await drainEvents();
    expect((await detail(id)).status).toBe("returned");
    expect((await list("review")).data.some((x: { id: string }) => x.id === shipped.id)).toBe(false);
    const history = (await http().get(`/v1/shipments/${shipped.id}/events`).set(as("owner")).expect(200)).body.data;
    expect(history[0]).toMatchObject({ status: "returned", source: "ops", note: "Bosta confirmed on the phone" });
    expect(history.map((h: { source: string }) => h.source)).toContain("webhook");
    const audit = await db.tenant(store, (trx) => trx.selectFrom("audit_log").select("action").where("entity_id", "=", shipped.id).execute());
    expect(audit.map((a) => a.action)).toEqual(["shipment.status_set"]);
  });
});
