import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import type { CanonicalOrder } from "@mizan/shared";
import { FakeClock, FakeShopify, seeded, testRuntime } from "@mizan/engine/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { EventDispatcher } from "../src/platform/events/dispatcher.js";
import { SecretsService } from "../src/platform/secrets/secrets.service.js";
import { EngineRegistry } from "../src/integrations/engine-registry.js";
import { EngineJobRunner } from "../src/integrations/engine-runner.js";
import { OrderProjector } from "../src/modules/orders/order-projector.js";
import { MessagingRegistry } from "../src/modules/confirmation/messaging.registry.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E5-4: one action on many orders. Assign, tag, confirm and cancel run in chunks (progress shows
 * as they go); each order ends done, skipped with a reason, or failed; a cancel also cancels the
 * Shopify order once (no refund), and a paid order is skipped for a refund instead.
 */
const fake = new FakeVerifier();
const clock = new FakeClock();
clock.t = Date.now(); // bulk jobs are queued at the real time
const shop = new FakeShopify(clock, seeded(71));
let app: INestApplication;
let db: Database;
let store: string;
let connectionId: string;
let agentId: string;
let n = 0;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
async function settle() {
  const runner = app.get(EngineJobRunner);
  for (let i = 0; i < 30; i++) { await drain(); await runner.cycle(clock.now()); await runner.idle(); clock.advance(5_000); }
  await drain();
}
const idOf = (ext: string) => db.tenant(store, (trx) => trx.selectFrom("orders").select("id").where("external_id", "=", ext).executeTakeFirstOrThrow()).then((r) => r.id);
async function fromShop(payment: "cod" | "card" = "cod") {
  const o = shop.addOrder({ payment, phone: `+2010000${String(++n).padStart(5, "0")}` });
  const wh = shop.webhook("orders/create", o);
  await (await app.get(EngineRegistry).get(store)).engine.handleShopifyWebhook(wh.headers, wh.body);
  await settle();
  return { ext: o.id, id: await idOf(o.id) };
}
/** Orders typed by hand (no store), for the long list. */
async function manual(count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    n++;
    const at = new Date().toISOString();
    const o: CanonicalOrder = {
      connector: "manual", externalId: `manual:bulk-${n}`, number: `M-${2000 + n}`, createdAt: at, updatedAt: at, currency: "EGP",
      total: { amount: "500.00", currency: "EGP" }, paymentMode: "cod", paymentStatus: "unpaid", gateways: ["COD"],
      received: { amount: "0.00", currency: "EGP" }, outstanding: { amount: "500.00", currency: "EGP" }, refunded: { amount: "0.00", currency: "EGP" },
      cancelled: false, customer: { name: "Mona Adel", phone: `+20111${String(n).padStart(7, "0")}` },
      shippingAddress: { line1: "12 Abbas El Akkad St", city: "Nasr City", countryCode: "EG" },
      lines: [{ externalLineId: "L1", title: "Abaya", quantity: 1, unitPrice: { amount: "500.00", currency: "EGP" } }], fulfillmentGroups: [], tags: [],
    };
    ids.push((await app.get(OrderProjector).project(store, null, o, { channel: "manual" })).orderId);
  }
  await drain();
  return ids;
}
const order = (id: string) => db.tenant(store, (trx) => trx.selectFrom("orders").select(["status", "assigned_to", "tags", "number"]).where("id", "=", id).executeTakeFirstOrThrow());

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test", SHOPIFY_API_SECRET: shop.secret });
  app = await createApp(config, {
    logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake,
    engineRuntime: () => testRuntime(clock, { [shop.host]: shop.handler }, seeded(72)),
  });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null);
  fake.add("owner", { uid: "fb-owner-bulk", email: "owner@bulk.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Bulk", country: "EG" }).expect(201)).body.id;
  await http().put("/v1/settings/orders").set(as("owner")).send({ duplicateWindowHours: 0 }).expect(200);
  const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone: "01201115555", role: "agent" }).expect(201);
  fake.add("agent", { uid: "fb-agent-bulk", phone: inv.body.phone });
  await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: "Bearer agent" }).expect(200);
  agentId = (await http().get("/v1/me").set({ Authorization: "Bearer agent" }).expect(200)).body.user.id;
  connectionId = await db.tenant(store, async (trx) => {
    const ref = await app.get(SecretsService).create(trx, store, JSON.stringify({ accessToken: "shpat_fake_token" }), { actor: { type: "system" } });
    return (await trx.insertInto("connections").values({ tenant_id: store, kind: "store", provider: "shopify", external_account: shop.host, secret_ref: ref }).returning("id").executeTakeFirstOrThrow()).id;
  });
});
afterAll(() => app.close());

describe("bulk actions (E5-4)", () => {
  it("cancel: in Mizan at once, in Shopify once (no refund); paid, shipped and cancelled orders are skipped with a reason", async () => {
    const a = await fromShop();
    const b = await fromShop();
    const paid = await fromShop("card");
    const [shipped] = await manual(1);
    await db.tenant(store, (trx) => trx.updateTable("orders").set({ status: "shipped" }).where("id", "=", shipped!).execute());
    const r = await http().post("/v1/orders/bulk").set(as("owner")).send({ action: "cancel", orderIds: [a.id, b.id, paid.id, shipped], reason: "customer_cancelled" }).expect(202);
    expect(r.body).toMatchObject({ action: "cancel", status: "running", total: 4, done: 0 });
    await settle();

    const p = (await http().get(`/v1/orders/bulk/${r.body.id}`).set(as("owner")).expect(200)).body;
    expect(p).toMatchObject({ status: "done", total: 4, done: 2, skipped: 2, failed: 0 });
    expect(p.issues.map((i: { reason: string }) => i.reason).sort()).toEqual(["paid_needs_refund", "shipped"]);
    expect((await order(a.id)).status).toBe("cancelled");
    expect(shop.orders.get(a.ext)!.cancelledAt).not.toBeNull();
    expect(shop.orders.get(b.ext)!.cancelledAt).not.toBeNull();
    expect(shop.orders.get(paid.ext)!.cancelledAt).toBeNull();
    expect(shop.cancels).toBe(2);
    expect(shop.calls.filter((c) => c.op === "MizanOrderCancel").every((c) => !JSON.stringify(c.variables).includes("refund"))).toBe(true);

    // Again: nothing more happens anywhere.
    const again = await http().post("/v1/orders/bulk").set(as("owner")).send({ action: "cancel", orderIds: [a.id], reason: "customer_cancelled" }).expect(202);
    await settle();
    expect((await http().get(`/v1/orders/bulk/${again.body.id}`).set(as("owner")).expect(200)).body).toMatchObject({ done: 0, skipped: 1, issues: [{ reason: "cancelled" }] });
    expect(shop.cancels).toBe(2);
    const audit = await db.tenant(store, (trx) => trx.selectFrom("audit_log").select("action").where("entity_id", "=", r.body.id).execute());
    expect(audit).toEqual([{ action: "orders.bulk_requested" }]);
  });

  it("assign 40 orders to an agent in chunks; tag them (in Shopify too); confirm the pending ones", async () => {
    const s = await fromShop();
    const ids = [s.id, ...(await manual(39))];
    const r = await http().post("/v1/orders/bulk").set(as("owner")).send({ action: "assign", orderIds: ids, userId: agentId }).expect(202);
    await app.get(EventDispatcher).runOnce(); // one chunk
    const mid = (await http().get(`/v1/orders/bulk/${r.body.id}`).set(as("owner")).expect(200)).body;
    expect(mid.status).toBe("running");
    expect(mid.done).toBeGreaterThan(0);
    expect(mid.done).toBeLessThan(40);
    await drain();
    expect((await http().get(`/v1/orders/bulk/${r.body.id}`).set(as("owner")).expect(200)).body).toMatchObject({ status: "done", done: 40, skipped: 0, failed: 0 });
    expect((await order(ids[7]!)).assigned_to).toBe(agentId);
    const list = (await http().get("/v1/orders?limit=100").set(as("agent")).expect(200)).body;
    expect(list.data.length).toBeGreaterThanOrEqual(40); // the agent sees them now

    const t = await http().post("/v1/orders/bulk").set(as("owner")).send({ action: "tag", orderIds: [s.id, ids[1]], tags: ["VIP", "ramadan"] }).expect(202);
    await settle();
    expect((await http().get(`/v1/orders/bulk/${t.body.id}`).set(as("owner")).expect(200)).body).toMatchObject({ done: 2 });
    expect((await order(s.id)).tags).toEqual(expect.arrayContaining(["vip", "ramadan"]));
    expect(shop.orders.get(s.ext)!.tags).toEqual(expect.arrayContaining(["vip", "ramadan"]));
    expect((await order(s.id)).tags.filter((x) => x === "vip")).toHaveLength(1); // the store's copy came back without doubling

    const c = await http().post("/v1/orders/bulk").set(as("owner")).send({ action: "confirm", orderIds: [ids[2], ids[3]] }).expect(202);
    await settle();
    expect((await http().get(`/v1/orders/bulk/${c.body.id}`).set(as("owner")).expect(200)).body).toMatchObject({ done: 2 });
    expect((await order(ids[2]!)).status).toBe("confirmed");
    const ev = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select("data").where("entity_id", "=", ids[2]!).where("type", "=", "order.confirmed").executeTakeFirstOrThrow());
    expect(ev.data).toMatchObject({ channel: "agent" });
  });

  it("refuses what cannot be done, before anything starts", async () => {
    const [x] = await manual(1);
    const code = async (body: object, status = 422) => (await http().post("/v1/orders/bulk").set(as("owner")).send(body).expect(status)).body.code;
    expect(await code({ action: "assign", orderIds: [x], userId: "00000000-0000-4000-8000-000000000000" })).toBe("not_assignable");
    expect(await code({ action: "cancel", orderIds: [x, "11111111-1111-4111-8111-111111111111"], reason: "other" })).toBe("unknown_orders");
    expect(await code({ action: "cancel", orderIds: [x] })).toBe("validation_failed");
    expect(await code({ action: "ship", orderIds: [x] })).toBe("validation_failed");
    await http().post("/v1/orders/bulk").set(as("agent")).send({ action: "confirm", orderIds: [x] }).expect(403);
    await http().get("/v1/orders/bulk/22222222-2222-4222-8222-222222222222").set(as("owner")).expect(404);
    expect(connectionId).toBeTruthy();
  });
});
