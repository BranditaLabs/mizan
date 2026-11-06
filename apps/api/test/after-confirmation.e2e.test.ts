import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import { DEFAULT_AFTER, type AfterConfirmation, type CanonicalOrder } from "@mizan/shared";
import { FakeMessaging } from "@mizan/engine/testing";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { EventDispatcher } from "../src/platform/events/dispatcher.js";
import { SecretsService } from "../src/platform/secrets/secrets.service.js";
import { OrderProjector } from "../src/modules/orders/order-projector.js";
import { ConfirmationRunner } from "../src/modules/confirmation/confirmation.runner.js";
import { DEFAULT_CONFIRMATION } from "../src/modules/confirmation/confirmation.settings.js";
import { MessagingRegistry } from "../src/modules/confirmation/messaging.registry.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E6-23a: what happens after confirmation, end to end. Defaults change nothing; a grace window
 * keeps the order off packing, then it books once through Mizan's shipping; the money rules hold;
 * an order nobody answered is cancelled only when every guard holds.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
let connectionId: string;
let courierId: string;
let n = 0;
const MIN = 60_000;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
const runAt = async (at: Date) => { await app.get(ConfirmationRunner).runOnce(at); await drain(); };

function order(over: Partial<CanonicalOrder> = {}): CanonicalOrder {
  n++;
  const at = new Date(Date.now() - 30 * MIN).toISOString();
  return {
    connector: "shopify", externalId: `gid://shopify/Order/${9100 + n}`, number: `#${9100 + n}`, createdAt: at, updatedAt: at, currency: "EGP",
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
const confirm = async (id: string, token = "owner") => { await http().post(`/v1/orders/${id}/confirmation`).set(as(token)).send({ answer: "confirm" }).expect(200); await drain(); };
const save = (s: AfterConfirmation) => http().put("/v1/settings/after-confirmation").set(as("owner")).send(s);
const settings = (patch: (s: AfterConfirmation) => void) => { const s = structuredClone(DEFAULT_AFTER); patch(s); return s; };
const orderRow = (id: string) => db.tenant(store, (trx) => trx.selectFrom("orders").select(["status", "held_until", "hold_reason", "tags", "cancelled_at"]).where("id", "=", id).executeTakeFirstOrThrow());
const shipments = (id: string) => db.tenant(store, (trx) => trx.selectFrom("shipments").select(["id", "cod_minor", "connection_id", "booking"]).where("order_id", "=", id).execute());
const followups = (id: string) => db.tenant(store, (trx) => trx.selectFrom("order_followups").select(["kind", "status", "result", "auto_book"]).where("order_id", "=", id).execute());
const timeline = (id: string) => db.tenant(store, (trx) => trx.selectFrom("order_events").select(["type", "actor_type", "data"]).where("order_id", "=", id).orderBy("created_at").execute());
const eventTypes = async (id: string) => (await db.tenant(store, (trx) => trx.selectFrom("domain_events").select("type").where("entity_id", "=", id).orderBy("occurred_at").execute())).map((e) => e.type);
const outboxJobs = (kind: string) => db.tenant(store, (trx) => trx.selectFrom("mz_outbox").select(["kind", "payload"]).where("kind", "=", kind).execute());

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  fake.add("owner", { uid: "fb-owner", email: "owner@after.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Abayas", country: "EG" }).expect(201)).body.id;
  [connectionId, courierId] = await db.tenant(store, async (trx) => {
    const secrets = app.get(SecretsService);
    const ref = await secrets.create(trx, store, JSON.stringify({ accessToken: "shpat_fake_token" }), { actor: { type: "system" } });
    const shop = await trx.insertInto("connections").values({ tenant_id: store, kind: "store", provider: "shopify", external_account: "nile.myshopify.com", secret_ref: ref }).returning("id").executeTakeFirstOrThrow();
    const bref = await secrets.create(trx, store, JSON.stringify({ apiKey: "bosta-key", webhookToken: ["whsec", "bosta", "0123456789"].join("-") }), { actor: { type: "system" } });
    const bosta = await trx.insertInto("connections").values({ tenant_id: store, kind: "courier", provider: "bosta", external_account: "bosta-1", secret_ref: bref, status: "active" }).returning("id").executeTakeFirstOrThrow();
    return [shop.id, bosta.id];
  });
  await http().put("/v1/settings/confirmation").set(as("owner")).send({ ...DEFAULT_CONFIRMATION, callingHours: { start: "00:00", end: "23:59" } }).expect(200);
  await http().put("/v1/settings/orders").set(as("owner")).send({ duplicateWindowHours: 0 }).expect(200);
  const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone: "01201117777", role: "agent" }).expect(201);
  fake.add("agent", { uid: "fb-agent", phone: inv.body.phone });
  await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: "Bearer agent" }).expect(200);
});
beforeEach(async () => {
  app.get(MessagingRegistry).use(new FakeMessaging());
  await save(DEFAULT_AFTER).expect(200);
  await db.tenant(store, async (trx) => {
    await trx.updateTable("confirmation_runs").set({ status: "stopped" }).where("status", "in", ["running", "needs_agent"]).execute();
    await trx.updateTable("order_followups").set({ status: "skipped" }).where("status", "=", "pending").execute();
  });
});
afterAll(() => app.close());

describe("the defaults", () => {
  it("change nothing: no hold, no follow-up, no booking, no tags", async () => {
    const id = await newOrder();
    await confirm(id);
    expect(await orderRow(id)).toMatchObject({ status: "confirmed", held_until: null, hold_reason: null, tags: [] });
    expect(await followups(id)).toEqual([]);
    await runAt(new Date(Date.now() + 200 * MIN));
    expect(await shipments(id)).toEqual([]);
  });
});

describe("confirmed", () => {
  it("held for the change window, off the ready-to-ship list, then booked once through shipping with the cash to collect", async () => {
    await save(settings((s) => { s.confirmed.graceMinutes = 30; s.confirmed.autoBook.enabled = true; s.confirmed.tags = ["mizan-ok"]; })).expect(200);
    const id = await newOrder();
    await confirm(id);
    const row = await orderRow(id);
    expect(row).toMatchObject({ status: "confirmed", hold_reason: "grace", tags: ["mizan-ok"] });
    expect((await http().get("/v1/orders?shipping=ready").set(as("owner")).expect(200)).body.data.map((o: { id: string }) => o.id)).not.toContain(id);
    const card = (await http().get(`/v1/orders/${id}/confirmation`).set(as("owner")).expect(200)).body.after;
    expect(card).toMatchObject({ holdReason: "grace", heldUntil: expect.any(String), followups: [expect.objectContaining({ kind: "release", status: "pending", autoBook: true })] });

    const t0 = row.held_until!.getTime() - 30 * MIN;
    await runAt(new Date(t0 + 29 * MIN));
    expect(await shipments(id)).toEqual([]);
    await runAt(new Date(t0 + 31 * MIN));
    const [s] = await shipments(id);
    expect(s).toMatchObject({ cod_minor: 125000n, connection_id: courierId, booking: "pending" });
    expect(await orderRow(id)).toMatchObject({ held_until: null, hold_reason: null });
    expect(await followups(id)).toEqual([{ kind: "release", status: "done", result: "ready", auto_book: true }]);
    expect(await eventTypes(id)).toEqual(expect.arrayContaining(["order.confirmed", "order.ready_to_ship", "order.tagged"]));
    expect((await outboxJobs("bosta.ship")).filter((j) => (j.payload as { orderId?: string }).orderId === id)).toHaveLength(1);

    // Again (a second pass, a redelivered event): still one shipment.
    await runAt(new Date(t0 + 60 * MIN));
    expect(await shipments(id)).toHaveLength(1);
  });

  it("a cancel during the window: nothing books, the hold ends", async () => {
    await save(settings((s) => { s.confirmed.graceMinutes = 30; s.confirmed.autoBook.enabled = true; })).expect(200);
    const id = await newOrder();
    await confirm(id);
    const t0 = (await orderRow(id)).held_until!.getTime() - 30 * MIN;
    await db.tenant(store, (trx) => trx.updateTable("orders").set({ status: "cancelled", cancelled_at: new Date() }).where("id", "=", id).execute());
    await runAt(new Date(t0 + 31 * MIN));
    expect(await shipments(id)).toEqual([]);
    expect(await followups(id)).toEqual([expect.objectContaining({ status: "skipped", result: "order_moved" })]);
    expect(await orderRow(id)).toMatchObject({ held_until: null });
  });

  it("rule 13: a payment method the store did not choose never books by itself, and the team is told", async () => {
    await save(settings((s) => { s.confirmed.autoBook.enabled = true; s.confirmed.autoBook.paymentModes = ["cod"]; })).expect(200);
    const id = await newOrder({ paymentMode: "partial", paymentStatus: "partially_paid", received: { amount: "250.00", currency: "EGP" }, outstanding: { amount: "1000.00", currency: "EGP" } });
    await confirm(id);
    await runAt(new Date(Date.now() + MIN));
    expect(await shipments(id)).toEqual([]);
    expect(await followups(id)).toEqual([expect.objectContaining({ status: "blocked", result: "payment_mode_not_allowed" })]);
    expect((await timeline(id)).map((e) => e.type)).toContain("auto_book_blocked");
    const notes = await db.tenant(store, (trx) => trx.selectFrom("notifications").select("text").where("entity_id", "=", id).execute());
    expect(notes.map((x) => x.text)).toEqual([expect.stringMatching(/^blocked\|#\d+\|payment_mode_not_allowed$/)]); // told in each reader's language by the bell
    expect(JSON.stringify(notes)).not.toMatch(/Mona|1001234821|Abbas/);
  });

  it("only the ways of confirming the store chose book by themselves; Book by hand turns it off for one order; Release now ends the window", async () => {
    await save(settings((s) => { s.confirmed.autoBook.enabled = true; s.confirmed.autoBook.channels = ["whatsapp"]; })).expect(200);
    const byAgent = await newOrder();
    await confirm(byAgent); // channel "agent": not chosen
    expect(await followups(byAgent)).toEqual([]);

    await save(settings((s) => { s.confirmed.graceMinutes = 60; s.confirmed.autoBook.enabled = true; })).expect(200);
    const kept = await newOrder();
    await confirm(kept);
    await http().post(`/v1/orders/${kept}/after-confirmation/skip`).set(as("owner")).expect(200);
    await http().post(`/v1/orders/${kept}/after-confirmation/release`).set(as("owner")).expect(200);
    expect(await orderRow(kept)).toMatchObject({ held_until: null, hold_reason: null });
    await runAt(new Date(Date.now() + MIN));
    expect(await shipments(kept)).toEqual([]);
    expect(await followups(kept)).toEqual([expect.objectContaining({ status: "done", result: "released", auto_book: false })]);
    await http().post(`/v1/orders/${kept}/after-confirmation/release`).set(as("agent")).expect(403);
  });
});

describe("handing over to shipping", () => {
  it("Book by hand pressed after the order was handed to shipping still stops the booking", async () => {
    await save(settings((s) => { s.confirmed.autoBook.enabled = true; })).expect(200);
    const id = await newOrder();
    await confirm(id);
    await app.get(ConfirmationRunner).runOnce(new Date(Date.now() + MIN)); // released: order.ready_to_ship waits for the dispatcher
    expect(await followups(id)).toEqual([expect.objectContaining({ status: "done", result: "ready" })]);
    await http().post(`/v1/orders/${id}/after-confirmation/skip`).set(as("owner")).expect(200);
    await drain();
    expect(await shipments(id)).toEqual([]);
  });

  it("a setting turned off after the hand-over wins too", async () => {
    await save(settings((s) => { s.confirmed.autoBook.enabled = true; })).expect(200);
    const id = await newOrder();
    await confirm(id);
    await app.get(ConfirmationRunner).runOnce(new Date(Date.now() + MIN));
    await save(DEFAULT_AFTER).expect(200);
    await drain();
    expect(await shipments(id)).toEqual([]);
  });
});

describe("no answer", () => {
  it("after the team's last unanswered call, cancelled when the store's hours pass, as Mizan (not the customer), and cancelled in the store too", async () => {
    await save(settings((s) => { s.noAnswer.autoCancel = { enabled: true, after: "team_calls", afterHours: 1, cancelIfAssigned: false }; s.noAnswer.tags = ["no-answer"]; })).expect(200);
    const id = await newOrder();
    await runAt(new Date()); // the WhatsApp message goes out…
    await runAt(new Date(Date.now() + 121 * MIN)); // …nobody answers it: the order goes to the team's calls
    for (let i = 0; i < DEFAULT_CONFIRMATION.teamCalls.attempts; i++) await http().post(`/v1/orders/${id}/confirmation/no-answer`).set(as("owner")).expect(200);
    await drain();
    expect(await eventTypes(id)).toContain("confirmation.no_answer");
    expect((await orderRow(id)).tags).toContain("no-answer");
    expect(await followups(id)).toEqual([expect.objectContaining({ kind: "no_answer_cancel", status: "pending" })]);

    await runAt(new Date(Date.now() + 30 * MIN));
    expect((await orderRow(id)).status).not.toBe("cancelled");
    await runAt(new Date(Date.now() + 61 * MIN));
    expect((await orderRow(id)).status).toBe("cancelled");
    const cancelled = (await timeline(id)).find((e) => e.type === "cancelled")!;
    expect(cancelled.actor_type).toBe("system");
    expect(cancelled.data).toMatchObject({ reason: "no_answer" });
    expect(await eventTypes(id)).toEqual(expect.arrayContaining(["order.cancelled", "order.confirmation_failed"]));
    expect((await eventTypes(id)).filter((t) => t === "confirmation.no_answer" )).toHaveLength(2); // once for the messages, once for the team's last call
  });

  it("the team's own calls assigned the order to the caller: still cancelled after the last unanswered call", async () => {
    await save(cancelAfterAnHour).expect(200);
    const id = await unanswered();
    // A further call after the last one: no second no-answer, no second notice.
    await http().post(`/v1/orders/${id}/confirmation/no-answer`).set(as("owner")).expect(200);
    await drain();
    expect((await eventTypes(id)).filter((t) => t === "confirmation.no_answer")).toHaveLength(2);
    const owner = await db.tenant(store, (trx) => trx.selectFrom("memberships").select("user_id").where("role", "=", "owner").executeTakeFirstOrThrow());
    await db.tenant(store, (trx) => trx.updateTable("orders").set({ assigned_to: owner.user_id }).where("id", "=", id).execute());
    await runAt(new Date(Date.now() + 61 * MIN));
    expect((await orderRow(id)).status).toBe("cancelled");
  });

  const unanswered = async () => {
    const id = await newOrder();
    await runAt(new Date());
    await runAt(new Date(Date.now() + 121 * MIN));
    for (let i = 0; i < DEFAULT_CONFIRMATION.teamCalls.attempts; i++) await http().post(`/v1/orders/${id}/confirmation/no-answer`).set(as("owner")).expect(200);
    await drain();
    return id;
  };
  const cancelAfterAnHour = settings((s) => { s.noAnswer.autoCancel = { enabled: true, after: "team_calls", afterHours: 1, cancelIfAssigned: false }; });

  it("never cancels an order a team member has taken (after the messages: nobody called yet)", async () => {
    await save(settings((s) => { s.noAnswer.autoCancel = { enabled: true, after: "messages", afterHours: 1, cancelIfAssigned: false }; })).expect(200);
    const id = await newOrder();
    await runAt(new Date());
    await runAt(new Date(Date.now() + 121 * MIN)); // the message went unanswered: cancel scheduled for an hour later
    const owner = await db.tenant(store, (trx) => trx.selectFrom("memberships").select("user_id").where("role", "=", "owner").executeTakeFirstOrThrow());
    await db.tenant(store, (trx) => trx.updateTable("orders").set({ assigned_to: owner.user_id }).where("id", "=", id).execute());
    await runAt(new Date(Date.now() + 61 * MIN));
    expect((await orderRow(id)).status).not.toBe("cancelled");
    expect(await followups(id)).toEqual([expect.objectContaining({ status: "skipped", result: "assigned" })]);
  });

  it("a message Meta reported failed never counts as 'the messages went unanswered': nothing is cancelled", async () => {
    await save(settings((s) => { s.noAnswer.autoCancel = { enabled: true, after: "messages", afterHours: 1, cancelIfAssigned: false }; })).expect(200);
    const id = await newOrder();
    await runAt(new Date());
    await db.tenant(store, (trx) => trx.updateTable("whatsapp_messages").set({ status: "failed" }).where("order_id", "=", id).execute());
    await runAt(new Date(Date.now() + 121 * MIN));
    expect(await eventTypes(id)).not.toContain("confirmation.no_answer");
    expect(await followups(id)).toEqual([]);
  });

  it("a setting turned off before the time comes wins over the cancel already waiting", async () => {
    await save(cancelAfterAnHour).expect(200);
    const id = await unanswered();
    await save(DEFAULT_AFTER).expect(200);
    await runAt(new Date(Date.now() + 61 * MIN));
    expect((await orderRow(id)).status).not.toBe("cancelled");
    expect(await followups(id)).toEqual([expect.objectContaining({ status: "skipped", result: "setting_off" })]);
  });
});

describe("the settings", () => {
  it("defaults for a new store, a round trip, audited; refused for an agent; checked; untouched by the confirmation settings", async () => {
    const view = (await http().get("/v1/settings/after-confirmation").set(as("owner")).expect(200)).body;
    expect(view.settings).toEqual(DEFAULT_AFTER);
    expect(view.couriers).toEqual([expect.objectContaining({ id: courierId, provider: "bosta" })]);
    expect(view.recommended.confirmed).toMatchObject({ graceMinutes: 30, autoBook: expect.objectContaining({ enabled: true }) });
    const next = settings((s) => { s.cancelled.tags = ["refused"]; s.confirmed.autoBook.courierConnectionId = courierId; });
    expect((await save(next).expect(200)).body.settings).toEqual(next);
    await http().get("/v1/settings/after-confirmation").set(as("agent")).expect(403);
    expect((await save(settings((s) => { s.confirmed.tags = ["x"]; s.cancelled.tags = ["x"]; })).expect(422)).body.errors[0]).toMatchObject({ code: "tags_overlap" });
    expect((await save(settings((s) => { s.confirmed.autoBook.courierConnectionId = "00000000-0000-4000-8000-000000000000"; })).expect(422)).body.errors[0]).toMatchObject({ code: "courier_not_found" });
    await http().put("/v1/settings/confirmation").set(as("owner")).send({ ...DEFAULT_CONFIRMATION, callingHours: { start: "00:00", end: "23:59" } }).expect(200);
    expect((await http().get("/v1/settings/after-confirmation").set(as("owner")).expect(200)).body.settings).toEqual(next);
    const audit = await http().get("/v1/audit-log?action=confirmation.after_settings_updated").set(as("owner")).expect(200);
    expect(audit.body.data.map((e: { action: string }) => e.action)).toContain("confirmation.after_settings_updated");
  });
});
