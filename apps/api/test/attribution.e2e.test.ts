import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import type { CanonicalOrder } from "@mizan/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { EventDispatcher } from "../src/platform/events/dispatcher.js";
import { SecretsService } from "../src/platform/secrets/secrets.service.js";
import { OrderProjector } from "../src/modules/orders/order-projector.js";
import { MessagingRegistry } from "../src/modules/confirmation/messaging.registry.js";
import { ProfitService } from "../src/modules/profit/profit.service.js";
import { addDays, localDay } from "../src/modules/profit/store-day.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * M7-1: True ROAS. Six orders placed yesterday from EGP 400 of ads, worth 5,100 at checkout: two
 * delivered, one refused and returned, one cancelled, two still moving (one COD, one paid by card).
 * Real money is what arrived; the platform's view counts every checkout.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
let connectionId: string;
let n = 0;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
const DAY = addDays(localDay(new Date(), "Africa/Cairo"), -1);

function order(over: Partial<CanonicalOrder> = {}): CanonicalOrder {
  n++;
  const at = `${DAY}T10:00:00.000Z`;
  return {
    connector: "shopify", externalId: `gid://shopify/Order/${8000 + n}`, number: `#${8000 + n}`, createdAt: at, updatedAt: at, currency: "EGP",
    total: { amount: "900.00", currency: "EGP" }, subtotal: { amount: "900.00", currency: "EGP" }, shipping: { amount: "0.00", currency: "EGP" },
    paymentMode: "cod", paymentStatus: "unpaid", gateways: ["Cash on Delivery (COD)"],
    received: { amount: "0.00", currency: "EGP" }, outstanding: { amount: "900.00", currency: "EGP" }, refunded: { amount: "0.00", currency: "EGP" },
    cancelled: false, customer: { name: "Mona Adel", phone: "+201001234821" },
    shippingAddress: { name: "Mona Adel", phone: "01001234821", line1: "12 Abbas El Akkad St", city: "Cairo", countryCode: "EG" },
    lines: [{ externalLineId: `L${n}`, sku: "AB-1", title: "Abaya", quantity: 1, unitPrice: { amount: "900.00", currency: "EGP" } }],
    fulfillmentGroups: [], tags: [], ...over,
  };
}
async function newOrder(over: Partial<CanonicalOrder> = {}): Promise<string> {
  const o = order(over);
  await app.get(OrderProjector).project(store, connectionId, o);
  await drain();
  return (await db.tenant(store, (trx) => trx.selectFrom("orders").select("id").where("number", "=", o.number).executeTakeFirstOrThrow())).id;
}
/** Move an order to where the courier left it, and recompute its profit as the events would. */
async function finish(id: string, status: "delivered" | "returned" | "cancelled" | "confirmed", shipped = status !== "confirmed" && status !== "cancelled") {
  await db.tenant(store, async (trx) => {
    const at = new Date(`${DAY}T15:00:00.000Z`);
    await trx.updateTable("orders").set({ status, confirmed_at: at, ...(shipped ? { shipped_at: at } : {}), ...(status === "delivered" ? { delivered_at: at } : {}), ...(status === "cancelled" ? { cancelled_at: at } : {}) })
      .where("id", "=", id).execute();
    await app.get(ProfitService).recompute(trx, store, id);
  });
}
const roas = async (q = "?days=7", token = "owner") => (await http().get(`/v1/attribution/roas${q}`).set(as(token)).expect(200)).body;

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null);
  fake.add("owner", { uid: "fb-owner-roas", email: "owner@roas.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile ROAS", country: "EG" }).expect(201)).body.id;
  connectionId = await db.tenant(store, async (trx) => {
    const ref = await app.get(SecretsService).create(trx, store, JSON.stringify({ accessToken: "shpat_fake_token" }), { actor: { type: "system" } });
    return (await trx.insertInto("connections").values({ tenant_id: store, kind: "store", provider: "shopify", external_account: "nile-roas.myshopify.com", secret_ref: ref }).returning("id").executeTakeFirstOrThrow()).id;
  });
  const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone: "01201118881", role: "agent" }).expect(201);
  fake.add("agent", { uid: "fb-agent-roas", phone: inv.body.phone });
  await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: "Bearer agent" }).expect(200);
});
afterAll(() => app.close());

describe("true ROAS (M7-1)", () => {
  it("is empty and honest before there is spend", async () => {
    const r = await roas();
    expect(r).toMatchObject({ spend: { amount: "0.00", currency: "EGP" }, trueRoas: null, reportedRoas: null, projectedRoas: null, orders: { placed: 0 }, byPlatform: [] });
    expect(r.days).toHaveLength(7);
  });

  it("counts what arrived, not checkouts: true, reported and projected ROAS; cost per delivered order", async () => {
    const [d1, d2, refused, cancelled] = [await newOrder(), await newOrder(), await newOrder(), await newOrder()];
    await newOrder(); // COD, still waiting for confirmation
    const card = await newOrder({
      total: { amount: "600.00", currency: "EGP" }, subtotal: { amount: "600.00", currency: "EGP" }, paymentMode: "prepaid", paymentStatus: "paid", gateways: ["paymob"],
      received: { amount: "600.00", currency: "EGP" }, outstanding: { amount: "0.00", currency: "EGP" },
      lines: [{ externalLineId: "Lcard", sku: "SC-1", title: "Scarf", quantity: 1, unitPrice: { amount: "600.00", currency: "EGP" } }],
    });
    await finish(d1, "delivered"); await finish(d2, "delivered"); await finish(refused, "returned"); await finish(cancelled, "cancelled"); await finish(card, "confirmed");
    await http().put("/v1/ad-spend").set(as("owner")).send({ day: DAY, platform: "meta", amount: "300" }).expect(200);
    await http().put("/v1/ad-spend").set(as("owner")).send({ day: DAY, platform: "tiktok", amount: "100" }).expect(200);
    await drain();

    const r = await roas();
    expect(r).toMatchObject({
      spend: { amount: "400.00" }, fxMissing: false,
      orders: { placed: 6, delivered: 2, returned: 1, cancelled: 1, moving: 2 },
      money: { placed: { amount: "5100.00" }, real: { amount: "2400.00" }, pending: { amount: "900.00" } },
      reportedRoas: "12.75", // 5,100 ÷ 400: what the platform would claim
      trueRoas: "6.00", // 1,800 cash delivered + 600 paid by card
      projectedRoas: "7.50", // + the waiting COD order at 2 of 3 finished delivered: 600 more
      costPerOrder: { amount: "66.67" }, costPerDelivered: { amount: "200.00" },
      deliveredRate: "66.7", lostShare: "33.3",
      byPlatform: [{ platform: "meta", spend: { amount: "300.00" }, share: "75.0" }, { platform: "tiktok", spend: { amount: "100.00" }, share: "25.0" }],
    });
    expect(r.days.find((d: { day: string }) => d.day === DAY)).toMatchObject({ spend: { amount: "400.00" }, orders: 6, delivered: 2, real: { amount: "2400.00" }, trueRoas: "6.00" });

    // The metric layer says the same, so reports and dashboards agree with this screen.
    const m = (await http().get("/v1/metrics/values?days=7&keys=true_roas,cost_per_delivered_order,ad_spend").set(as("owner")).expect(200)).body;
    expect(m.data).toEqual([
      expect.objectContaining({ key: "true_roas", unit: "multiple", value: "6.00" }),
      expect.objectContaining({ key: "cost_per_delivered_order", value: "200.00" }),
      expect.objectContaining({ key: "ad_spend", value: "400.00" }),
    ]);
  });

  it("is for owner, admin, ops manager and finance; a period is 7, 14, 30 or 90 days or a range", async () => {
    await http().get("/v1/attribution/roas").set(as("agent")).expect(403);
    await http().get("/v1/attribution/roas?days=5").set(as("owner")).expect(422);
    expect((await roas(`?from=${DAY}&to=${DAY}`)).days).toHaveLength(1);
    expect((await http().get("/v1/metrics/values?keys=true_roas").set(as("agent")).expect(200)).body.data).toEqual([]);
  });
});
