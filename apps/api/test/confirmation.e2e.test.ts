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
import { linkToken, parseActionId, runIdOf } from "../src/modules/confirmation/confirmation-link.js";
import { ConfirmationRunner } from "../src/modules/confirmation/confirmation.runner.js";
import { confirmationSettings, DEFAULT_CONFIRMATION, nextCallingTime } from "../src/modules/confirmation/confirmation.settings.js";
import { MessagingRegistry } from "../src/modules/confirmation/messaging.registry.js";
import { callScript, linkText } from "../src/modules/confirmation/messages.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E6-7, E6-10: a new COD order walks the store's cascade (WhatsApp → team call by default; an
 * automated call when a voice vendor is connected); any channel answers the same way. The
 * WhatsApp conversation itself (taps, replies, statuses) is in whatsapp-chat.e2e.test.ts.
 */
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
  await http().put("/v1/settings/orders").set(as("owner")).send({ duplicateWindowHours: 0 }).expect(200); // the same test customer orders again and again (E5-3 has its own test)
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
  it("a new COD order waits for confirmation and gets the WhatsApp template with signed buttons, no link", async () => {
    const id = await newOrder();
    expect((await orderRow(id)).status).toBe("pending_confirmation");
    expect(await run(new Date())).toBe(1);
    const [msg] = vendor.of("whatsapp");
    expect(msg?.message).toMatchObject({ to: "+201001234821", template: "mizan_order_confirm_ar", lang: "ar" });
    expect((msg?.message as { params: string[] }).params).toEqual(["أهلاً Mona", "Nile Abayas", `#${8000 + n}`, "1,250 ج.م. عند الاستلام"]);
    expect((msg?.message as { url?: string }).url).toBeUndefined();
    const runId = (await runOf(id))!.id;
    expect((msg?.message as { buttons: string[] }).buttons.map((b) => parseActionId(undefined, b))).toEqual(["confirm", "change", "cancel"].map((action) => ({ runId, action })));
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
  it("by default: WhatsApp, then after 2 hours the order goes on the team's call list", async () => {
    const id = await newOrder();
    const t0 = Date.now();
    await run(new Date(t0));
    expect(await runOf(id)).toMatchObject({ status: "running", step: 0 });
    await run(new Date(t0 + 121 * MIN)); // WhatsApp wait over → the team calls
    expect(await runOf(id)).toMatchObject({ status: "needs_agent", reason: "team_call", step: 1 });
    expect(vendor.sent).toHaveLength(1); // nothing automated after WhatsApp
    expect((await orderRow(id)).status).toBe("pending_confirmation");
    expect((await eventsOf(id)).map((e) => e.type)).toContain("confirmation.escalated");
    expect(await run(new Date(t0 + 999 * MIN))).toBe(0); // nothing left to do
  });

  it("with an automated call in the cascade: WhatsApp → call (calling hours) → team", async () => {
    await http().put("/v1/settings/confirmation").set(as("owner")).send({
      ...DEFAULT_CONFIRMATION, callingHours: { start: "00:00", end: "23:59" },
      steps: [{ channel: "whatsapp", waitMinutes: 60 }, { channel: "call_auto", waitMinutes: 60 }, { channel: "call_team", waitMinutes: 60 }],
    }).expect(200);
    const id = await newOrder();
    const t0 = Date.now();
    await run(new Date(t0));
    await run(new Date(t0 + 61 * MIN));
    expect(vendor.of("voice")).toHaveLength(1);
    expect(vendor.of("voice")[0]!.message).toMatchObject({ digits: { "1": "confirm", "2": "change", "3": "cancel" } });
    await run(new Date(t0 + 122 * MIN));
    expect(await runOf(id)).toMatchObject({ status: "needs_agent", reason: "team_call" });
    await http().put("/v1/settings/confirmation").set(as("owner")).send({ ...DEFAULT_CONFIRMATION, callingHours: { start: "00:00", end: "23:59" } }).expect(200);
  });

  it("without WhatsApp the order goes straight to the team; with nothing at all, no_channel", async () => {
    app.get(MessagingRegistry).use(null);
    const none = await newOrder();
    expect(await runOf(none)).toMatchObject({ status: "needs_agent", reason: "team_call" });
    expect((await orderRow(none)).status).toBe("pending_confirmation");
    await http().put("/v1/settings/confirmation").set(as("owner")).send({ ...DEFAULT_CONFIRMATION, steps: [{ channel: "whatsapp", waitMinutes: 60 }], callingHours: { start: "00:00", end: "23:59" } }).expect(200);
    const nothing = await newOrder();
    expect(await runOf(nothing)).toMatchObject({ status: "needs_agent", reason: "no_channel" });
    await http().put("/v1/settings/confirmation").set(as("owner")).send({ ...DEFAULT_CONFIRMATION, callingHours: { start: "00:00", end: "23:59" } }).expect(200);
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
    await run(new Date(t0 + 3 * MIN)); // WhatsApp refused → the team
    expect(await runOf(refused)).toMatchObject({ status: "needs_agent", reason: "team_call" });
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
    expect(vendor.sent).toHaveLength(1);
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
    expect(summary.body).toMatchObject({ run: { status: "needs_agent", reason: "team_call", calls: { attempts: 0, max: 3 } }, channels: { whatsapp: false, call_auto: false, call_team: true } });
    expect(summary.body.script).toEqual(callScript({ lang: "ar", store: "Nile Abayas", firstName: "Mona", number: `#${8000 + n}`, total: { amount: "1250.00", currency: "EGP" }, cod: { amount: "1250.00", currency: "EGP" }, link: "", items: [{ title: "Abaya", quantity: 2 }], city: "Nasr City" }));
    expect(summary.body.script[0]).toBe("أهلاً Mona، معاك فريق Nile Abayas.");

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
    expect(s.body.channels).toEqual({ whatsapp: true, call_auto: true, call_team: true });
    // The team call ends the automatic part: it must be last.
    await http().put("/v1/settings/confirmation").set(as("owner")).send({ ...DEFAULT_CONFIRMATION, steps: [{ channel: "call_team", waitMinutes: 60 }, { channel: "whatsapp", waitMinutes: 60 }] }).expect(422);
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

describe("team calls (E6-10)", () => {
  it("the call list shows escalated orders; no answer hides the order until the retry time, then unreachable", async () => {
    app.get(MessagingRegistry).use(null);
    const id = await newOrder();
    const list = async () => (await http().get("/v1/orders?confirmation=needs_call").set(as("owner")).expect(200)).body;
    expect((await list()).data.map((o: { id: string }) => o.id)).toContain(id);
    expect((await list()).needsCall).toBeGreaterThan(0);

    const first = await http().post(`/v1/orders/${id}/confirmation/no-answer`).set(as("owner")).expect(200);
    expect(first.body).toMatchObject({ attempts: 1, max: 3, unreachable: false });
    expect(Date.parse(first.body.after)).toBeGreaterThan(Date.now() + 50 * MIN);
    expect((await list()).data.map((o: { id: string }) => o.id)).not.toContain(id); // back after the retry time
    await http().post(`/v1/orders/${id}/confirmation/no-answer`).set(as("owner")).expect(200);
    const last = await http().post(`/v1/orders/${id}/confirmation/no-answer`).set(as("owner")).expect(200);
    expect(last.body).toMatchObject({ attempts: 3, after: null, unreachable: true });
    expect(await runOf(id)).toMatchObject({ reason: "unreachable", call_attempts: 3 });
    expect((await list()).data.map((o: { id: string }) => o.id)).toContain(id); // stays, marked unreachable

    // Reached on a later call: confirmed by the team, counted as a team call.
    await http().post(`/v1/orders/${id}/confirmation`).set(as("owner")).send({ answer: "confirm", byCall: true }).expect(200);
    expect(await runOf(id)).toMatchObject({ status: "confirmed", answered_channel: "call_team" });
    await http().post(`/v1/orders/${id}/confirmation/no-answer`).set(as("owner")).expect(409);
    const tries = await db.tenant(store, (trx) => trx.selectFrom("confirmations").select(["channel", "outcome"]).where("order_id", "=", id).orderBy("started_at").execute());
    expect(tries.filter((t) => t.channel === "call_team").map((t) => t.outcome)).toEqual(["no_answer", "no_answer", "no_answer", "confirmed"]);
  });

  it("reads settings saved before E6-10: SMS dropped, an automated voice call becomes call_auto", () => {
    const s = confirmationSettings({ confirmation: { enabled: true, steps: [{ channel: "whatsapp", waitMinutes: 120 }, { channel: "sms", waitMinutes: 120 }, { channel: "voice", waitMinutes: 60 }], callingHours: { start: "10:00", end: "22:00" }, linkHours: 72 } });
    expect(s.steps).toEqual([{ channel: "whatsapp", waitMinutes: 120 }, { channel: "call_auto", waitMinutes: 60 }]);
    expect(s.teamCalls).toEqual({ attempts: 3, retryMinutes: 60 });
    expect(confirmationSettings({ confirmation: { steps: [{ channel: "sms", waitMinutes: 10 }] } }).steps).toEqual(DEFAULT_CONFIRMATION.steps);
  });
});

describe("messages", () => {
  it("speak English for an English store", () => {
    expect(linkText({ lang: "en", store: "Nile", firstName: null, number: "#1", total: { amount: "100.00", currency: "EGP" }, cod: { amount: "0.00", currency: "EGP" }, link: "https://x/c/t" }))
      .toBe("Hi, your order #1 from Nile is EGP 100. Confirm or change it here: https://x/c/t");
  });
});

describe("the store's script (E6-5)", () => {
  it("is saved with the settings, previewed with a real order or a sample, and refuses unknown variables", async () => {
    const script = { pack: "egyptian", texts: { ar: { confirmed: "تمام يا {{customer.first_name}} ✅ {{order.number}} اتأكّد" }, en: { confirmed: "All set {{customer.first_name}} ✅ {{order.number}} is confirmed", call: "Hi {{customer.first_name}}\nConfirming {{order.number}} for {{order.cod}}" } } };
    const saved = (await http().put("/v1/settings/confirmation").set(as("owner")).send({ ...DEFAULT_CONFIRMATION, callingHours: { start: "00:00", end: "23:59" }, script }).expect(200)).body;
    expect(saved.settings.script).toMatchObject({ ...script, version: 2 });
    expect((await http().get("/v1/settings/confirmation").set(as("owner")).expect(200)).body.settings.script).toMatchObject({ ...script, version: 2 });

    const sample = (await http().post("/v1/settings/confirmation/preview").set(as("owner")).send({ script }).expect(200)).body;
    expect(sample.sample).toBe(true);
    expect(sample.replies.find((r: { key: string }) => r.key === "confirmed")).toMatchObject({ branch: "confirm" });
    expect(sample.replies.map((r: { branch: string }) => r.branch)).toEqual(["confirm", "change", "change", "cancel", "cancel"]);

    const o = await http().post("/v1/orders").set(as("owner")).send({
      source: "phone", customer: { name: "Mona Adel", phone: "01001234821" }, address: { line1: "12 Abbas El Akkad St", city: "Nasr City" },
      lines: [{ title: "Abaya", quantity: 1, unitPrice: "1250" }], shipping: "0", payment: { mode: "cod" },
    }).expect(201);
    const real = (await http().post("/v1/settings/confirmation/preview").set(as("owner")).send({ script, orderId: o.body.id }).expect(200)).body;
    const lang = real.lang as "ar" | "en";
    const confirmed = real.replies.find((r: { key: string }) => r.key === "confirmed").text as string;
    expect(confirmed).toBe(lang === "ar" ? `تمام يا Mona ✅ ${o.body.number} اتأكّد` : `All set Mona ✅ ${o.body.number} is confirmed`);
    expect(JSON.stringify(real)).not.toMatch(/0100|Abbas/); // the first name, never the phone or address

    // E6-16a: a draft's problems come back as issues (200); saving it is what refuses (422).
    const badScript = { ...script, texts: { ar: { confirmed: "{{customer.phone}}" }, en: {} } };
    const bad = (await http().post("/v1/settings/confirmation/preview").set(as("owner")).send({ script: badScript }).expect(200)).body;
    expect(bad.issues).toContainEqual({ path: ["texts", "ar", "confirmed"], code: "unknown_variable", variable: "customer.phone" });
    const refused = (await http().put("/v1/settings/confirmation").set(as("owner")).send({ ...DEFAULT_CONFIRMATION, script: badScript }).expect(422)).body;
    expect(refused.errors[0]).toMatchObject({ path: "script.texts.ar.confirmed", code: "unknown_variable", variable: "customer.phone" });
    await http().post("/v1/settings/confirmation/preview").set(as("finance")).send({ script }).expect(403);
    await http().post("/v1/settings/confirmation/preview").set(as("owner")).send({ script, orderId: "00000000-0000-4000-8000-000000000000" }).expect(404);
    // Back to the built-in wording for the other tests.
    await http().put("/v1/settings/confirmation").set(as("owner")).send({ ...DEFAULT_CONFIRMATION, callingHours: { start: "00:00", end: "23:59" } }).expect(200);
  });
});

describe("every chat word editable (E6-16a)", () => {
  const reset = () => http().put("/v1/settings/confirmation").set(as("owner")).send({ ...DEFAULT_CONFIRMATION, callingHours: { start: "00:00", end: "23:59" } }).expect(200);
  const storedScript = () => db.tenant(store, async (trx) => ((await trx.selectFrom("tenants").select("settings").where("id", "=", store).executeTakeFirstOrThrow()).settings as { confirmation?: { script?: Record<string, unknown> } }).confirmation?.script);
  const writeRaw = (script: unknown) => db.tenant(store, async (trx) => {
    const t = await trx.selectFrom("tenants").select("settings").where("id", "=", store).executeTakeFirstOrThrow();
    const s = t.settings as { confirmation?: Record<string, unknown> };
    await trx.updateTable("tenants").set({ settings: JSON.stringify({ ...s, confirmation: { ...s.confirmation, script } }) }).where("id", "=", store).execute();
  });

  it("the catalogue: for those who manage confirmation, cached until the next deploy", async () => {
    const res = await http().get("/v1/settings/confirmation/script-catalogue").set(as("owner")).expect(200);
    expect(res.headers["cache-control"]).toBe("private, max-age=3600");
    expect(res.body.packs).toEqual(["egyptian", "formal", "gulf"]);
    expect(res.body.keys.find((k: { key: string }) => k.key === "btn_offer_yes")).toMatchObject({ kind: "button", limit: 20, vars: [] });
    expect(res.body.packTexts.gulf.ar.confirmed).toContain("{{order.number}}");
    expect(res.body.templateText.ar.buttons).toEqual(["أكّد الأوردر", "عايز أعدّل", "ألغي الأوردر"]);
    await http().get("/v1/settings/confirmation/script-catalogue").set({ ...as("owner"), "If-None-Match": res.headers.etag }).expect(304);
    await http().get("/v1/settings/confirmation/script-catalogue").set({ ...as("owner"), "If-None-Match": `"x", W/${res.headers.etag}` }).expect(304);
    await http().get("/v1/settings/confirmation/script-catalogue").set(as("finance")).expect(403);
  });

  it("a text saved before that now counts too long never blocks saving the rest; editing it does", async () => {
    const long = `${"و".repeat(850)} {{order.items}}`; // v1 counted the raw text; v2 counts the items at their width
    await writeRaw({ pack: "egyptian", texts: { ar: { change_received: long }, en: {} } });
    const got = (await http().get("/v1/settings/confirmation").set(as("owner")).expect(200)).body;
    expect(got.scriptIssues).toContainEqual(expect.objectContaining({ path: ["texts", "ar", "change_received"], code: "too_long" }));
    const saved = (await http().put("/v1/settings/confirmation").set(as("owner")).send({ ...got.settings, callingHours: { start: "08:00", end: "23:00" } }).expect(200)).body;
    expect(saved.scriptIssues).toEqual(got.scriptIssues); // the save answers what GET would
    // A v1 text that v2 reads stricter (only variables) is kept the same way, and a new one is refused.
    await writeRaw({ pack: "egyptian", texts: { ar: { cancelled: "{{order.number}}." }, en: {} } });
    const v1 = (await http().get("/v1/settings/confirmation").set(as("owner")).expect(200)).body;
    expect(v1.scriptIssues).toContainEqual(expect.objectContaining({ path: ["texts", "ar", "cancelled"], code: "only_variables" }));
    await http().put("/v1/settings/confirmation").set(as("owner")).send({ ...v1.settings, callingHours: { start: "09:00", end: "23:00" } }).expect(200);
    const fresh = { ...v1.settings, script: { ...v1.settings.script, texts: { ar: { cancelled: "{{order.number}}" }, en: {} } } };
    expect((await http().put("/v1/settings/confirmation").set(as("owner")).send(fresh).expect(422)).body.errors[0]).toMatchObject({ path: "script.texts.ar.cancelled", code: "only_variables" });
    const edited = { ...got.settings, script: { ...got.settings.script, texts: { ar: { change_received: `${long}!` }, en: {} } } };
    const refused = (await http().put("/v1/settings/confirmation").set(as("owner")).send(edited).expect(422)).body;
    expect(refused.errors[0]).toMatchObject({ path: "script.texts.ar.change_received", code: "too_long", limit: 1000 });
    expect(refused.errors[0].length).toBeGreaterThan(1000);
    await reset();
  });

  it("preview v2: a chat per scenario, the template first and not editable, the store's reasons, a placeholder link", async () => {
    const script = {
      version: 2, pack: "gulf",
      texts: { ar: { cancel_header: "طلب {{order.number}} من {{store.name}}", footer: "مع {{store.name}}" }, en: {} },
      cancelReasons: [{ id: "wrong_size", code: "changed_mind", title: { ar: "المقاس مو مضبوط" }, description: { ar: "نبدّله لك" } }, { id: "late", code: "delivery_too_late", title: { ar: "التوصيل متأخر" } }],
    };
    const o = await http().post("/v1/orders").set(as("owner")).send({
      source: "phone", customer: { name: "Mona Adel", phone: "01001234821" }, address: { line1: "12 Abbas El Akkad St", city: "Nasr City" },
      lines: [{ title: "Abaya", quantity: 1, unitPrice: "1250" }], shipping: "0", payment: { mode: "cod" },
    }).expect(201);
    const p = (await http().post("/v1/settings/confirmation/preview").set(as("owner")).send({ script, orderId: o.body.id }).expect(200)).body;
    expect(p.lang).toBe("ar");
    expect(p.issues).toEqual([]);
    expect(p.conversations.map((c: { scenario: string }) => c.scenario)).toEqual(["confirm", "confirm_offer", "change", "cancel", "message", "already", "opt_out", "opt_in"]);
    for (const c of p.conversations) expect(c.turns[0]).toMatchObject({ from: "business", kind: "template", editable: false });
    // E6-16d: the gulf pack's first message, as the store would send it (no WhatsApp number here: its state is unknown).
    expect(p.template).toEqual({ variant: "ar_gulf", name: "mizan_order_confirm_ar_gulf", status: "UNKNOWN" });
    expect(p.conversations[0].turns[0].body).toMatch(new RegExp(`^👋 .+\\nوصلنا طلبك رقم ${o.body.number} من Nile Abayas\\.`));
    expect(p.conversations[0].turns[0].buttons).toEqual(["أكّد الطلب", "أبي أعدّل", "ألغِ الطلب"]);
    expect(p.conversations[0].turns[1]).toMatchObject({ kind: "tap", text: "أكّد الطلب" });
    // The owner's own choice wins over the pack's.
    const chosen = (await http().post("/v1/settings/confirmation/preview").set(as("owner")).send({ script: { ...script, template: "ar_egyptian" }, orderId: o.body.id }).expect(200)).body;
    expect(chosen.template).toMatchObject({ variant: "ar_egyptian", name: "mizan_order_confirm_ar" });
    expect(chosen.conversations[0].turns[0].body).toContain(`أوردرك رقم ${o.body.number} من Nile Abayas وصلنا.`);
    const cancel = p.conversations.find((c: { scenario: string }) => c.scenario === "cancel").turns.find((t: { kind: string }) => t.kind === "list");
    expect(cancel).toMatchObject({ key: "cancel_prompt", editable: true, header: `طلب ${o.body.number} من Nile Abayas`, footer: "مع Nile Abayas" });
    expect(cancel.list.rows).toEqual([{ title: "المقاس مو مضبوط", description: "نبدّله لك" }, { title: "التوصيل متأخر" }, { title: "لا، كمّل الطلب" }]);
    expect(p.conversations[0].turns.at(-1).text).toContain("تم ✅ طلبك");
    const offered = p.conversations.find((c: { scenario: string }) => c.scenario === "confirm_offer").turns.find((t: { kind: string }) => t.kind === "buttons");
    expect(offered.buttons).toEqual(["أضفه", "لا، شكراً"]); // a sample offer when the store has none
    expect(p.link).toContain("https://app.mizan.test/ar/c/xxxxxxxx");
    expect(JSON.stringify(p)).not.toMatch(/0100|1234821|Abbas/); // the first name, never the phone or address
    const en = (await http().post("/v1/settings/confirmation/preview").set(as("owner")).send({ script, lang: "en" }).expect(200)).body;
    expect(en.lang).toBe("en");
    expect(en.link).toContain("https://app.mizan.test/en/c/xxxxxxxx");
    expect(en.replies).toHaveLength(5); // the v1 shape, until E6-16b
    expect(en.template).toMatchObject({ variant: "en", name: "mizan_order_confirm_en" });
    expect(en.conversations[0].turns[0].buttons).toEqual(["Confirm order", "I want a change", "Cancel order"]);
  });

  it("saving refuses with the exact paths, in Arabic and English texts", async () => {
    const send = (script: unknown) => http().put("/v1/settings/confirmation").set(as("owner")).send({ ...DEFAULT_CONFIRMATION, script });
    const long = (await send({ pack: "egyptian", texts: { ar: {}, en: { btn_offer_yes: "Yes please, add it now" } } }).expect(422)).body;
    expect(long.errors).toEqual([{ path: "script.texts.en.btn_offer_yes", code: "too_long", limit: 20, length: 22 }]);
    const ar = (await send({ pack: "egyptian", texts: { ar: { link_text: "أكّد أوردرك" }, en: {} } }).expect(422)).body;
    expect(ar.errors).toEqual([expect.objectContaining({ path: "script.texts.ar.link_text", code: "missing_variable" })]);
    // Known only with the store's language: an Arabic store's reason needs an Arabic title.
    const reasons = (await send({ pack: "egyptian", texts: { ar: {}, en: {} }, cancelReasons: [{ id: "late", code: "other", title: { en: "Late" } }] }).expect(422)).body;
    expect(reasons.errors).toEqual([{ path: "script.cancelReasons.0.title.ar", code: "reason_title_required" }]);
    expect(await storedScript()).toBeUndefined();
  });

  it("a script saved before E6-16a reads as v2, previews, and the next save writes version 2", async () => {
    await writeRaw({ pack: "egyptian", texts: { ar: { change_received: "وصلنا يا {{customer.first_name}}" }, en: {} } });
    const got = (await http().get("/v1/settings/confirmation").set(as("owner")).expect(200)).body;
    expect(got.settings.script).toEqual({ version: 2, pack: "egyptian", texts: { ar: { change_received: "وصلنا يا {{customer.first_name}}" }, en: {} } });
    expect(got.scriptIssues).toEqual([]);
    const p = (await http().post("/v1/settings/confirmation/preview").set(as("owner")).send({ script: got.settings.script }).expect(200)).body;
    expect(p.conversations.find((c: { scenario: string }) => c.scenario === "message").turns.at(-1).text).toBe("وصلنا يا منى");
    await http().put("/v1/settings/confirmation").set(as("owner")).send({ ...got.settings, script: { pack: "egyptian", texts: got.settings.script.texts } }).expect(200);
    expect(await storedScript()).toMatchObject({ version: 2, pack: "egyptian" });
    await reset();
  });

  it("scriptIssues: renaming the store can push a saved text over its limit; the text is kept", async () => {
    const header = `${"x".repeat(45)} {{store.name}}`;
    await http().put("/v1/settings/confirmation").set(as("owner")).send({ ...DEFAULT_CONFIRMATION, script: { pack: "egyptian", texts: { ar: { cancel_header: header }, en: {} } } }).expect(200);
    expect((await http().get("/v1/settings/confirmation").set(as("owner")).expect(200)).body.scriptIssues).toEqual([]);
    const name = await db.tenant(store, async (trx) => (await trx.selectFrom("tenants").select("name").where("id", "=", store).executeTakeFirstOrThrow()).name);
    await db.tenant(store, (trx) => trx.updateTable("tenants").set({ name: "Nile Abayas and Scarves of Cairo" }).where("id", "=", store).execute());
    const after = (await http().get("/v1/settings/confirmation").set(as("owner")).expect(200)).body;
    expect(after.scriptIssues).toEqual([{ path: ["texts", "ar", "cancel_header"], code: "too_long", limit: 60, length: 78 }]);
    expect(after.settings.script.texts.ar.cancel_header).toBe(header);
    await db.tenant(store, (trx) => trx.updateTable("tenants").set({ name }).where("id", "=", store).execute());
    await reset();
  });
});

