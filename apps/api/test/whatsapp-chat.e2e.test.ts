import "reflect-metadata";
import { createHmac } from "node:crypto";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import type { CanonicalOrder } from "@mizan/shared";
import { ClaudeOfferWriter, DriftMonitor } from "@mizan/engine";
import { FakeClaude, FakeClock, FakeWhatsApp, seeded, testRuntime } from "@mizan/engine/testing";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { EventDispatcher } from "../src/platform/events/dispatcher.js";
import { SecretsService } from "../src/platform/secrets/secrets.service.js";
import { OrderProjector } from "../src/modules/orders/order-projector.js";
import { actionId, parseActionId } from "../src/modules/confirmation/confirmation-link.js";
import { ConfirmationRunner } from "../src/modules/confirmation/confirmation.runner.js";
import { DEFAULT_CONFIRMATION } from "../src/modules/confirmation/confirmation.settings.js";
import { MessagingRegistry } from "../src/modules/confirmation/messaging.registry.js";
import { OfferAi } from "../src/modules/confirmation/offers/offer-ai.service.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E6-10: confirmation inside the WhatsApp chat, end to end through the real WhatsApp Cloud
 * connector and a fake Meta: connect the number, the template with signed buttons, the customer's
 * taps coming back by signed webhook, follow-up replies, statuses, and Meta's misbehaviour.
 */
const clock = new FakeClock();
const wa = new FakeWhatsApp(clock, seeded(31));
const fake = new FakeVerifier();
const APP_SECRET = wa.appSecret.padEnd(16, "x");
const VERIFY = "verify-token-for-tests-123";
let app: INestApplication;
let db: Database;
let store: string;
let shop: string;
let n = 0;
const MIN = 60_000;
const CUSTOMER = "201001234821";
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
let now = Date.now();
/** The runner at wall-clock time, plus however far a test moved it on. */
const run = async (advanceMin = 0) => { now = Math.max(now, Date.now()) + advanceMin * MIN; return app.get(ConfirmationRunner).runOnce(new Date(now)); };
/** Meta delivers its pending webhooks to Mizan (signed with the app secret). */
const deliver = async () => {
  for (const w of wa.takeWebhooks()) {
    await http().post("/webhooks/whatsapp").set({ "content-type": "application/json", "x-hub-signature-256": w.signature }).send(w.body).expect(200);
  }
};
const resign = (body: string) => `sha256=${createHmac("sha256", APP_SECRET).update(body).digest("hex")}`;

function order(over: Partial<CanonicalOrder> = {}): CanonicalOrder {
  n++;
  const at = new Date(Date.now() - 30 * MIN).toISOString();
  return {
    connector: "shopify", externalId: `gid://shopify/Order/${9100 + n}`, number: `#${9100 + n}`, createdAt: at, updatedAt: at, currency: "EGP",
    total: { amount: "1250.00", currency: "EGP" }, subtotal: { amount: "1200.00", currency: "EGP" }, shipping: { amount: "50.00", currency: "EGP" },
    paymentMode: "cod", paymentStatus: "unpaid", gateways: ["Cash on Delivery (COD)"],
    received: { amount: "0.00", currency: "EGP" }, outstanding: { amount: "1250.00", currency: "EGP" }, refunded: { amount: "0.00", currency: "EGP" },
    cancelled: false, customer: { name: "Mona Adel", phone: `+${CUSTOMER}` },
    shippingAddress: { name: "Mona Adel", phone: `+${CUSTOMER}`, line1: "12 Abbas El Akkad St", city: "Nasr City", countryCode: "EG" },
    lines: [{ externalLineId: `L${n}`, sku: "AB-1", title: "Abaya", quantity: 2, unitPrice: { amount: "600.00", currency: "EGP" } }],
    fulfillmentGroups: [], tags: [], ...over,
  };
}
async function newOrder(over: Partial<CanonicalOrder> = {}): Promise<string> {
  const o = order(over);
  await app.get(OrderProjector).project(store, shop, o);
  await drain();
  return (await db.tenant(store, (trx) => trx.selectFrom("orders").select("id").where("number", "=", o.number).executeTakeFirstOrThrow())).id;
}
const orderRow = (id: string) => db.tenant(store, (trx) => trx.selectFrom("orders").select(["status", "ship_lat"]).where("id", "=", id).executeTakeFirstOrThrow());
const runOf = (orderId: string) => db.tenant(store, (trx) => trx.selectFrom("confirmation_runs").selectAll().where("order_id", "=", orderId).orderBy("started_at", "desc").executeTakeFirstOrThrow());
/** The confirmation template the customer received for an order, and its buttons. */
async function templateFor(orderId: string) {
  const r = await runOf(orderId);
  const m = wa.accepted.filter((x) => x.type === "template").find((x) => {
    const payload = x.body.template.components.find((c: { type: string }) => c.type === "button")?.parameters[0].payload;
    return parseActionId(undefined, payload)?.runId === r.id;
  })!;
  const buttons = m.body.template.components.filter((c: { type: string }) => c.type === "button").map((c: { parameters: Array<{ payload: string }> }) => c.parameters[0]!.payload) as string[];
  return { message: m, confirm: buttons[0]!, change: buttons[1]!, cancel: buttons[2]! };
}
const sentAfter = (i: number) => wa.accepted.slice(i);

beforeAll(async () => {
  const config = loadConfig({
    NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test",
    META_APP_SECRET: APP_SECRET, WHATSAPP_VERIFY_TOKEN: VERIFY, WHATSAPP_GRAPH_URL: wa.baseUrl, WHATSAPP_GRAPH_VERSION: wa.version,
  });
  wa.appSecret = APP_SECRET; // webhooks signed with the configured secret
  app = await createApp(config, {
    logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake,
    engineRuntime: () => testRuntime(clock, { [wa.host]: wa.handler }, seeded(32)),
  });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null); // no voice vendor
  fake.add("owner", { uid: "fb-owner-wa", email: "owner@wa.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Abayas", country: "EG" }).expect(201)).body.id;
  shop = await db.tenant(store, async (trx) => {
    const ref = await app.get(SecretsService).create(trx, store, JSON.stringify({ accessToken: "shpat_fake_token" }), { actor: { type: "system" } });
    return (await trx.insertInto("connections").values({ tenant_id: store, kind: "store", provider: "shopify", external_account: "nile-wa.myshopify.com", secret_ref: ref }).returning("id").executeTakeFirstOrThrow()).id;
  });
  await http().put("/v1/settings/confirmation").set(as("owner")).send({ ...DEFAULT_CONFIRMATION, callingHours: { start: "00:00", end: "23:59" } }).expect(200);
  await http().put("/v1/settings/orders").set(as("owner")).send({ duplicateWindowHours: 0 }).expect(200); // the same test customer orders again and again (E5-3 has its own test)
});
beforeEach(async () => {
  await db.tenant(store, async (trx) => {
    await trx.updateTable("confirmation_steps").set({ status: "cancelled" }).where("status", "in", ["pending", "running"]).execute();
    await trx.updateTable("confirmation_runs").set({ status: "stopped" }).where("status", "in", ["running", "needs_agent"]).execute();
  });
  wa.faults = [];
  wa.undeliverable.clear();
  wa.takeWebhooks();
});
afterAll(() => app.close());

describe("connecting the store's WhatsApp number", () => {
  it("a refused token and a missing template need attention; with the template approved it goes active", async () => {
    const connect = (accessToken: string) => http().post("/v1/connections/whatsapp").set(as("owner")).send({ phoneNumberId: wa.phoneNumberId, wabaId: wa.wabaId, accessToken }).expect(200);
    const status = async () => (await http().get("/v1/connections").set(as("owner")).expect(200)).body.data.find((c: { kind: string }) => c.kind === "whatsapp");
    expect((await connect("EAAG-wrong-token-xxxxxxxx")).body).toMatchObject({ kind: "whatsapp", provider: "whatsapp_cloud", status: "pending" });
    await run();
    expect(await status()).toMatchObject({ status: "needs_attention", reason: "token_refused" });

    const saved = wa.templates;
    wa.templates = saved.filter((t) => t.name !== "mizan_order_confirm_ar");
    await connect(wa.token);
    await run();
    expect(await status()).toMatchObject({ status: "needs_attention", reason: "template_missing" });

    wa.templates = saved;
    await http().post("/v1/connections/whatsapp/check").set(as("owner")).expect(200);
    await run();
    expect(await status()).toMatchObject({ status: "active", reason: null });
    expect((await http().get("/v1/settings/confirmation").set(as("owner")).expect(200)).body.channels).toEqual({ whatsapp: true, call_auto: false, call_team: true });
    // The token is stored encrypted, never in the connection row.
    const row = await db.tenant(store, (trx) => trx.selectFrom("connections").select(["config", "secret_ref"]).where("kind", "=", "whatsapp").executeTakeFirstOrThrow());
    expect(JSON.stringify(row.config)).not.toContain(wa.token);
    await http().post("/v1/connections/whatsapp").set(as("owner")).send({ phoneNumberId: "12", wabaId: wa.wabaId, accessToken: wa.token }).expect(422);
  });
});

describe("the conversation", () => {
  it("one tap confirms: the order is confirmed and the customer gets a thank-you; a redelivery or a second tap changes nothing", async () => {
    const id = await newOrder();
    await run();
    const t = await templateFor(id);
    expect(t.message.to).toBe(CUSTOMER);
    expect(t.message.body.template).toMatchObject({ name: "mizan_order_confirm_ar", language: { code: "ar" } });
    expect(t.message.body.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual(["أهلاً Mona", "Nile Abayas", `#${9100 + n}`, "1,250 ج.م. عند الاستلام"]);
    expect(JSON.stringify(t.message.body)).not.toMatch(/https?:\/\//); // no link to open

    const before = wa.accepted.length;
    wa.tapQuickReply(CUSTOMER, t.confirm, t.message.id);
    const hooks = wa.takeWebhooks();
    for (const h of [...hooks, ...hooks]) await http().post("/webhooks/whatsapp").set({ "content-type": "application/json", "x-hub-signature-256": h.signature }).send(h.body).expect(200); // delivered twice
    expect((await orderRow(id)).status).toBe("confirmed");
    expect(await runOf(id)).toMatchObject({ status: "confirmed", answered_channel: "whatsapp" });
    await run();
    expect(sentAfter(before).map((m) => [m.type, m.body.text?.body])).toEqual([["text", `تمام ✅ أوردرك #${9100 + n} اتأكّد وهنشحنه قريب. شكراً إنك اخترت Nile Abayas!`]]);

    wa.tapQuickReply(CUSTOMER, t.confirm, t.message.id); // taps again
    await deliver();
    await run();
    expect(sentAfter(before)).toHaveLength(1);
    const summary = (await http().get(`/v1/orders/${id}/confirmation`).set(as("owner")).expect(200)).body;
    expect(summary.whatsapp.map((m: { direction: string; action: string }) => `${m.direction}:${m.action}`)).toEqual(["out:ask", "in:confirm", "out:confirmed", "in:late"]);
    expect(JSON.stringify(summary.whatsapp)).not.toMatch(/Mona|1001234821/);
  });

  it("change: the team gets the request, and what the customer types next is kept, encrypted, as the note", async () => {
    const id = await newOrder();
    await run();
    const t = await templateFor(id);
    const before = wa.accepted.length;
    wa.tapQuickReply(CUSTOMER, t.change, t.message.id);
    await deliver();
    expect(await runOf(id)).toMatchObject({ status: "needs_agent", outcome: "changed", chat_state: "awaiting_change" });
    await run();
    expect(sentAfter(before)[0]!.body.text.body).toMatch(/^اكتب لنا التعديل/);
    wa.writes(CUSTOMER, "المقاس L والتوصيل بعد 5");
    await deliver();
    await run();
    expect(sentAfter(before)[1]!.body.text.body).toBe("وصلنا ✍️ فريق Nile Abayas هيكلّمك قريب.");
    expect((await runOf(id)).chat_state).toBeNull();
    const note = await db.tenant(store, (trx) => trx.selectFrom("confirmations").select("notes").where("order_id", "=", id).where("outcome", "=", "changed").executeTakeFirstOrThrow());
    expect(note.notes).toMatch(/^pii:v1:/);
    expect((await orderRow(id)).status).toBe("pending_confirmation");
    const calls = (await http().get("/v1/orders?confirmation=needs_call").set(as("owner")).expect(200)).body;
    expect(calls.data.map((o: { id: string }) => o.id)).toContain(id);
  });

  it("cancel asks why in a list; a reason cancels, 'keep my order' confirms instead", async () => {
    const a = await newOrder();
    await run();
    const ta = await templateFor(a);
    let before = wa.accepted.length;
    wa.tapQuickReply(CUSTOMER, ta.cancel, ta.message.id);
    await deliver();
    expect((await orderRow(a)).status).toBe("pending_confirmation"); // not cancelled on the first tap
    await run();
    const list = sentAfter(before)[0]!;
    expect(list.body.interactive.type).toBe("list");
    const rows = list.body.interactive.action.sections[0].rows as Array<{ id: string; title: string }>;
    expect(rows.map((r) => r.title)).toEqual(["غيّرت رأيي", "طلبته بالغلط", "لقيته أرخص", "التوصيل هيتأخر عليّا", "سبب تاني", "لا، كمّل الأوردر"]);
    wa.tapReply(CUSTOMER, rows[1]!.id, "list_reply");
    await deliver();
    expect((await orderRow(a)).status).toBe("cancelled");
    expect(await runOf(a)).toMatchObject({ status: "cancelled", reason: "ordered_by_mistake", answered_channel: "whatsapp" });
    await run();
    expect(sentAfter(before)[1]!.body.text.body).toMatch(/^اتلغى أوردرك/);

    const b = await newOrder();
    await run();
    const tb = await templateFor(b);
    before = wa.accepted.length;
    wa.tapQuickReply(CUSTOMER, tb.cancel, tb.message.id);
    await deliver();
    await run();
    const keep = (sentAfter(before)[0]!.body.interactive.action.sections[0].rows as Array<{ id: string }>).at(-1)!.id;
    wa.tapReply(CUSTOMER, keep, "list_reply");
    await deliver();
    expect((await orderRow(b)).status).toBe("confirmed");
  });

  it("anything typed goes to the team; a shared location is kept for the courier", async () => {
    const id = await newOrder();
    await run();
    const before = wa.accepted.length;
    wa.writes(CUSTOMER, "ممكن أغيّر العنوان؟");
    await deliver();
    expect(await runOf(id)).toMatchObject({ status: "needs_agent", reason: "customer_message" });
    await run();
    expect(sentAfter(before)[0]!.body.text.body).toBe("وصلنا ✍️ فريق Nile Abayas هيكلّمك قريب.");
    wa.sharesLocation(CUSTOMER, 30.0561, 31.3301);
    await deliver();
    expect((await orderRow(id)).ship_lat).toBe(30.0561);
  });
});

describe("Meta misbehaving, and forgeries", () => {
  it("a number not on WhatsApp fails by webhook: the order goes to the team now, not in 2 hours", async () => {
    wa.undeliverable.add(CUSTOMER);
    const id = await newOrder();
    await run();
    expect(await runOf(id)).toMatchObject({ status: "running", step: 0 });
    await deliver(); // failed, 131026
    expect(await runOf(id)).toMatchObject({ status: "needs_agent", reason: "team_call" });
    const summary = (await http().get(`/v1/orders/${id}/confirmation`).set(as("owner")).expect(200)).body;
    expect(summary.whatsapp[0]).toMatchObject({ direction: "out", status: "failed", errorCode: 131026 });
  });

  it("a send whose response is lost is not re-sent: its status webhook proves it went out", async () => {
    wa.faults.push({ fault: "lost" });
    const id = await newOrder();
    const sends = () => wa.accepted.filter((m) => m.type === "template" && m.to === CUSTOMER).length;
    const start = sends();
    await run(); // times out: outcome unknown
    expect(sends()).toBe(start + 1);
    const step = await db.tenant(store, (trx) => trx.selectFrom("confirmation_steps as s").innerJoin("confirmation_runs as r", "r.id", "s.run_id").select(["s.status", "s.last_error"]).where("r.order_id", "=", id).where("s.kind", "=", "send").executeTakeFirstOrThrow());
    expect(step).toMatchObject({ status: "pending", last_error: "unknown_outcome" });
    await deliver(); // Meta's "sent" status with our key
    await run(11);
    expect(sends()).toBe(start + 1); // not sent twice
    expect(await runOf(id)).toMatchObject({ status: "running", step: 0 });
    const timeout = await db.tenant(store, (trx) => trx.selectFrom("confirmation_steps as s").innerJoin("confirmation_runs as r", "r.id", "s.run_id").select("s.status").where("r.order_id", "=", id).where("s.kind", "=", "timeout").executeTakeFirst());
    expect(timeout?.status).toBe("pending"); // now waiting for the customer
  });

  it("a hang before Meta got it: no status comes, so after 10 minutes it is sent again, once", async () => {
    wa.faults.push({ fault: "timeout" });
    const id = await newOrder();
    const sends = () => wa.accepted.filter((m) => m.type === "template" && m.to === CUSTOMER).length;
    const start = sends();
    await run();
    expect(sends()).toBe(start);
    await deliver();
    await run(5); // still within the verification window
    expect(sends()).toBe(start);
    await run(6);
    expect(sends()).toBe(start + 1);
    expect(await runOf(id)).toMatchObject({ status: "running" });
  });

  it("refuses bad signatures, forged buttons and wrong verify tokens; ignores numbers it does not know", async () => {
    const id = await newOrder();
    await run();
    const t = await templateFor(id);
    wa.tapQuickReply(CUSTOMER, t.confirm, t.message.id);
    const [hook] = wa.takeWebhooks();
    await http().post("/webhooks/whatsapp").set({ "content-type": "application/json", "x-hub-signature-256": "sha256=00" }).send(hook!.body).expect(401);
    await http().post("/webhooks/whatsapp").set({ "content-type": "application/json" }).send(hook!.body).expect(401);
    expect((await orderRow(id)).status).toBe("pending_confirmation");

    // A button id for this run, signed with another key (or edited), does nothing.
    const forged = actionId(Buffer.alloc(32, 9).toString("base64"), (await runOf(id)).id, "confirm");
    const edited = t.change.replace(".change.", ".confirm.");
    for (const bad of [forged, edited]) {
      wa.tapQuickReply(CUSTOMER, bad);
      await deliver();
    }
    expect((await orderRow(id)).status).toBe("pending_confirmation");

    const other = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "x", changes: [{ field: "messages", value: { metadata: { phone_number_id: "555000555" }, messages: [{ id: "wamid.X", from: CUSTOMER, timestamp: "1", type: "text", text: { body: "hi" } }] } }] }] });
    expect((await http().post("/webhooks/whatsapp").set({ "content-type": "application/json", "x-hub-signature-256": resign(other) }).send(other).expect(200)).body).toEqual({ received: 0 });

    const ok = await http().get("/webhooks/whatsapp").query({ "hub.mode": "subscribe", "hub.verify_token": VERIFY, "hub.challenge": "1158201444" }).expect(200);
    expect(ok.text).toBe("1158201444");
    await http().get("/webhooks/whatsapp").query({ "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "1" }).expect(403);
  });
});

describe("offers in the chat (E6-11)", () => {
  const V = { abaya: "gid://shopify/ProductVariant/501", scarf: "gid://shopify/ProductVariant/502", pin: "gid://shopify/ProductVariant/503" };
  let ids: Record<keyof typeof V, string>;
  const abayaLine = (k = "A") => ({ externalLineId: `OL-${k}-${n}`, sku: "AB-OF", variantExternalId: V.abaya, title: "Abaya", quantity: 2, unitPrice: { amount: "600.00", currency: "EGP" } });
  const offerOf = (orderId: string) => db.tenant(store, (trx) => trx.selectFrom("order_offers").selectAll().where("order_id", "=", orderId).executeTakeFirst());
  const settings = (over: Record<string, unknown> = {}) => http().put("/v1/settings/offers").set(as("owner"))
    .send({ enabled: true, mode: "rules_then_auto", maxDiscountPct: "15", autoDiscountPct: "10", inWhatsApp: true, inCalls: true, ai: false, ...over }).expect(200);

  beforeAll(async () => {
    ids = await db.tenant(store, async (trx) => {
      const out = {} as Record<keyof typeof V, string>;
      for (const [k, title, price] of [["abaya", "Abaya", 60000], ["scarf", "Matching scarf", 15000], ["pin", "Pin", 5000]] as const) {
        const p = (await trx.insertInto("products").values({ tenant_id: store, title, status: "active" }).returning("id").executeTakeFirstOrThrow()).id;
        const v = (await trx.insertInto("variants").values({ tenant_id: store, product_id: p, sku: `OF-${k}`, currency: "EGP", price_minor: price, available: 5 }).returning("id").executeTakeFirstOrThrow()).id;
        await trx.insertInto("external_variants").values({ tenant_id: store, connection_id: shop, external_id: V[k], variant_id: v }).execute();
        out[k] = v;
      }
      return out;
    });
  });

  it("is off until the owner turns it on; settings and rules are for owner, admin and ops", async () => {
    expect((await http().get("/v1/settings/offers").set(as("owner")).expect(200)).body).toMatchObject({ enabled: false, mode: "rules_then_auto", maxDiscountPct: "15" });
    const id = await newOrder({ lines: [abayaLine()] });
    expect(await offerOf(id)).toBeUndefined();
    await http().put("/v1/settings/offers").set(as("owner")).send({ enabled: true, mode: "auto", maxDiscountPct: "10", autoDiscountPct: "20", inWhatsApp: true, inCalls: true, ai: false }).expect(422);
    await http().post("/v1/offer-rules").set(as("owner")).send({ triggerVariantId: ids.abaya, offerVariantId: ids.abaya }).expect(422);
    const products = (await http().get("/v1/offer-products?q=Matching").set(as("owner")).expect(200)).body.data;
    expect(products).toEqual([expect.objectContaining({ variantId: ids.scarf, title: "Matching scarf", price: { amount: "150.00", currency: "EGP" }, available: 5 })]);
  });

  it("confirm → the thank-you carries the owner's offer with Add / No thanks; Add records it and gives the new total", async () => {
    await settings();
    const rule = (await http().post("/v1/offer-rules").set(as("owner")).send({ triggerVariantId: ids.abaya, offerVariantId: ids.scarf, discountPct: "10" }).expect(201)).body.id;
    expect((await http().get("/v1/offer-rules").set(as("owner")).expect(200)).body.data[0]).toMatchObject({ id: rule, trigger: { title: "Abaya" }, offer: { title: "Matching scarf" }, discountPct: "10", active: true });
    const id = await newOrder({ lines: [abayaLine()] });
    expect(await offerOf(id)).toMatchObject({ status: "proposed", source: "rule", unit_price_minor: 15000n, offer_price_minor: 13500n, discount_pct: "10.00" });
    await run();
    const t = await templateFor(id);
    const before = wa.accepted.length;
    wa.tapQuickReply(CUSTOMER, t.confirm, t.message.id);
    await deliver();
    await run();
    const msg = sentAfter(before)[0]!;
    expect(msg.body.interactive.type).toBe("button");
    expect(msg.body.interactive.body.text).toBe(`تمام ✅ أوردرك #${9100 + n} اتأكّد.\n\n🎁 عرض ليك: Matching scarf بـ 135 ج.م. بدل 150 ج.م.\nتحب نضيفه لنفس الأوردر؟`);
    const [add, no] = msg.body.interactive.action.buttons as Array<{ reply: { id: string; title: string } }>;
    expect([add!.reply.title, no!.reply.title]).toEqual(["ضيفه", "لا شكراً"]);

    wa.tapReply(CUSTOMER, add!.reply.id);
    await deliver();
    expect(await offerOf(id)).toMatchObject({ status: "accepted", channel: "whatsapp" });
    await run();
    expect(sentAfter(before)[1]!.body.text.body).toBe("تمام ✅ هنضيف Matching scarf لأوردرك، والإجمالي الجديد 1,385 ج.م.");
    wa.tapReply(CUSTOMER, no!.reply.id); // changes nothing now
    await deliver();
    await run();
    expect(sentAfter(before)).toHaveLength(2);
    expect(await offerOf(id)).toMatchObject({ status: "accepted" });
    const events = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select(["type", "data"]).where("entity_id", "=", id).where("type", "like", "offer.%").orderBy("occurred_at").execute());
    expect(events.map((e) => e.type)).toEqual(["offer.proposed", "offer.accepted"]);
    expect(JSON.stringify(events)).not.toMatch(/Mona|1001234821/);
    await http().patch(`/v1/offer-rules/${rule}`).set(as("owner")).send({ active: false }).expect(204);
  });

  it("no thanks, and without rules: what customers buy with abayas", async () => {
    await settings({ mode: "auto" });
    // History: abayas are bought with pins.
    for (let i = 0; i < 3; i++) await newOrder({ createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), lines: [abayaLine(`H${i}`), { externalLineId: `PL-${i}-${n}`, sku: "PIN", variantExternalId: V.pin, title: "Pin", quantity: 1, unitPrice: { amount: "50.00", currency: "EGP" } }] });
    const id = await newOrder({ lines: [abayaLine()] });
    expect(await offerOf(id)).toMatchObject({ status: "proposed", source: "auto", variant_id: ids.pin, offer_price_minor: 4500n });
    await run();
    const t = await templateFor(id);
    const before = wa.accepted.length;
    wa.tapQuickReply(CUSTOMER, t.confirm, t.message.id);
    await deliver();
    await run();
    const no = (sentAfter(before)[0]!.body.interactive.action.buttons as Array<{ reply: { id: string } }>)[1]!.reply.id;
    wa.tapReply(CUSTOMER, no);
    await deliver();
    await run();
    expect(await offerOf(id)).toMatchObject({ status: "declined" });
    expect(sentAfter(before)[1]!.body.text.body).toBe("ولا يهمك 🙏 أوردرك ماشي زي ما هو.");
  });

  it("on the team's call: the offer is in the script and the team records the answer; results add up", async () => {
    await settings();
    await http().post("/v1/offer-rules").set(as("owner")).send({ triggerVariantId: null, offerVariantId: ids.scarf, discountPct: "0", messageAr: "طرحة على نفس اللون بـ 150 ج.م." }).expect(201);
    wa.undeliverable.add(CUSTOMER); // straight to the team
    const id = await newOrder({ lines: [abayaLine()] });
    await run();
    await deliver();
    const s = (await http().get(`/v1/orders/${id}/confirmation`).set(as("owner")).expect(200)).body;
    expect(s.offer).toMatchObject({ title: "Matching scarf", status: "proposed", offerPrice: { amount: "150.00" }, source: "rule" });
    expect(s.script.at(-1)).toBe("🎁 وبعد ما يأكّد اعرض عليه: Matching scarf بـ 150 ج.م. تحب نضيفه لنفس الأوردر؟");
    expect((await http().post(`/v1/orders/${id}/offer`).set(as("owner")).send({ decision: "accept" }).expect(200)).body).toEqual({ status: "accepted" });
    expect((await http().post(`/v1/orders/${id}/offer`).set(as("owner")).send({ decision: "decline" }).expect(200)).body).toEqual({ status: "accepted" }); // already answered
    const sum = (await http().get("/v1/offers/summary?days=7").set(as("owner")).expect(200)).body;
    expect(sum.accepted).toBeGreaterThanOrEqual(2);
    expect(sum.declined).toBeGreaterThanOrEqual(1);
    expect(sum.added[0]).toMatchObject({ currency: "EGP" });
    await settings({ enabled: false });
  });
});

describe("Claude picks and words the offer (E6-12)", () => {
  const claude = new FakeClaude(clock, seeded(41));
  const V = { abaya: "gid://shopify/ProductVariant/601", scarf: "gid://shopify/ProductVariant/602", pin: "gid://shopify/ProductVariant/603" };
  let ids: Record<keyof typeof V, string>;
  const line = (k: keyof typeof V, tag: string, price: string) => ({ externalLineId: `AI-${k}-${tag}-${n}`, sku: `AI-${k}`, variantExternalId: V[k], title: k, quantity: 1, unitPrice: { amount: price, currency: "EGP" } });
  const offerOf = (orderId: string) => db.tenant(store, (trx) => trx.selectFrom("order_offers").selectAll().where("order_id", "=", orderId).executeTakeFirstOrThrow());
  const aiStep = (orderId: string) => db.tenant(store, (trx) => trx.selectFrom("confirmation_steps as s").innerJoin("confirmation_runs as r", "r.id", "s.run_id")
    .select(["s.status", "s.last_error"]).where("r.order_id", "=", orderId).where("s.kind", "=", "ai_offer").executeTakeFirst());
  const settings = (over: Record<string, unknown> = {}) => http().put("/v1/settings/offers").set(as("owner"))
    .send({ enabled: true, mode: "auto", maxDiscountPct: "15", autoDiscountPct: "10", inWhatsApp: true, inCalls: true, ai: true, ...over }).expect(200);

  beforeAll(async () => {
    app.get(OfferAi).use(new ClaudeOfferWriter({ apiKey: claude.apiKey, baseUrl: claude.baseUrl }, testRuntime(clock, { [claude.host]: claude.handler }, seeded(42)), new DriftMonitor()));
    ids = await db.tenant(store, async (trx) => {
      const out = {} as Record<keyof typeof V, string>;
      for (const [k, title, price, cost] of [["abaya", "AI Abaya", 60000, 30000], ["scarf", "AI Scarf", 15000, 5000], ["pin", "AI Pin", 5000, 1000]] as const) {
        const p = (await trx.insertInto("products").values({ tenant_id: store, title, status: "active" }).returning("id").executeTakeFirstOrThrow()).id;
        const v = (await trx.insertInto("variants").values({ tenant_id: store, product_id: p, sku: `AI-${k}`, currency: "EGP", price_minor: price, cogs_minor: cost, cogs_set_at: new Date(), available: 5 }).returning("id").executeTakeFirstOrThrow()).id;
        await trx.insertInto("external_variants").values({ tenant_id: store, connection_id: shop, external_id: V[k], variant_id: v }).execute();
        out[k] = v;
      }
      return out;
    });
    // History: abayas go with scarves (most) and pins.
    for (let i = 0; i < 3; i++) await newOrder({ createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), lines: [line("abaya", `h${i}`, "600.00"), line("scarf", `h${i}`, "150.00")] });
    await newOrder({ createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), lines: [line("abaya", "h9", "600.00"), line("pin", "h9", "50.00")] });
  });
  afterAll(() => app.get(OfferAi).use(undefined));

  it("Claude chooses among Mizan's candidates and writes it; Mizan sets the price; the customer sees Claude's words", async () => {
    await settings();
    const id = await newOrder({ lines: [line("abaya", "a", "600.00")] });
    expect(await offerOf(id)).toMatchObject({ source: "auto", variant_id: ids.scarf, message_ar: null });
    await run();
    expect(await aiStep(id)).toMatchObject({ status: "done", last_error: null });
    expect(await offerOf(id)).toMatchObject({ source: "ai", variant_id: ids.scarf, discount_pct: "10.00", offer_price_minor: 13500n, message_ar: "🎁 كمّلي اللوك بـ 135 ج.م. بس", message_en: "🎁 Complete the look for just EGP 135" });

    const sent = JSON.parse(claude.requests.at(-1)!.messages[0].content);
    expect(sent).toMatchObject({ store: "Nile Abayas", maxDiscountPct: 15, order: [{ title: "abaya", quantity: 1 }] });
    const shown = sent.candidates.map((c: { title: string; margin: string }) => [c.title, c.margin]);
    expect(shown[0]).toEqual(["AI Scarf", "high"]); // bought with abayas most
    expect(shown).toContainEqual(["AI Pin", "high"]);
    expect(shown.length).toBeLessThanOrEqual(5);
    expect(JSON.stringify(claude.requests)).not.toMatch(/Mona|1001234821|Abbas|Nasr/); // no customer data

    const t = await templateFor(id);
    const before = wa.accepted.length;
    wa.tapQuickReply(CUSTOMER, t.confirm, t.message.id);
    await deliver();
    await run();
    expect(sentAfter(before)[0]!.body.interactive.body.text).toContain("🎁 كمّلي اللوك بـ 135 ج.م. بس");
  });

  it("an owner's rule keeps its item and discount; Claude only writes the words", async () => {
    await settings({ mode: "rules_then_auto" });
    const rule = (await http().post("/v1/offer-rules").set(as("owner")).send({ triggerVariantId: ids.abaya, offerVariantId: ids.pin, discountPct: "0" }).expect(201)).body.id;
    const id = await newOrder({ lines: [line("abaya", "r", "600.00")] });
    await run();
    expect(await offerOf(id)).toMatchObject({ source: "rule", variant_id: ids.pin, discount_pct: "0.00", offer_price_minor: 5000n, message_ar: "🎁 كمّلي اللوك بـ 50 ج.م. بس" });
    await http().patch(`/v1/offer-rules/${rule}`).set(as("owner")).send({ active: false }).expect(204);
  });

  it("a refusal, an answer that breaks a rule, or Claude being down keeps Mizan's own offer", async () => {
    await settings();
    for (const answer of ["refusal", "invented", "phone"] as const) {
      claude.answers.push(answer);
      const id = await newOrder({ lines: [line("abaya", answer, "600.00")] });
      await run();
      expect(await offerOf(id)).toMatchObject({ source: "auto", message_ar: null, offer_price_minor: 13500n });
      expect((await aiStep(id))?.status).toBe("done");
    }
    claude.faults.push("500", "500", "500", "500", "500", "500", "500", "500", "500");
    const down = await newOrder({ lines: [line("abaya", "down", "600.00")] });
    await run(); // retried later, then given up: the offer stays Mizan's
    await run(2);
    await run(2);
    expect(await offerOf(down)).toMatchObject({ source: "auto", message_ar: null });
    expect((await aiStep(down))?.status).toBe("done");
    claude.faults = [];
  });

  it("too late: once the customer has seen the offer, Claude's answer is not applied", async () => {
    await settings();
    const id = await newOrder({ lines: [line("abaya", "late", "600.00")] });
    const r = await runOf(id);
    await db.tenant(store, (trx) => trx.insertInto("confirmation_steps").values({
      tenant_id: store, run_id: r.id, idx: 0, channel: "whatsapp", kind: "reply", run_at: new Date(), status: "done", payload: JSON.stringify({ message: "confirmed_offer" }), idempotency_key: `${r.id}:reply:test`,
    }).execute());
    await run();
    expect(await aiStep(id)).toMatchObject({ status: "done", last_error: "late" });
    expect(await offerOf(id)).toMatchObject({ source: "auto", message_ar: null });
    await settings({ enabled: false, ai: false });
  });
});
