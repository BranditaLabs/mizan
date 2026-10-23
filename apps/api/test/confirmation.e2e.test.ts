import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import type { CanonicalOrder } from "@mizan/shared";
import { FakeMessaging } from "@mizan/engine/testing";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { EventDispatcher } from "../src/platform/events/dispatcher.js";
import { SecretsService } from "../src/platform/secrets/secrets.service.js";
import { OrderProjector } from "../src/modules/orders/order-projector.js";
import { linkToken, runIdOf } from "../src/modules/confirmation/confirmation-link.js";
import { ConfirmationRunner } from "../src/modules/confirmation/confirmation.runner.js";
import { DEFAULT_CONFIRMATION, nextCallingTime } from "../src/modules/confirmation/confirmation.settings.js";
import { MessagingRegistry } from "../src/modules/confirmation/messaging.registry.js";
import { smsText } from "../src/modules/confirmation/messages.js";
import { FakeVerifier } from "./support/fake-auth.js";

/** E6-7: a new COD order walks WhatsApp → SMS link → call → agent; any channel answers the same way. */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
let connectionId: string;
let vendor: FakeMessaging;
let n = 0;
const MIN = 60_000;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
const run = (at: Date) => app.get(ConfirmationRunner).runOnce(at);

function order(over: Partial<CanonicalOrder> = {}): CanonicalOrder {
  n++;
  const at = new Date(Date.now() - 30 * MIN).toISOString();
  return {
    connector: "shopify", externalId: `gid://shopify/Order/${8000 + n}`, number: `#${8000 + n}`, createdAt: at, updatedAt: at, currency: "EGP",
    total: { amount: "1250.00", currency: "EGP" }, subtotal: { amount: "1200.00", currency: "EGP" }, shipping: { amount: "50.00", currency: "EGP" },
    paymentMode: "cod", paymentStatus: "unpaid", gateways: ["Cash on Delivery (COD)"],
    received: { amount: "0.00", currency: "EGP" }, outstanding: { amount: "1250.00", currency: "EGP" }, refunded: { amount: "0.00", currency: "EGP" },
    cancelled: false, customer: { name: "Mona Adel", phone: "+201001234821" },
    shippingAddress: { name: "Mona Adel", phone: "01001234821", line1: "12 Abbas El Akkad St", city: "Nasr City", province: "Cairo", countryCode: "EG" },
    lines: [{ externalLineId: `L${n}`, sku: "AB-1", title: "Abaya", quantity: 2, unitPrice: { amount: "600.00", currency: "EGP" } }],
    fulfillmentGroups: [], tags: [], ...over,
  };
}
async function newOrder(over: Partial<CanonicalOrder> = {}): Promise<string> {
  const o = order(over);
  await app.get(OrderProjector).project(store, connectionId, o);
  await drain();
  return (await db.tenant(store, (trx) => trx.selectFrom("orders").select("id").where("number", "=", o.number).executeTakeFirstOrThrow())).id;
}
const orderRow = (id: string) => db.tenant(store, (trx) => trx.selectFrom("orders").select(["status", "confirmed_at", "cancelled_at", "ship_lat"]).where("id", "=", id).executeTakeFirstOrThrow());
const runOf = (orderId: string) => db.tenant(store, (trx) => trx.selectFrom("confirmation_runs").selectAll().where("order_id", "=", orderId).orderBy("started_at", "desc").executeTakeFirst());
const tokenFor = async (orderId: string) => linkToken(undefined, (await runOf(orderId))!.id);
const eventsOf = (orderId: string) => db.tenant(store, (trx) => trx.selectFrom("domain_events").select(["type", "data"]).where("entity_id", "=", orderId).orderBy("occurred_at").execute());

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  fake.add("owner", { uid: "fb-owner", email: "owner@nile.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Abayas", country: "EG" }).expect(201)).body.id;
  connectionId = await db.tenant(store, async (trx) => {
    const ref = await app.get(SecretsService).create(trx, store, JSON.stringify({ accessToken: "shpat_fake_token" }), { actor: { type: "system" } });
    return (await trx.insertInto("connections").values({ tenant_id: store, kind: "store", provider: "shopify", external_account: "nile.myshopify.com", secret_ref: ref }).returning("id").executeTakeFirstOrThrow()).id;
  });
  // Calls at any hour in these tests; calling hours have their own test below.
  await http().put("/v1/settings/confirmation").set(as("owner")).send({ ...DEFAULT_CONFIRMATION, callingHours: { start: "00:00", end: "23:59" } }).expect(200);
  for (const [token, phone, role] of [["agent", "01201117777", "agent"], ["finance", "01201115555", "finance"]] as const) {
    const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone, role }).expect(201);
    fake.add(token, { uid: `fb-${token}`, phone: inv.body.phone });
    await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: `Bearer ${token}` }).expect(200);
  }
});
beforeEach(async () => {
  vendor = new FakeMessaging();
  app.get(MessagingRegistry).use(vendor);
  // Each test starts with no live confirmation left over from the one before.
  await db.tenant(store, async (trx) => {
    await trx.updateTable("confirmation_steps").set({ status: "cancelled" }).where("status", "in", ["pending", "running"]).execute();
    await trx.updateTable("confirmation_runs").set({ status: "stopped" }).where("status", "in", ["running", "needs_agent"]).execute();
  });
});
afterAll(() => app.close());

describe("starting", () => {
  it("a new COD order waits for confirmation and gets a WhatsApp message with its link", async () => {
    const id = await newOrder();
    expect((await orderRow(id)).status).toBe("pending_confirmation");
    expect(await run(new Date())).toBe(1);
    const [msg] = vendor.of("whatsapp");
    expect(msg?.message).toMatchObject({ to: "+201001234821", template: "order_confirmation", lang: "ar", buttons: ["confirm", "change", "cancel"] });
    expect((msg?.message as { params: string[] }).params).toEqual(["أهلاً Mona", "Nile Abayas", `#${8000 + n}`, "1,250 ج.م."]);
    expect((msg?.message as { url: string }).url).toMatch(/^https:\/\/app\.mizan\.test\/ar\/c\/[A-Za-z0-9_-]{38}$/);
    expect((await eventsOf(id)).map((e) => e.type)).toEqual(expect.arrayContaining(["order.created", "confirmation.started", "confirmation.sent"]));
    expect(JSON.stringify(await eventsOf(id))).not.toMatch(/Mona|1001234821|Abbas/);
  });

  it("leaves prepaid orders, imported history and stores that turned it off alone", async () => {
    const prepaid = await newOrder({ paymentMode: "prepaid", paymentStatus: "paid", gateways: ["paymob"], received: { amount: "1250.00", currency: "EGP" }, outstanding: { amount: "0.00", currency: "EGP" } });
    const old = await newOrder({ createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString() });
    expect((await orderRow(prepaid)).status).toBe("new");
    expect((await orderRow(old)).status).toBe("new");
    expect(await runOf(prepaid)).toBeUndefined();
    expect(await runOf(old)).toBeUndefined();
    await http().put("/v1/settings/confirmation").set(as("owner")).send({ ...DEFAULT_CONFIRMATION, enabled: false, callingHours: { start: "00:00", end: "23:59" } }).expect(200);
    const off = await newOrder();
    expect((await orderRow(off)).status).toBe("new");
    await http().put("/v1/settings/confirmation").set(as("owner")).send({ ...DEFAULT_CONFIRMATION, callingHours: { start: "00:00", end: "23:59" } }).expect(200);
  });
});

describe("the cascade", () => {
  it("moves on when nobody answers: WhatsApp → SMS → call → call → agent", async () => {
    const id = await newOrder();
    const t0 = Date.now();
    await run(new Date(t0));
    await run(new Date(t0 + 121 * MIN)); // WhatsApp wait over → SMS
    expect(vendor.of("sms")).toHaveLength(1);
    expect((vendor.of("sms")[0]!.message as { text: string }).text).toMatch(/^أهلاً Mona، أوردرك #\d+ من Nile Abayas بـ .*أكّده أو عدّله من هنا: https:\/\/app\.mizan\.test\/ar\/c\//);
    await run(new Date(t0 + 242 * MIN)); // SMS wait over → call
    expect(vendor.of("voice")).toHaveLength(1);
    expect(vendor.of("voice")[0]!.message).toMatchObject({ digits: { "1": "confirm", "2": "change", "3": "cancel" } });
    await run(new Date(t0 + 303 * MIN)); // second call
    expect(vendor.of("voice")).toHaveLength(2);
    await run(new Date(t0 + 364 * MIN)); // last wait over → agent
    expect(await runOf(id)).toMatchObject({ status: "needs_agent", outcome: "no_reply" });
    expect((await orderRow(id)).status).toBe("pending_confirmation");
    expect((await eventsOf(id)).map((e) => e.type)).toContain("confirmation.escalated");
    expect(await run(new Date(t0 + 999 * MIN))).toBe(0); // nothing left to do
  });

  it("skips channels without a vendor, and goes straight to an agent when none is connected", async () => {
    vendor = new FakeMessaging(["sms"]);
    app.get(MessagingRegistry).use(vendor);
    const smsOnly = await newOrder();
    await run(new Date());
    expect(vendor.of("whatsapp")).toHaveLength(0);
    expect(vendor.of("sms")).toHaveLength(1);
    app.get(MessagingRegistry).use(null);
    const none = await newOrder();
    expect(await runOf(none)).toMatchObject({ status: "needs_agent", reason: "no_channel" });
    expect((await orderRow(none)).status).toBe("pending_confirmation");
    expect(await runOf(smsOnly)).toMatchObject({ status: "running" });
  });

  it("retries a vendor that fails for now, and moves on from a number it refuses", async () => {
    vendor.failNext = 1;
    const flaky = await newOrder();
    const t0 = Date.now();
    await run(new Date(t0));
    expect(vendor.of("whatsapp")).toHaveLength(0);
    await run(new Date(t0 + 2 * MIN)); // backoff 1 minute
    expect(vendor.of("whatsapp")).toHaveLength(1);
    expect(await runOf(flaky)).toMatchObject({ status: "running", step: 0 });

    vendor.refused.add("+201001234821");
    const refused = await newOrder();
    await run(new Date(t0 + 3 * MIN)); // WhatsApp refused → SMS refused → calls refused → agent
    for (let i = 0; i < 4; i++) await run(new Date(t0 + (4 + i) * MIN));
    expect(await runOf(refused)).toMatchObject({ status: "needs_agent" });
  });

  it("waits for calling hours before calling", () => {
    const cairo = "Africa/Cairo";
    const night = new Date("2026-10-23T21:30:00Z"); // 00:30 in Cairo (UTC+3 in summer time)
    const morning = nextCallingTime(night, { start: "10:00", end: "22:00" }, cairo);
    expect(new Intl.DateTimeFormat("en-GB", { timeZone: cairo, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(morning)).toBe("10:00");
    const day = new Date("2026-10-23T10:00:00Z");
    expect(nextCallingTime(day, { start: "10:00", end: "22:00" }, cairo)).toBe(day);
  });
});

describe("the customer's link", () => {
  it("shows the order without phone or address, and confirming it confirms the order", async () => {
    const id = await newOrder();
    await run(new Date());
    const token = await tokenFor(id);
    const view = await http().get(`/v1/public/confirm/${token}`).expect(200);
    expect(view.headers["cache-control"]).toBe("no-store");
    expect(view.body).toMatchObject({ store: "Nile Abayas", state: "open", firstName: "Mona", order: { items: [{ title: "Abaya", quantity: 2 }], total: { amount: "1250.00" }, cod: { amount: "1250.00" }, city: "Nasr City" }, hasLocation: false });
    expect(JSON.stringify(view.body)).not.toMatch(/1001234821|Abbas|Adel/);

    const done = await http().post(`/v1/public/confirm/${token}`).send({ answer: "confirm", location: { lat: 30.0561, lng: 31.3301 } }).expect(200);
    expect(done.body).toMatchObject({ state: "confirmed", hasLocation: true });
    expect(await orderRow(id)).toMatchObject({ status: "confirmed", ship_lat: 30.0561 });
    expect((await orderRow(id)).confirmed_at).not.toBeNull();
    expect(await runOf(id)).toMatchObject({ status: "confirmed", outcome: "confirmed", answered_channel: "link" });
    expect((await eventsOf(id)).map((e) => e.type)).toContain("order.confirmed");
    // The pending wait is cancelled: nothing else is sent.
    await run(new Date(Date.now() + 500 * MIN));
    expect(vendor.sent.filter((s) => (s.message as { url?: string; text?: string }).url?.endsWith(token) || (s.message as { text?: string }).text?.endsWith(token))).toHaveLength(1);
    // A second answer is refused.
    expect((await http().post(`/v1/public/confirm/${token}`).send({ answer: "cancel" }).expect(409)).body.code).toBe("already_answered");
    expect((await http().get(`/v1/public/confirm/${token}`).expect(200)).body.state).toBe("confirmed");
  });

  it("cancels with a reason, or asks for a change (an agent calls back), and keeps the note encrypted", async () => {
    const a = await newOrder();
    await http().post(`/v1/public/confirm/${await tokenFor(a)}`).send({ answer: "cancel", reason: "ordered_by_mistake" }).expect(200);
    expect((await orderRow(a)).status).toBe("cancelled");
    expect((await eventsOf(a)).map((e) => e.type)).toEqual(expect.arrayContaining(["order.cancelled", "order.confirmation_failed"]));

    const b = await newOrder();
    const changed = await http().post(`/v1/public/confirm/${await tokenFor(b)}`).send({ answer: "change", note: "Size L please, deliver after 5pm" }).expect(200);
    expect(changed.body.state).toBe("changed");
    expect(await runOf(b)).toMatchObject({ status: "needs_agent", outcome: "changed" });
    expect((await orderRow(b)).status).toBe("pending_confirmation");
    const note = await db.tenant(store, (trx) => trx.selectFrom("confirmations").select("notes").where("order_id", "=", b).executeTakeFirstOrThrow());
    expect(note.notes).toMatch(/^pii:v1:/);
  });

  it("refuses forged, unknown and expired links", async () => {
    await http().get("/v1/public/confirm/not-a-token").expect(404);
    await http().get(`/v1/public/confirm/${linkToken(undefined, "00000000-0000-4000-8000-000000000000")}`).expect(404);
    const forged = linkToken(Buffer.alloc(32, 9).toString("base64"), "00000000-0000-4000-8000-000000000000");
    expect(runIdOf(undefined, forged)).toBeNull();
    const id = await newOrder();
    await db.tenant(store, (trx) => trx.updateTable("confirmation_runs").set({ link_expires_at: new Date(Date.now() - MIN) }).where("order_id", "=", id).execute());
    const token = await tokenFor(id);
    expect((await http().get(`/v1/public/confirm/${token}`).expect(200)).body.state).toBe("expired");
    expect((await http().post(`/v1/public/confirm/${token}`).send({ answer: "confirm" }).expect(410)).body.code).toBe("link_expired");
    await http().post(`/v1/public/confirm/${token}`).send({ answer: "maybe" }).expect(422);
  });
});

describe("staff", () => {
  it("an agent sends the link by hand when no vendor is connected, then answers for the customer", async () => {
    app.get(MessagingRegistry).use(null);
    const id = await newOrder();
    const agentId = (await db.kysely.selectFrom("users").select("id").where("firebase_uid", "=", "fb-agent").executeTakeFirstOrThrow()).id;
    await db.tenant(store, (trx) => trx.updateTable("orders").set({ assigned_to: agentId }).where("id", "=", id).execute());

    const link = await http().post(`/v1/orders/${id}/confirmation/link`).set(as("agent")).expect(200);
    expect(link.body.url).toBe(`https://app.mizan.test/ar/c/${await tokenFor(id)}`);
    expect(link.body.whatsappUrl).toMatch(/^https:\/\/wa\.me\/201001234821\?text=/);
    expect(decodeURIComponent(link.body.whatsappUrl.split("text=")[1])).toContain(link.body.url);

    const summary = await http().get(`/v1/orders/${id}/confirmation`).set(as("agent")).expect(200);
    expect(summary.body).toMatchObject({ run: { status: "needs_agent", reason: "no_channel" }, channels: { whatsapp: false, sms: false, voice: false } });

    expect((await http().post(`/v1/orders/${id}/confirmation`).set(as("agent")).send({ answer: "confirm" }).expect(200)).body).toEqual({ outcome: "confirmed" });
    expect((await orderRow(id)).status).toBe("confirmed");
    expect((await http().post(`/v1/orders/${id}/confirmation`).set(as("agent")).send({ answer: "cancel" }).expect(409)).body.code).toBe("already_answered");
    const audit = await db.tenant(store, (trx) => trx.selectFrom("audit_log").select("action").where("entity_id", "=", id).execute());
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["confirmation.link_created", "confirmation.answered_by_agent"]));
  });

  it("follows roles: agents only their orders, finance not at all; settings for owner, admin, ops", async () => {
    const id = await newOrder();
    await http().get(`/v1/orders/${id}/confirmation`).set(as("agent")).expect(404);
    await http().post(`/v1/orders/${id}/confirmation/link`).set(as("finance")).expect(403);
    await http().get("/v1/settings/confirmation").set(as("agent")).expect(403);
    const s = await http().get("/v1/settings/confirmation").set(as("owner")).expect(200);
    expect(s.body.channels).toEqual({ whatsapp: true, sms: true, voice: true });
    await http().put("/v1/settings/confirmation").set(as("owner")).send({ ...DEFAULT_CONFIRMATION, callingHours: { start: "22:00", end: "10:00" } }).expect(422);
    await http().put("/v1/settings/confirmation").set(as("owner")).send({ ...DEFAULT_CONFIRMATION, steps: [{ channel: "fax", waitMinutes: 60 }] }).expect(422);
  });

  it("stops asking when the store cancels or the customer pays meanwhile", async () => {
    const o = order();
    await app.get(OrderProjector).project(store, connectionId, o);
    await drain();
    const id = (await db.tenant(store, (trx) => trx.selectFrom("orders").select("id").where("number", "=", o.number).executeTakeFirstOrThrow())).id;
    await app.get(OrderProjector).project(store, connectionId, { ...o, updatedAt: new Date().toISOString(), cancelled: true });
    await drain();
    expect(await runOf(id)).toMatchObject({ status: "stopped", reason: "cancelled_in_store" });
    await run(new Date(Date.now() + 999 * MIN));
    expect(vendor.sent).toHaveLength(0);
    const live = await db.tenant(store, (trx) => trx.selectFrom("confirmation_steps as s").innerJoin("confirmation_runs as r", "r.id", "s.run_id")
      .select("s.status").where("r.order_id", "=", id).where("s.status", "in", ["pending", "running"]).execute());
    expect(live).toEqual([]);
  });
});

describe("messages", () => {
  it("speak English for an English store", () => {
    expect(smsText({ lang: "en", store: "Nile", firstName: null, number: "#1", total: { amount: "100.00", currency: "EGP" }, cod: { amount: "0.00", currency: "EGP" }, link: "https://x/c/t" }))
      .toBe("Hi, your order #1 from Nile is EGP 100. Confirm or change it here: https://x/c/t");
  });
});
