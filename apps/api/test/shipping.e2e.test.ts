import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import { FakeBosta, FakeClock, FakeShopify, seeded, testRuntime } from "@mizan/engine/testing";
import { sql } from "kysely";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { EventDispatcher } from "../src/platform/events/dispatcher.js";
import { EventsService } from "../src/platform/events/events.service.js";
import { SecretsService } from "../src/platform/secrets/secrets.service.js";
import { EngineJobRunner } from "../src/integrations/engine-runner.js";
import { PiiCipher } from "../src/platform/pii/pii-cipher.js";
import { SyncGuardian } from "../src/integrations/sync-guardian.js";
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
async function manual(payment: object, city = "Cairo", phone = "01001234821") {
  const r = await http().post("/v1/orders").set(as("owner")).send({
    source: "phone", customer: { name: "Mona Adel", phone }, address: { line1: "12 Abbas El Akkad St", city },
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
    // The courier collected the cash: one courier line in the ledger, the order paid.
    expect(o).toMatchObject({ paymentStatus: "paid", paid: { amount: "1250.00" } });
    const cash = await db.tenant(store, (trx) => trx.selectFrom("payments").select(["kind", "source", "amount_minor"]).where("order_id", "=", id).execute());
    expect(cash).toEqual([{ kind: "cod_collection", source: "courier", amount_minor: 125000n }]);
    // …and profit still counts the 1,250 as revenue (the order owes nothing now).
    expect((await http().get(`/v1/orders/${id}/pnl`).set(as("owner")).expect(200)).body).toMatchObject({ revenue: { amount: "1250.00" } });
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

  it("a courier without an API: the team records the handover, then the courier's report updates it (E7-6)", async () => {
    const a = await manual({ mode: "cod" });
    const b = await manual({ mode: "prepaid", method: "wallet" });
    await confirm(a);
    await confirm(b);
    const record = (id: string, body: object, token = "wh") => http().post(`/v1/orders/${id}/ship/manual`).set(as(token)).send(body);
    const sa = (await record(a, { courier: "J&T Express", trackingNumber: "JT-1001" }).expect(201)).body;
    expect(sa).toMatchObject({ provider: "J&T Express", booking: "booked", status: "created", trackingNumber: "JT-1001", cod: { amount: "1250.00" } });
    await record(b, { courier: "j&t   express", trackingNumber: "JT-1002" }).expect(201); // the same courier, however it's typed
    expect((await record(b, { courier: "J&T Express", trackingNumber: "JT-1003" }).expect(409)).body.code).toBe("already_shipping");
    const c = await manual({ mode: "cod" });
    await confirm(c);
    expect((await record(c, { courier: "J&T Express", trackingNumber: "JT-1001" }).expect(409)).body.code).toBe("tracking_taken");
    await record(c, { courier: "J&T Express", trackingNumber: "bad number!" }).expect(422);
    await record(c, { courier: "J&T Express", trackingNumber: "JT-1009" }, "agent").expect(403);
    await drainEvents();
    expect((await detail(a)).status).toBe("shipped");
    const couriers = await db.tenant(store, (trx) => trx.selectFrom("connections").select(["provider", "display_name"]).where("provider", "=", "manual").execute());
    expect(couriers).toEqual([{ provider: "manual", display_name: "J&T Express" }]);

    const importCsv = (csv: string, token = "owner") => http().post("/v1/shipments/statuses/import").set(as(token)).send({ csv });
    // All or nothing: one unknown tracking number and nothing moves.
    const bad = (await importCsv("رقم الشحنة,الحالة\nJT-1001,تم التسليم\nJT-9999,مرتجع\n").expect(422)).body;
    expect(bad).toMatchObject({ code: "csv_invalid", errors: [{ path: "line:3", code: "unknown_tracking", message: "JT-9999" }] });
    expect((await detail(a)).status).toBe("shipped");
    await importCsv("Tracking,Status\nJT-1001,Delivered\n", "wh").expect(403);

    const ok = (await importCsv("رقم الشحنة,الحالة,التاريخ,ملاحظات\nJT-1001,تم التسليم,2026-10-26,\nJT-1002,مرتجع,,رفض الاستلام\n").expect(200)).body;
    expect(ok).toEqual({ rows: 2, changed: 2, unchanged: 0, review: 0 });
    await drainEvents();
    const da = await detail(a);
    expect(da).toMatchObject({ status: "delivered" });
    expect(da.shipments[0]).toMatchObject({ status: "delivered" });
    expect((await detail(b)).status).toBe("returned");
    const history = (await http().get(`/v1/shipments/${sa.id}/events`).set(as("owner")).expect(200)).body.data;
    expect(history[0]).toMatchObject({ status: "delivered", source: "ops", at: "2026-10-26T12:00:00.000Z", note: "CSV" });
    // The same file again changes nothing.
    expect((await importCsv("Tracking,Status\nJT-1001,Delivered\n").expect(200)).body).toMatchObject({ changed: 0, unchanged: 1 });
    const audit = await db.tenant(store, (trx) => trx.selectFrom("audit_log").select("action").where("action", "in", ["shipment.statuses_imported", "shipment.recorded"]).execute());
    expect(audit.map((x) => x.action).sort()).toEqual(["shipment.recorded", "shipment.recorded", "shipment.statuses_imported", "shipment.statuses_imported"]);
  });

  it("the courier scorecard by zone: delivered rate as everywhere, returns and days to deliver (E7-4)", async () => {
    const card = (await http().get("/v1/couriers/scorecard?days=30").set(as("owner")).expect(200)).body;
    expect(card.days).toBe(30);
    const jt = card.couriers.find((c: { courier: string }) => c.courier === "J&T Express");
    expect(jt).toMatchObject({ shipments: 2, delivered: 1, returned: 1, inFlight: 0, deliveredRate: "50.0", rtoRate: "50.0", avgDaysToDeliver: "0.0" });
    expect(jt.zones).toEqual([expect.objectContaining({ zone: "Cairo", shipments: 2, deliveredRate: "50.0" })]);
    const b = card.couriers.find((c: { courier: string }) => c.courier === "bosta");
    expect(b.shipments).toBeGreaterThanOrEqual(3);
    expect(b.zones.reduce((n: number, z: { shipments: number }) => n + z.shipments, 0)).toBe(b.shipments);
    await http().get("/v1/couriers/scorecard?days=7").set(as("owner")).expect(422);
    await http().get("/v1/couriers/scorecard").set(as("agent")).expect(403);
  });

  it("ships many orders from the shipping screen: the ready list, one booking each, skips say why (E7-2)", async () => {
    // Different customers: the same phone again would wait as a likely duplicate (E5-3).
    const [a, b, open, booked] = [await manual({ mode: "cod" }, "Cairo", "01001239001"), await manual({ mode: "prepaid", method: "card" }, "Cairo", "01001239002"),
      await manual({ mode: "cod" }, "Cairo", "01001239003"), await manual({ mode: "cod" }, "Cairo", "01001239004")];
    for (const id of [a, b, booked]) await confirm(id);
    await ship(booked).expect(202);
    const ready = (await http().get("/v1/orders?shipping=ready&limit=100").set(as("wh")).expect(200)).body;
    const readyIds = ready.data.map((o: { id: string }) => o.id);
    expect(readyIds).toEqual(expect.arrayContaining([a, b]));
    expect(readyIds).not.toContain(open);
    expect(readyIds).not.toContain(booked);
    expect(ready.readyToShip).toBe(ready.data.length);

    await http().post("/v1/orders/bulk").set(as("wh")).send({ action: "cancel", orderIds: [a], reason: "other" }).expect(403);
    await http().post("/v1/orders/bulk").set(as("agent")).send({ action: "ship", orderIds: [a] }).expect(403);
    const req = (await http().post("/v1/orders/bulk").set(as("wh")).send({ action: "ship", orderIds: [a, b, open, booked] }).expect(202)).body;
    await drainEvents();
    const done = (await http().get(`/v1/orders/bulk/${req.id}`).set(as("wh")).expect(200)).body;
    expect(done).toMatchObject({ action: "ship", status: "done", total: 4, done: 2, skipped: 2, failed: 0 });
    expect(Object.fromEntries(done.issues.map((i: { orderId: string; reason: string }) => [i.orderId, i.reason]))).toEqual({ [open]: "not_confirmed", [booked]: "already_shipping" });

    // Asked again: nothing is booked twice.
    const again = (await http().post("/v1/orders/bulk").set(as("owner")).send({ action: "ship", orderIds: [a, b] }).expect(202)).body;
    await drainEvents();
    expect((await http().get(`/v1/orders/bulk/${again.id}`).set(as("owner")).expect(200)).body).toMatchObject({ done: 0, skipped: 2 });
    await runJobs();
    for (const id of [a, b]) {
      const o = await detail(id);
      expect(o.status).toBe("shipped");
      expect(o.shipments).toEqual([expect.objectContaining({ booking: "booked", trackingNumber: expect.any(String) })]);
    }
    expect((await detail(b)).shipments[0].cod).toEqual({ amount: "0.00", currency: "EGP" });
    const refs = await db.tenant(store, (trx) => trx.selectFrom("shipments").select("id").where("order_id", "in", [a, b]).execute());
    expect([...bosta.deliveries.values()].filter((d) => refs.some((r) => r.id === d.businessReference))).toHaveLength(2);
    const after = (await http().get("/v1/orders?shipping=ready&limit=100").set(as("wh")).expect(200)).body.data.map((o: { id: string }) => o.id);
    expect(after).not.toContain(a);
  });
});

describe("two-way delivery: Mizan, the courier and the store keep each other told", () => {
  const shopifyId = async () => (await db.tenant(store, (trx) => trx.selectFrom("connections").select("id").where("provider", "=", "shopify").executeTakeFirstOrThrow())).id;
  /** A Shopify order as the store sends it, confirmed in Mizan. */
  async function storeOrder(name: string) {
    const o = shop.addOrder({ name });
    const wh = shop.webhook("orders/create", o);
    await http().post(`/webhooks/shopify/${await shopifyId()}`).set(wh.headers).send(wh.body).expect(200);
    await runJobs();
    const row = await db.tenant(store, (trx) => trx.selectFrom("orders").select("id").where("number", "=", name).executeTakeFirstOrThrow());
    return { shop: o, id: row.id };
  }
  const settle = async () => { await drainEvents(); await runJobs(); await drainEvents(); };

  it("a courier recorded by hand: the store gets the fulfillment, then each status a person sets, paid on delivery", async () => {
    const o = await storeOrder("#3001");
    await confirm(o.id);
    const s = (await http().post(`/v1/orders/${o.id}/ship/manual`).set(as("owner")).send({ courier: "Mylerz", trackingNumber: "MY-777" }).expect(201)).body;
    await settle();
    const f = shop.orders.get(o.shop.id)!.fulfillments;
    expect(f).toHaveLength(1);
    expect(f[0]!.trackingInfo[0]).toMatchObject({ company: "Mylerz", number: "MY-777" });

    await http().post(`/v1/shipments/${s.id}/status`).set(as("owner")).send({ status: "out_for_delivery" }).expect(200);
    await http().post(`/v1/shipments/${s.id}/status`).set(as("owner")).send({ status: "delivered" }).expect(200);
    await settle();
    expect(shop.orders.get(o.shop.id)!.fulfillments[0]!.events?.map((e) => e.status).sort()).toEqual(["DELIVERED", "OUT_FOR_DELIVERY"]); // Shopify orders them by when they happened
    expect(shop.orders.get(o.shop.id)!.displayFinancialStatus).toBe("PAID");
    expect(shop.orders.get(o.shop.id)!.fulfillments).toHaveLength(1); // never fulfilled twice
  });

  it("cancelled in Mizan by any path (here: the customer in confirmation) is cancelled in Shopify; cancelled in Shopify is not sent back", async () => {
    const o = await storeOrder("#3002");
    await db.tenant(store, async (trx) => {
      await trx.updateTable("orders").set({ status: "cancelled", cancelled_at: new Date() }).where("id", "=", o.id).execute();
      await app.get(EventsService).emit(trx, { type: "order.cancelled", tenantId: store, entity: { type: "order", id: o.id }, actor: { type: "system" }, data: { number: "#3002", reason: "customer_cancelled" } });
    });
    await settle();
    expect(shop.orders.get(o.shop.id)!.cancelledAt).toEqual(expect.any(String));

    const other = await storeOrder("#3003");
    await db.tenant(store, (trx) => app.get(EventsService).emit(trx, { type: "order.cancelled", tenantId: store, entity: { type: "order", id: other.id }, actor: { type: "engine" }, data: { number: "#3003", reason: "cancelled_in_store" } }));
    await settle();
    expect(shop.orders.get(other.shop.id)!.cancelledAt).toBeNull();
  });

  it("shipped in Shopify with the merchant's own courier: Mizan records the shipment and leaves confirmation; nothing is sent back", async () => {
    const o = await storeOrder("#3004");
    const so = shop.orders.get(o.shop.id)!;
    so.fulfillments.push({ id: "gid://shopify/Fulfillment/990001", status: "SUCCESS", trackingInfo: [{ company: "Aramex", number: "AX-55", url: "https://aramex.test/AX-55" }] });
    so.updatedAt = new Date(clock.now() + 1000).toISOString();
    const wh = shop.webhook("orders/updated", so);
    await http().post(`/webhooks/shopify/${await shopifyId()}`).set(wh.headers).send(wh.body).expect(200);
    await runJobs();
    await settle();
    const d = await detail(o.id);
    expect(d.status).toBe("shipped");
    expect(d.shipments).toEqual([expect.objectContaining({ provider: "Aramex", trackingNumber: "AX-55", booking: "booked" })]);
    expect(shop.orders.get(o.shop.id)!.fulfillments).toHaveLength(1);
    // The same order again from the store changes nothing.
    const again = shop.webhook("orders/updated", so);
    await http().post(`/webhooks/shopify/${await shopifyId()}`).set(again.headers).send(again.body).expect(200);
    await settle();
    expect((await detail(o.id)).shipments).toHaveLength(1);
  });
});

describe("sync guardian: drops and errors recover on their own", () => {
  const guardian = () => app.get(SyncGuardian);
  const shopifyId = async () => (await db.tenant(store, (trx) => trx.selectFrom("connections").select("id").where("provider", "=", "shopify").executeTakeFirstOrThrow())).id;
  async function storeOrder(name: string) {
    const o = shop.addOrder({ name });
    const wh = shop.webhook("orders/create", o);
    await http().post(`/webhooks/shopify/${await shopifyId()}`).set(wh.headers).send(wh.body).expect(200);
    await runJobs();
    const row = await db.tenant(store, (trx) => trx.selectFrom("orders").select("id").where("number", "=", name).executeTakeFirstOrThrow());
    return { shop: o, id: row.id };
  }
  const round = async () => { clock.advance(6 * 60_000); await guardian().round(Date.now(), clock.now()); await drainEvents(); await runJobs(); await drainEvents(); };

  it("a Bosta webhook that never came: the next round reads the shipment and moves it", async () => {
    const id = await manual({ mode: "cod" });
    await confirm(id);
    await ship(id).expect(202);
    await runJobs();
    const tn = (await detail(id)).shipments[0].trackingNumber as string;
    bosta.setState(tn, 24, "In transit"); // no webhook
    await round();
    expect((await detail(id)).shipments[0]).toMatchObject({ status: "in_transit" });
  });

  it("a Shopify update whose webhook was dropped: the poll brings it (here: shipped in Shopify)", async () => {
    const o = await storeOrder("#4001");
    const so = shop.orders.get(o.shop.id)!;
    so.fulfillments.push({ id: "gid://shopify/Fulfillment/990101", status: "SUCCESS", trackingInfo: [{ company: "Aramex", number: "AX-4001" }] });
    so.updatedAt = new Date(clock.now() + 1000).toISOString(); // no webhook
    await round();
    expect((await detail(o.id)).shipments).toEqual([expect.objectContaining({ trackingNumber: "AX-4001" })]);
    await round(); // and it is never sent back to Shopify
    expect(shop.orders.get(o.shop.id)!.fulfillments).toHaveLength(1);
  });

  it("a write lost with a crash is queued again; one that died of passing trouble runs again later, three times at most", async () => {
    const o = await storeOrder("#4002");
    await confirm(o.id);
    await http().post(`/v1/orders/${o.id}/ship/manual`).set(as("owner")).send({ courier: "Mylerz", trackingNumber: "MY-4002" }).expect(201);
    // The fulfillment job never made it (a crash between the commit and the queue).
    await drainEvents();
    await db.tenant(store, (trx) => trx.deleteFrom("mz_outbox").where("idempotency_key", "=", `fulfill:${o.shop.id}:MY-4002`).execute());
    await round();
    expect(shop.orders.get(o.shop.id)!.fulfillments[0]!.trackingInfo[0]).toMatchObject({ company: "Mylerz", number: "MY-4002" });

    // A job that gave up on a provider outage: brought back an hour after it died, at most three times.
    const dead = await db.tenant(store, async (trx) => (await trx.updateTable("mz_outbox").set({ status: "dead", last_error: "gave up after 12 attempts — transient: 503", updated_at: clock.now() - 2 * 3_600_000 })
      .where("idempotency_key", "=", `fulfill:${o.shop.id}:MY-4002`).returning("id").executeTakeFirstOrThrow()).id);
    expect((await guardian().revive(clock.now())).jobs).toBe(1);
    const back = await db.tenant(store, (trx) => trx.selectFrom("mz_outbox").select(["status", "revivals"]).where("id", "=", dead).executeTakeFirstOrThrow());
    expect(back).toEqual({ status: "pending", revivals: 1 });
    await db.tenant(store, (trx) => trx.updateTable("mz_outbox").set({ status: "dead", revivals: 3, updated_at: clock.now() - 48 * 3_600_000 }).where("id", "=", dead).execute());
    expect((await guardian().revive(clock.now())).jobs).toBe(0); // three times is enough: a person looks
    // A refusal that needs a person is never retried on its own.
    await db.tenant(store, (trx) => trx.updateTable("mz_outbox").set({ revivals: 0, last_error: "validation: address rejected" }).where("id", "=", dead).execute());
    expect((await guardian().revive(clock.now())).jobs).toBe(0);
  });

  it("a Bosta booking with no answer and no job behind it is asked again, and booked once", async () => {
    const id = await manual({ mode: "cod" });
    await confirm(id);
    const s = (await ship(id).expect(202)).body;
    await db.tenant(store, async (trx) => {
      await trx.deleteFrom("mz_outbox").where("idempotency_key", "=", `bosta:ship:${s.id}`).execute();
      await trx.updateTable("shipments").set({ created_at: new Date(Date.now() - 40 * 60_000) }).where("id", "=", s.id).execute();
    });
    await round();
    expect((await detail(id)).shipments[0]).toMatchObject({ booking: "booked", trackingNumber: expect.any(String) });
    expect([...bosta.deliveries.values()].filter((d) => d.businessReference === s.id)).toHaveLength(1);
  });

  it("the team sees it: when the guardian last looked, what it fixed on its own, what it will retry and what needs them", async () => {
    await round();
    const h = (await http().get("/v1/admin/integrations/sync").set(as("owner")).expect(200)).body;
    expect(h.checkedAt).toEqual(expect.any(String));
    expect(h.stores).toEqual([expect.objectContaining({ provider: "shopify", checkedAt: expect.any(String) })]);
    expect(h.recovered.rebooked + h.recovered.reasserted).toBeGreaterThanOrEqual(2); // the lost fulfillment and the stuck booking above

    // One dead job that will come back on its own, one that needs a person.
    const [a, b] = await db.tenant(store, (trx) => trx.selectFrom("mz_outbox").select("id").where("status", "=", "done").orderBy("created_at", "desc").limit(2).execute());
    await db.tenant(store, async (trx) => {
      await trx.updateTable("mz_outbox").set({ status: "dead", revivals: 0, last_error: "timeout: no answer", updated_at: clock.now() }).where("id", "=", a!.id).execute();
      await trx.updateTable("mz_outbox").set({ status: "dead", revivals: 0, last_error: "validation: address rejected", updated_at: clock.now() }).where("id", "=", b!.id).execute();
    });
    const after = (await http().get("/v1/admin/integrations/sync").set(as("owner")).expect(200)).body;
    expect(after.retrying.count).toBeGreaterThanOrEqual(1);
    expect(after.retrying.nextAt).toEqual(new Date(clock.now() + 3_600_000).toISOString());
    expect(after.needsYou).toBeGreaterThanOrEqual(1);
    const letters = (await http().get("/v1/admin/integrations/dead-letters").set(as("owner")).expect(200)).body.data;
    expect(letters.find((d: { id: string }) => d.id === a!.id).autoRetryAt).toEqual(new Date(clock.now() + 3_600_000).toISOString());
    expect(letters.find((d: { id: string }) => d.id === b!.id).autoRetryAt).toBeNull();
    await http().get("/v1/admin/integrations/sync").set(as("agent")).expect(403);
  });
});

describe("orders made in Mizan reach Shopify: one record in Mizan, Shopify and the courier", () => {
  const shopifyId = async () => (await db.tenant(store, (trx) => trx.selectFrom("connections").select("id").where("provider", "=", "shopify").executeTakeFirstOrThrow())).id;
  const copyOf = (id: string) => [...shop.orders.values()].filter((o) => o.sourceIdentifier === `mizan:${id}`);
  const settle = async () => { await drainEvents(); await runJobs(); await drainEvents(); await runJobs(); await drainEvents(); };
  const storeOrders = () => db.tenant(store, async (trx) => Number((await trx.selectFrom("orders").select(sql<string>`count(*)`.as("n")).where("channel", "!=", "manual").executeTakeFirstOrThrow()).n));

  it("a typed order is created in Shopify once, named like Mizan's; its copy comes back linked, not as a second order", async () => {
    const before = await storeOrders();
    const id = await manual({ mode: "partial", method: "instapay", paid: "300" });
    await settle();
    const [copy] = copyOf(id);
    const d = await detail(id);
    expect(copy).toMatchObject({ name: d.number, received: "300.00", displayFinancialStatus: "PARTIALLY_PAID", tags: ["mizan"] });
    expect(copy!.shippingAddress).toMatchObject({ address1: "12 Abbas El Akkad St", countryCodeV2: "EG" });
    expect(d.storeCopy).toEqual({ status: "created", name: d.number, error: null });
    // The store's webhook for the copy: linked, never imported.
    const wh = shop.webhook("orders/create", copy!);
    await http().post(`/webhooks/shopify/${await shopifyId()}`).set(wh.headers).send(wh.body).expect(200);
    await settle();
    expect(await storeOrders()).toBe(before);
    expect(copyOf(id)).toHaveLength(1);
  });

  it("copies made before customers and governorate codes were sent are put right by the guardian, once each (U26)", async () => {
    const id = await manual({ mode: "cod" });
    await settle();
    const copy = copyOf(id)[0]!;
    expect(copy.customer).toMatchObject({ phone: "+201001234821" }); // a new copy carries the buyer already
    copy.customer = null as unknown as Record<string, unknown>; // as the old code left it
    copy.shippingAddress = { ...copy.shippingAddress, province: "C", provinceCode: null };
    // The store has the buyer as a customer (the repair attaches one, never creates one).
    shop.customers.length = 0;
    shop.customers.push({ id: "gid://shopify/Customer/501", firstName: "Mona", phone: "+201001234821" });
    // The sweep starts after the deploy, when every old copy exists: from the beginning.
    await db.tenant(store, (trx) => trx.deleteFrom("mz_records").where("type", "=", "guardian").where("key", "like", "copy-repair:%").execute());
    for (let i = 0; i < 4; i++) { await app.get(SyncGuardian).round(Date.now(), clock.now()); await settle(); }
    expect(copy.customer).toMatchObject({ id: "gid://shopify/Customer/501" });
    expect(copy.shippingAddress).toMatchObject({ province: "Cairo", provinceCode: "C" });
    expect(shop.customers.filter((c) => c.phone === "+201001234821")).toHaveLength(1);
  });

  it("an old copy whose buyer is not a store customer: created when no erasure was asked for; an erasure of that phone stops it (U27)", async () => {
    const legacy = async (phone: string) => {
      const id = await manual({ mode: "cod" }, "Cairo", phone);
      await settle();
      const copy = copyOf(id)[0]!;
      copy.customer = null as unknown as Record<string, unknown>;
      copy.shippingAddress = { ...copy.shippingAddress, province: "C", provinceCode: null };
      return { id, copy };
    };
    const a = await legacy("01001239001");
    const b = await legacy("01001239002");
    shop.customers.length = 0; // as the old code left the store: no customers for these buyers
    // The store asked to erase b's buyer (customers/redact naming the phone): recorded with the phone's hash, as the webhook does.
    const shopId = await shopifyId(); // outside the transaction below: one connection in tests
    await db.tenant(store, async (trx) => {
      const pii = await app.get(PiiCipher).forTenant(trx, store);
      await trx.insertInto("privacy_requests").values({ tenant_id: store, connection_id: shopId, source: "shopify_customers_redact", payload: JSON.stringify({ shop: "x", orderIds: [], phoneHash: pii.phoneHash("+201001239002") }), due_at: new Date() }).execute();
    });
    await db.tenant(store, (trx) => trx.deleteFrom("mz_records").where("type", "=", "guardian").where("key", "like", "copy-repair:%").execute());
    for (let i = 0; i < 4; i++) { await app.get(SyncGuardian).round(Date.now(), clock.now()); await settle(); }
    expect(a.copy.customer).toMatchObject({ phone: "+201001239001" });
    expect(b.copy.customer).toBeNull();
    expect(b.copy.shippingAddress).toMatchObject({ provinceCode: "C" }); // the governorate is still put right

    // A request Mizan cannot match to anyone (no phone, no email hash): nobody is created for this store from now on.
    const c = await legacy("01001239003");
    shop.customers.length = 0;
    await db.tenant(store, (trx) => trx.insertInto("privacy_requests").values({ tenant_id: store, connection_id: shopId, source: "shopify_customers_redact", payload: JSON.stringify({ shop: "x", orderIds: [], customerId: "77" }), due_at: new Date() }).execute());
    await db.tenant(store, (trx) => trx.deleteFrom("mz_records").where("type", "=", "guardian").where("key", "like", "copy-repair:%").execute());
    for (let i = 0; i < 4; i++) { await app.get(SyncGuardian).round(Date.now(), clock.now()); await settle(); }
    expect(c.copy.customer).toBeNull();
  });

  it("shipped with Bosta: the copy in Shopify is fulfilled with the tracking number", async () => {
    const id = await manual({ mode: "cod" });
    await settle();
    await confirm(id);
    await ship(id).expect(202);
    await settle();
    const tn = (await detail(id)).shipments[0].trackingNumber as string;
    expect(copyOf(id)[0]!.fulfillments[0]!.trackingInfo[0]).toMatchObject({ number: tn });
  });

  it("cancelled in Mizan: cancelled in Shopify; cancelled in Shopify: cancelled in Mizan, not sent back", async () => {
    const a = await manual({ mode: "cod" });
    await settle();
    await db.tenant(store, async (trx) => {
      await trx.updateTable("orders").set({ status: "cancelled", cancelled_at: new Date() }).where("id", "=", a).execute();
      await app.get(EventsService).emit(trx, { type: "order.cancelled", tenantId: store, entity: { type: "order", id: a }, actor: { type: "system" }, data: { number: "x", reason: "customer_cancelled" } });
    });
    await settle();
    expect(copyOf(a)[0]!.cancelledAt).toEqual(expect.any(String));

    const b = await manual({ mode: "cod" });
    await settle();
    const copy = copyOf(b)[0]!;
    copy.cancelledAt = new Date(clock.now()).toISOString();
    copy.updatedAt = copy.cancelledAt;
    const wh = shop.webhook("orders/cancelled", copy);
    await http().post(`/webhooks/shopify/${await shopifyId()}`).set(wh.headers).send(wh.body).expect(200);
    await settle();
    expect((await detail(b)).status).toBe("cancelled");
  });

  it("a second copy in Shopify (two creates that raced) is cancelled there; Mizan keeps one order", async () => {
    const id = await manual({ mode: "cod" });
    await settle();
    const before = await storeOrders();
    const extra = shop.addOrder({ name: "M-extra" });
    extra.sourceIdentifier = `mizan:${id}`;
    const wh = shop.webhook("orders/create", extra);
    await http().post(`/webhooks/shopify/${await shopifyId()}`).set(wh.headers).send(wh.body).expect(200);
    await settle();
    expect(shop.orders.get(extra.id)!.cancelledAt).toEqual(expect.any(String));
    expect(copyOf(id).filter((o) => !o.cancelledAt)).toHaveLength(1);
    expect(await storeOrders()).toBe(before);
  });
});

describe("review fixes: one record, whatever fails or repeats", () => {
  const shopifyId = async () => (await db.tenant(store, (trx) => trx.selectFrom("connections").select("id").where("provider", "=", "shopify").executeTakeFirstOrThrow())).id;
  const settle = async () => { await drainEvents(); await runJobs(); await drainEvents(); await runJobs(); await drainEvents(); };
  async function storeOrder(name: string) {
    const o = shop.addOrder({ name });
    const wh = shop.webhook("orders/create", o);
    await http().post(`/webhooks/shopify/${await shopifyId()}`).set(wh.headers).send(wh.body).expect(200);
    await settle();
    const row = await db.tenant(store, (trx) => trx.selectFrom("orders").select("id").where("number", "=", name).executeTakeFirstOrThrow());
    return { shop: o, id: row.id };
  }
  const webhook = async (topic: string, o: Parameters<typeof shop.webhook>[1]) => {
    o.updatedAt = new Date(clock.now() + 1000).toISOString();
    const wh = shop.webhook(topic, o);
    await http().post(`/webhooks/shopify/${await shopifyId()}`).set(wh.headers).send(wh.body).expect(200);
    await settle();
  };
  const reviewRow = async (shipmentId: string) => (await http().get("/v1/shipments?view=review").set(as("owner")).expect(200)).body.data.find((x: { id: string }) => x.id === shipmentId);

  it("a booking job run again (replayed, revived) adopts the delivery Bosta has: never two", async () => {
    const id = await manual({ mode: "cod" });
    await confirm(id);
    const s = (await ship(id).expect(202)).body;
    await settle();
    // As if the answer was lost: the shipment still waits, and the job is brought back with its count reset.
    await db.tenant(store, async (trx) => {
      await trx.updateTable("shipments").set({ booking: "pending" }).where("id", "=", s.id).execute();
      await trx.updateTable("mz_outbox").set({ status: "dead", attempts: 0, last_error: "gave up after 12 attempts — timeout: lost" }).where("idempotency_key", "=", `bosta:ship:${s.id}`).execute();
    });
    clock.advance(2 * 3_600_000);
    await app.get(SyncGuardian).revive(clock.now());
    await settle();
    expect([...bosta.deliveries.values()].filter((d) => d.businessReference === s.id)).toHaveLength(1);
    expect((await detail(id)).shipments[0]).toMatchObject({ booking: "booked" });
  });

  it("money recorded in Mizan and marked paid in Shopify is counted once", async () => {
    const o = await storeOrder("#5001");
    await http().post(`/v1/orders/${o.id}/payments`).set(as("owner")).send({ type: "received", method: "instapay", amount: "1150" }).expect(201);
    await settle();
    expect(shop.orders.get(o.shop.id)!.displayFinancialStatus).toBe("PAID");
    await webhook("orders/updated", shop.orders.get(o.shop.id)!);
    expect(await detail(o.id)).toMatchObject({ paymentStatus: "paid", paid: { amount: "1150.00" } });
  });

  it("a Bosta delivery is cancelled at Bosta, not only in Mizan; the order can ship again", async () => {
    const id = await manual({ mode: "cod" });
    await confirm(id);
    const s = (await ship(id).expect(202)).body;
    await settle();
    expect((await http().post(`/v1/shipments/${s.id}/status`).set(as("owner")).send({ status: "cancelled" }).expect(409)).body.code).toBe("cancel_at_courier");
    expect((await http().post(`/v1/shipments/${s.id}/cancel`).set(as("owner")).expect(202)).body).toEqual({ queued: true });
    await settle();
    const d = await detail(id);
    expect(bosta.deliveries.get(d.shipments[0].trackingNumber)!.state.code).toBe(48);
    expect(d.shipments[0]).toMatchObject({ status: "cancelled" });
    expect(d.status).toBe("confirmed");
  });

  it("Bosta refuses to cancel a parcel already picked up: the shipment waits in review with why", async () => {
    const id = await manual({ mode: "cod" });
    await confirm(id);
    const s = (await ship(id).expect(202)).body;
    await settle();
    bosta.setState((await detail(id)).shipments[0].trackingNumber, 24, "In transit");
    await http().post(`/v1/shipments/${s.id}/cancel`).set(as("owner")).expect(202);
    await settle();
    expect(await reviewRow(s.id)).toMatchObject({ needsReview: true, reviewReason: expect.stringMatching(/Bosta refused to cancel/) });
    expect((await http().post(`/v1/shipments/${s.id}/cancel`).set(as("owner")).expect(202)).body).toEqual({ queued: true }); // asked again after the refusal
  });

  it("cancelled in Shopify after booking: flagged for a person; cancelling at Bosta cancels the order", async () => {
    const o = await storeOrder("#5002");
    await confirm(o.id);
    const s = (await ship(o.id).expect(202)).body;
    await settle();
    const so = shop.orders.get(o.shop.id)!;
    so.cancelledAt = new Date(clock.now()).toISOString();
    await webhook("orders/cancelled", so);
    expect(await reviewRow(s.id)).toMatchObject({ needsReview: true, reviewReason: expect.stringMatching(/Cancelled in the store/) });
    // The courier's next update keeps the review open: only a person decides.
    const tn = (await detail(o.id)).shipments[0].trackingNumber as string;
    bosta.setState(tn, 10, "Pickup requested");
    clock.advance(6 * 60_000);
    await app.get(SyncGuardian).round(Date.now(), clock.now());
    await settle();
    expect(await reviewRow(s.id)).toMatchObject({ needsReview: true, reviewReason: expect.stringMatching(/Cancelled in the store/) });
    await http().post(`/v1/shipments/${s.id}/cancel`).set(as("owner")).expect(202);
    await settle();
    expect((await detail(o.id)).status).toBe("cancelled");
    // The Shopify fulfillment of the cancelled delivery is cancelled too; the next store update brings no ghost shipment.
    expect(shop.orders.get(o.shop.id)!.fulfillments.find((f) => f.trackingInfo[0]?.number === tn)!.status).toBe("CANCELLED");
    await webhook("orders/updated", shop.orders.get(o.shop.id)!);
    expect((await detail(o.id)).shipments).toHaveLength(1);
  });

  it("a deposit paid in Shopify and cash the team recorded are both counted, once each", async () => {
    const o = shop.addOrder({ name: "#5009", payment: "deposit", total: "1150.00" }); // 300 paid in Shopify
    const wh = shop.webhook("orders/create", o);
    await http().post(`/webhooks/shopify/${await shopifyId()}`).set(wh.headers).send(wh.body).expect(200);
    await settle();
    const id = (await db.tenant(store, (trx) => trx.selectFrom("orders").select("id").where("number", "=", "#5009").executeTakeFirstOrThrow())).id;
    await http().post(`/v1/orders/${id}/payments`).set(as("owner")).send({ type: "received", method: "instapay", amount: "300" }).expect(201);
    await settle();
    await webhook("orders/updated", shop.orders.get(o.id)!); // Shopify still says 300 received
    expect(await detail(id)).toMatchObject({ paid: { amount: "600.00" } });
  });

  it("the cash to collect changed after booking (paid meanwhile): flagged, the courier still has the old amount", async () => {
    const id = await manual({ mode: "cod" });
    await confirm(id);
    const s = (await ship(id).expect(202)).body;
    await settle();
    await http().post(`/v1/orders/${id}/payments`).set(as("owner")).send({ type: "received", method: "instapay", amount: "1250" }).expect(201);
    await settle();
    expect(await reviewRow(s.id)).toMatchObject({ needsReview: true }); // once (the payment conversion's flag), not twice
    const flags = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select("id").where("type", "=", "shipment.needs_review").where("entity_id", "=", s.id).execute());
    expect(flags).toHaveLength(1);
  });

  it("a fulfillment cancelled in Shopify cancels Mizan's record of it; a new one is recorded", async () => {
    const o = await storeOrder("#5003");
    const so = shop.orders.get(o.shop.id)!;
    so.fulfillments.push({ id: "gid://shopify/Fulfillment/995001", status: "SUCCESS", trackingInfo: [{ company: "Aramex", number: "AX-T1" }] });
    await webhook("orders/updated", so);
    expect((await detail(o.id)).status).toBe("shipped");
    so.fulfillments[0]!.status = "CANCELLED";
    so.fulfillments.push({ id: "gid://shopify/Fulfillment/995002", status: "SUCCESS", trackingInfo: [{ company: "Aramex", number: "AX-T2" }] });
    await webhook("orders/updated", so);
    await webhook("orders/updated", so);
    const d = await detail(o.id);
    expect(d.shipments.find((x: { trackingNumber: string }) => x.trackingNumber === "AX-T1")).toMatchObject({ status: "cancelled" });
    expect(d.shipments.find((x: { trackingNumber: string }) => x.trackingNumber === "AX-T2")).toMatchObject({ booking: "booked" });
    expect(d.status).toBe("shipped");
  });

  it("an order made in Mizan and edited: its Shopify copy follows", async () => {
    const id = await manual({ mode: "cod" });
    await settle();
    const before = await detail(id);
    await http().patch(`/v1/orders/${id}`).set(as("owner")).send({ lines: [{ lineId: before.lines[0].id, quantity: 3 }], add: [], shipping: "60" }).expect(200);
    await settle();
    const copy = [...shop.orders.values()].find((o) => o.sourceIdentifier === `mizan:${id}`)!;
    expect(copy.lines[0]!.quantity).toBe(3);
    expect((await detail(id)).storeCopy).toMatchObject({ status: "created", error: null });
  });

  it("a store copy that failed is tried again after the order is fixed", async () => {
    const id = await manual({ mode: "cod" });
    await settle();
    for (const [k, o] of shop.orders) if (o.sourceIdentifier === `mizan:${id}`) { shop.orders.delete(k); }
    await db.tenant(store, (trx) => trx.updateTable("orders").set({ store_copy_status: "failed", store_copy_id: null, store_copy_error: "refused" }).where("id", "=", id).execute());
    const lines = (await detail(id)).lines;
    await http().patch(`/v1/orders/${id}`).set(as("owner")).send({ lines: [{ lineId: lines[0].id, quantity: 2 }], add: [] }).expect(200);
    await settle();
    expect((await detail(id)).storeCopy).toMatchObject({ status: "created" });
  });
});

describe("Shopify → Mizan for orders made in Mizan: what changes in the copy updates the order", () => {
  const shopifyId = async () => (await db.tenant(store, (trx) => trx.selectFrom("connections").select("id").where("provider", "=", "shopify").executeTakeFirstOrThrow())).id;
  const settle = async () => { await drainEvents(); await runJobs(); await drainEvents(); await runJobs(); await drainEvents(); };
  const copyOf = (id: string) => [...shop.orders.values()].find((o) => o.sourceIdentifier === `mizan:${id}`)!;
  const updated = async (o: ReturnType<typeof copyOf>) => {
    o.updatedAt = new Date(clock.now() + 1000).toISOString();
    const wh = shop.webhook("orders/updated", o);
    await http().post(`/webhooks/shopify/${await shopifyId()}`).set(wh.headers).send(wh.body).expect(200);
    await settle();
  };

  it("items, quantities, delivery fee and address edited in Shopify reach Mizan; the line keeps its identity; still cash on delivery", async () => {
    const id = await manual({ mode: "cod" });
    await settle();
    const before = await detail(id);
    const c = copyOf(id);
    c.lines[0]!.quantity = 2;
    c.shippingLines = [{ id: "gid://shopify/ShippingLine/77", title: "Delivery", price: "40.00" }];
    c.total = (2 * Number(c.lines[0]!.price) + 40).toFixed(2);
    (c.shippingAddress as Record<string, unknown>).address1 = "9 Nile St";
    (c.shippingAddress as Record<string, unknown>).city = "Dokki";
    await updated(c);
    const d = await detail(id);
    expect(d.lines).toEqual([expect.objectContaining({ id: before.lines[0].id, quantity: 2 })]);
    expect(d).toMatchObject({ total: { amount: c.total }, paymentMode: "cod", paymentStatus: "unpaid", cod: { amount: c.total } });
    expect(d.area).toMatchObject({ city: "Dokki" });
    expect(copyOf(id).lines).toHaveLength(1); // nothing echoed back as a second edit
  });

  it("paid in Shopify: Mizan records it once", async () => {
    const id = await manual({ mode: "cod" });
    await settle();
    const c = copyOf(id);
    shop.paid(c.id);
    await updated(c);
    await updated(c); // again: no second line
    expect(await detail(id)).toMatchObject({ paymentStatus: "paid", paid: { amount: c.total } });
  });
});

describe("copies read three-way: only what changed in Shopify since the last read updates Mizan", () => {
  const shopifyId = async () => (await db.tenant(store, (trx) => trx.selectFrom("connections").select("id").where("provider", "=", "shopify").executeTakeFirstOrThrow())).id;
  const settle = async () => { await drainEvents(); await runJobs(); await drainEvents(); await runJobs(); await drainEvents(); };
  const copyOf = (id: string) => [...shop.orders.values()].find((o) => o.sourceIdentifier === `mizan:${id}`)!;
  const read = async (o: ReturnType<typeof copyOf>) => {
    o.updatedAt = new Date(clock.now() + 1000).toISOString();
    const wh = shop.webhook("orders/updated", o);
    await http().post(`/webhooks/shopify/${await shopifyId()}`).set(wh.headers).send(wh.body).expect(200);
    await settle();
  };
  async function typed(body: Record<string, unknown>) {
    const r = await http().post("/v1/orders").set(as("owner")).send({
      source: "phone", customer: { name: "Mona Adel", phone: "01001234821" }, address: { line1: "12 Abbas El Akkad St", city: "Cairo" },
      lines: [{ title: "Abaya", quantity: 1, unitPrice: "1000" }], shipping: "50", payment: { mode: "cod" }, ...body,
    }).expect(201);
    await settle();
    return r.body.id as string;
  }

  it("a deposit Mizan sent with the copy is not counted again; the courier still collects the rest", async () => {
    const id = await typed({ payment: { mode: "partial", method: "instapay", paid: "200" } });
    await read(copyOf(id));
    await read(copyOf(id));
    expect(await detail(id)).toMatchObject({ paid: { amount: "200.00" }, cod: { amount: "850.00" } });
  });

  it("the discount reaches the copy: both totals the same", async () => {
    const id = await typed({ discount: "100" });
    expect(copyOf(id).total).toBe((await detail(id)).total.amount);
  });

  it("a Mizan edit the copy does not have yet is not undone by a read of the old copy", async () => {
    const id = await typed({});
    const lines = (await detail(id)).lines;
    await http().patch(`/v1/orders/${id}`).set(as("owner")).send({ lines: [{ lineId: lines[0].id, quantity: 4 }], add: [] }).expect(200);
    await drainEvents(); // the copy edit is queued, not run yet
    const c = copyOf(id);
    c.tags = [...c.tags, "vip"]; // something else changed in the store meanwhile
    const wh = shop.webhook("orders/updated", { ...c, updatedAt: new Date(clock.now() + 500).toISOString() });
    await http().post(`/webhooks/shopify/${await shopifyId()}`).set(wh.headers).send(wh.body).expect(200);
    await settle();
    const d = await detail(id);
    expect(d.lines[0].quantity).toBe(4);
    expect(d.tags).toContain("vip");
    expect(copyOf(id).lines[0]!.quantity).toBe(4); // and the copy got it
  });

  it("an edit Shopify refuses (a new price) stays in Mizan; the copy is said to be out of date", async () => {
    const id = await typed({});
    const lines = (await detail(id)).lines;
    await http().patch(`/v1/orders/${id}`).set(as("owner")).send({ lines: [{ lineId: lines[0].id, quantity: 1, unitPrice: "1200" }], add: [] }).expect(200);
    await settle();
    await read(copyOf(id)); // the copy is read again (a tag, a fulfillment…)
    const d = await detail(id);
    expect(d.lines[0].unitPrice.amount).toBe("1200.00");
    expect(d.storeCopy).toMatchObject({ status: "failed", error: expect.stringMatching(/Out of date in Shopify/) });
  });

  it("a one-word name is not changed by Shopify's last-name placeholder", async () => {
    const id = await typed({ customer: { name: "Mona", phone: "01001234821" } });
    const c = copyOf(id);
    c.tags = [...c.tags, "x"];
    await read(c);
    const r = (await http().post(`/v1/orders/${id}/reveal`).set(as("owner")).send({ fields: ["name"] }).expect(200)).body;
    expect(JSON.stringify(r)).not.toMatch(/Mona -/);
  });

  it("a refund recorded in Mizan and also made on the copy is one refund", async () => {
    const id = await typed({ payment: { mode: "prepaid", method: "card" } });
    await http().post(`/v1/orders/${id}/payments`).set(as("owner")).send({ type: "refunded", method: "instapay", amount: "300" }).expect(201);
    const c = copyOf(id);
    c.refunded = "300.00";
    await read(c);
    expect(await detail(id)).toMatchObject({ refunded: { amount: "300.00" } });
  });

  it("the fulfillment of a Bosta delivery cancelled in Shopify: the shipment waits for a person (Bosta still has the parcel)", async () => {
    const id = await typed({});
    await confirm(id);
    const s = (await ship(id).expect(202)).body;
    await settle();
    const c = copyOf(id);
    c.fulfillments[0]!.status = "CANCELLED";
    await read(c);
    const row = (await http().get("/v1/shipments?view=review").set(as("owner")).expect(200)).body.data.find((x: { id: string }) => x.id === s.id);
    expect(row).toMatchObject({ needsReview: true, reviewReason: expect.stringMatching(/Fulfillment cancelled in Shopify/) });
    expect((await detail(id)).shipments[0]).toMatchObject({ booking: "booked" });
  });

  it("a copy read for the first time (no baseline) takes the change made in Shopify", async () => {
    const id = await typed({});
    // A baseline recorded by older code (lines, no version), e.g. by the previous worker during a deploy: counts as none.
    const c = copyOf(id);
    await db.tenant(store, (trx) => trx.updateTable("orders").set({ store_copy_snapshot: JSON.stringify({ sentPaid: "0", lines: { [c.lines[0]!.id]: { q: 3, p: c.lines[0]!.price } } }) }).where("id", "=", id).execute());
    c.lines[0]!.quantity = 3;
    c.total = (3 * Number(c.lines[0]!.price) + 50).toFixed(2);
    c.tags = [...c.tags, "from-shopify"];
    await read(c);
    const d = await detail(id);
    expect(d.lines[0].quantity).toBe(3);
    expect(d.tags).toContain("from-shopify");
    expect(d.total.amount).toBe(c.total);
  });

  it("marked fulfilled in Shopify with no tracking number: Mizan records it shipped (store courier), once", async () => {
    const id = await typed({});
    const c = copyOf(id);
    c.fulfillments.push({ id: "gid://shopify/Fulfillment/996001", status: "SUCCESS", trackingInfo: [] });
    await read(c);
    await read(c);
    const d = await detail(id);
    expect(d.status).toBe("shipped");
    expect(d.shipments).toEqual([expect.objectContaining({ booking: "booked", trackingNumber: null })]);
  });
});

describe("tracking links for couriers recorded by hand (U26)", () => {
  it("a courier by hand gets its tracking link: the one typed, then the courier's page remembered for its next parcels", async () => {
    const record = (id: string, body: object) => http().post(`/v1/orders/${id}/ship/manual`).set(as("wh")).send(body);
    const a = await manual({ mode: "cod" });
    const b = await manual({ mode: "cod" });
    const c = await manual({ mode: "cod" });
    for (const id of [a, b, c]) await confirm(id);
    const first = (await record(a, { courier: "Aramex Link", trackingNumber: "AX-501", trackingUrl: "https://track.aramex.example/?n=AX-501" }).expect(201)).body;
    expect(first.trackingUrl).toBe("https://track.aramex.example/?n=AX-501");
    const next = (await record(b, { courier: "aramex link", trackingNumber: "AX-502" }).expect(201)).body;
    expect(next.trackingUrl).toBe("https://track.aramex.example/?n=AX-502");
    await record(c, { courier: "Aramex Link", trackingNumber: "AX-503", trackingUrl: "http://insecure.example/AX-503" }).expect(422);
  });
});
