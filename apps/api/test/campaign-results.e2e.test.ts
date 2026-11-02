import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import type { CanonicalOrder, OrderSourceHints } from "@mizan/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { EventDispatcher } from "../src/platform/events/dispatcher.js";
import { SecretsService } from "../src/platform/secrets/secrets.service.js";
import { OrderProjector } from "../src/modules/orders/order-projector.js";
import { MessagingRegistry } from "../src/modules/confirmation/messaging.registry.js";
import { PrivacyService } from "../src/modules/privacy/privacy.service.js";
import { ProfitService } from "../src/modules/profit/profit.service.js";
import { addDays, localDay } from "../src/modules/profit/store-day.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * M7-3: campaign results. Orders tagged by their ad links (utm_id / utm_campaign, utm_term,
 * utm_content) meet the spend imported per campaign, ad set and ad; untagged orders and spend
 * without the level's key are totalled apart.
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

function order(source: OrderSourceHints | undefined, over: Partial<CanonicalOrder> = {}): CanonicalOrder {
  n++;
  const at = `${DAY}T10:00:00.000Z`;
  return {
    connector: "shopify", externalId: `gid://shopify/Order/${9300 + n}`, number: `#${9300 + n}`, createdAt: at, updatedAt: at, currency: "EGP",
    total: { amount: "1000.00", currency: "EGP" }, subtotal: { amount: "1000.00", currency: "EGP" }, shipping: { amount: "0.00", currency: "EGP" },
    paymentMode: "cod", paymentStatus: "unpaid", gateways: ["Cash on Delivery (COD)"],
    received: { amount: "0.00", currency: "EGP" }, outstanding: { amount: "1000.00", currency: "EGP" }, refunded: { amount: "0.00", currency: "EGP" },
    cancelled: false, customer: { name: "Mona Adel", phone: "+201001234821" },
    shippingAddress: { name: "Mona Adel", phone: "01001234821", line1: "12 Abbas El Akkad St", city: "Cairo", countryCode: "EG" },
    lines: [{ externalLineId: `L${n}`, sku: "AB-1", title: "Abaya", quantity: 1, unitPrice: { amount: "1000.00", currency: "EGP" } }],
    fulfillmentGroups: [], tags: [], ...(source ? { source } : {}), ...over,
  };
}
async function project(o: CanonicalOrder, opts = {}): Promise<string> {
  const r = await app.get(OrderProjector).project(store, connectionId, o, opts);
  await drain();
  return r.orderId;
}
async function deliver(id: string) {
  await db.tenant(store, async (trx) => {
    const at = new Date(`${DAY}T15:00:00.000Z`);
    await trx.updateTable("orders").set({ status: "delivered", confirmed_at: at, shipped_at: at, delivered_at: at }).where("id", "=", id).execute();
    await app.get(ProfitService).recompute(trx, store, id);
  });
}
const metaAd: OrderSourceHints = { lastVisit: { landingUrl: "https://nile.shop/p/abaya?fbclid=IwAR-secret&utm_source=facebook&utm_medium=paid_social&utm_campaign=eid&email=mona@example.com" } };

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null);
  fake.add("owner", { uid: "fb-owner-cmp", email: "owner@cmp.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Campaigns", country: "EG" }).expect(201)).body.id;
  connectionId = await db.tenant(store, async (trx) => {
    const ref = await app.get(SecretsService).create(trx, store, JSON.stringify({ accessToken: "shpat_fake_token" }), { actor: { type: "system" } });
    return (await trx.insertInto("connections").values({ tenant_id: store, kind: "store", provider: "shopify", external_account: "nile-cmp.myshopify.com", secret_ref: ref }).returning("id").executeTakeFirstOrThrow()).id;
  });
  const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone: "01201118882", role: "agent" }).expect(201);
  fake.add("agent", { uid: "fb-agent-cmp", phone: inv.body.phone });
  await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: "Bearer agent" }).expect(200);
});
afterAll(() => app.close());


const ad = (q: string): OrderSourceHints => ({ lastVisit: { landingUrl: `https://nile.shop/p/abaya?fbclid=IwAR-x&utm_source=facebook&utm_medium=paid_social&${q}` } });
const get = async (q: string, token = "owner") => (await http().get(`/v1/attribution/campaigns?days=7${q}`).set(as(token)).expect(200)).body;

describe("campaign results", () => {
  it("meets spend per campaign, ad set and ad with the orders their links tagged", async () => {
    await http().post("/v1/ad-spend/import").set(as("owner")).send({
      platform: "meta",
      csv: `Day,Campaign name,Campaign ID,Ad set name,Ad set ID,Ad name,Ad ID,Amount spent (EGP)
${DAY},Eid Sale,1202001,Cairo women,9001,Video A,77,600
${DAY},Eid Sale,1202001,Cairo women,9001,Carousel B,78,400
${DAY},Brand,1202002,All,9002,Logo,79,100
`,
    }).expect(200);
    const a = await project(order(ad("utm_id=1202001&utm_campaign=Eid+Sale&utm_term=Cairo+women&utm_content=Video+A")));
    await project(order(ad("utm_campaign=eid%20sale&utm_term=9001&utm_content=77")));
    await project(order(ad("utm_campaign=Eid+Sale&utm_term=Cairo+women&utm_content=78")));
    await project(order(ad("utm_campaign=Summer&utm_term=Alex&utm_content=Reel")));                 // tagged, no spend recorded
    await project(order({ lastVisit: { landingUrl: "https://nile.shop/" } }));                    // direct: untagged
    await deliver(a);

    const c = await get("");
    expect(c.level).toBe("campaign");
    expect(c.spend).toEqual({ amount: "1100.00", currency: "EGP" });
    const eid = c.rows.find((r: { campaign: { key: string } }) => r.campaign.key === "1202001");
    expect(eid).toMatchObject({ platform: "meta", campaign: { name: "Eid Sale" }, spend: { amount: "1000.00", currency: "EGP" }, orders: 3, delivered: 1, adset: null, ad: null });
    expect(eid.real).toEqual({ amount: "1000.00", currency: "EGP" });
    expect(eid.trueRoas).toBe("1.00");
    expect(eid.costPerDelivered).toEqual({ amount: "1000.00", currency: "EGP" });
    expect(c.rows.find((r: { campaign: { key: string } }) => r.campaign.key === "1202002")).toMatchObject({ orders: 0, trueRoas: "0.00" });
    expect(c.rows.find((r: { campaign: { name: string } }) => r.campaign.name === "Summer")).toMatchObject({ spend: null, trueRoas: null, orders: 1 });
    expect(c.untagged.orders).toBe(1);
    expect(c.unassignedSpend).toEqual({ amount: "0.00", currency: "EGP" });

    const ads = await get("&level=ad");
    const byAd = Object.fromEntries(ads.rows.filter((r: { spend: unknown }) => r.spend).map((r: { ad: { name: string }; orders: number }) => [r.ad.name, r.orders]));
    expect(byAd).toEqual({ "Video A": 2, "Carousel B": 1, Logo: 0 });
    expect(ads.rows.find((r: { ad: { name: string } }) => r.ad.name === "Reel")).toMatchObject({ spend: null, adset: { name: "Alex" } });
    expect((await get("&level=adset")).rows[0]).toMatchObject({ adset: { key: "9001", name: "Cairo women" }, orders: 3 });
  });

  it("is for owners, admins, ops managers and finance; checks the level", async () => {
    await http().get("/v1/attribution/campaigns").set(as("agent")).expect(403);
    const bad = await http().get("/v1/attribution/campaigns?level=keyword").set(as("owner")).expect(422);
    expect(bad.body.code).toBe("validation_failed");
  });
});
