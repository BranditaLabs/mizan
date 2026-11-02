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
 * M7-2: where each order came from. The projector resolves the store's hints into order_sources;
 * the order shows it, the attribution report groups the period by platform and campaign, and a
 * backfill reads recent orders again. Click ids go with the order's personal data.
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
    connector: "shopify", externalId: `gid://shopify/Order/${9100 + n}`, number: `#${9100 + n}`, createdAt: at, updatedAt: at, currency: "EGP",
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
  fake.add("owner", { uid: "fb-owner-src", email: "owner@src.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Sources", country: "EG" }).expect(201)).body.id;
  connectionId = await db.tenant(store, async (trx) => {
    const ref = await app.get(SecretsService).create(trx, store, JSON.stringify({ accessToken: "shpat_fake_token" }), { actor: { type: "system" } });
    return (await trx.insertInto("connections").values({ tenant_id: store, kind: "store", provider: "shopify", external_account: "nile-src.myshopify.com", secret_ref: ref }).returning("id").executeTakeFirstOrThrow()).id;
  });
  const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone: "01201118882", role: "agent" }).expect(201);
  fake.add("agent", { uid: "fb-agent-src", phone: inv.body.phone });
  await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: "Bearer agent" }).expect(200);
});
afterAll(() => app.close());

describe("order sources (M7-2)", () => {
  let metaOrder: string;

  it("the order shows where it came from; the click id itself and the landing query are never shown", async () => {
    metaOrder = await project(order(metaAd));
    const d = (await http().get(`/v1/orders/${metaOrder}`).set(as("owner")).expect(200)).body;
    expect(d.source).toMatchObject({ platform: "meta", paid: true, rule: "click_id", clickIdKind: "fbclid", landingPath: "/p/abaya", utm: { source: "facebook", campaign: "eid" } });
    expect(JSON.stringify(d.source)).not.toMatch(/IwAR|mona@/);
    const stored = await db.tenant(store, (trx) => trx.selectFrom("order_sources").select(["click_id", "landing_path"]).where("order_id", "=", metaOrder).executeTakeFirstOrThrow());
    expect(stored).toEqual({ click_id: "IwAR-secret", landing_path: "/p/abaya" }); // kept for conversion events later (FB-1)
  });

  it("a later read with nothing to go on keeps the answer; better evidence replaces it", async () => {
    const o = order({ lastVisit: { referrerUrl: "https://www.google.com/" } });
    const id = await project(o);
    await project({ ...o, source: undefined, updatedAt: `${DAY}T11:00:00.000Z` });
    expect((await http().get(`/v1/orders/${id}`).set(as("owner")).expect(200)).body.source).toMatchObject({ platform: "google", rule: "referrer" });
    await project({ ...o, source: { lastVisit: { landingUrl: "/?gclid=Cj0" } }, updatedAt: `${DAY}T12:00:00.000Z` });
    expect((await http().get(`/v1/orders/${id}`).set(as("owner")).expect(200)).body.source).toMatchObject({ platform: "google", paid: true, rule: "click_id" });
  });

  it("orders typed by the team carry what the team said; nothing known is unknown", async () => {
    const manual = await project(order(undefined, { connector: "manual" }), { channel: "manual" });
    expect((await http().get(`/v1/orders/${manual}`).set(as("owner")).expect(200)).body.source).toMatchObject({ platform: "manual", rule: "channel" });
    const insta = await project(order({ lastVisit: { source: "instagram" } }, { connector: "manual" }), { channel: "manual" });
    expect((await http().get(`/v1/orders/${insta}`).set(as("owner")).expect(200)).body.source).toMatchObject({ platform: "meta", paid: null });
    const blind = await project(order(undefined));
    expect((await http().get(`/v1/orders/${blind}`).set(as("owner")).expect(200)).body.source).toMatchObject({ platform: "unknown", rule: "none" });
  });

  it("the report groups the period by platform and campaign, unknown included, with true ROAS where spend is recorded", async () => {
    const second = await project(order({ ...metaAd, lastVisit: { landingUrl: "/?utm_source=ig&utm_medium=cpc&utm_campaign=eid" } }));
    const tiktok = await project(order({ lastVisit: { landingUrl: "/?ttclid=T1&utm_campaign=launch" } }));
    await deliver(metaOrder); await deliver(second); await deliver(tiktok);
    await http().put("/v1/ad-spend").set(as("owner")).send({ day: DAY, platform: "meta", amount: "500" }).expect(200);

    const r = (await http().get("/v1/attribution/sources?days=7").set(as("owner")).expect(200)).body;
    expect(r.orders).toBe(7);
    const meta = r.byPlatform.find((p: { platform: string }) => p.platform === "meta");
    expect(meta).toMatchObject({ orders: 3, paid: 2, delivered: 2, deliveredRate: "100.0", spend: { amount: "500.00" }, real: { amount: "2000.00" }, trueRoas: "4.00" });
    expect(r.byPlatform.find((p: { platform: string }) => p.platform === "tiktok")).toMatchObject({ orders: 1, delivered: 1, spend: null, trueRoas: null });
    expect(r.byPlatform.find((p: { platform: string }) => p.platform === "unknown")).toMatchObject({ orders: 1 });
    expect(r.byPlatform[0].platform).toBe("meta"); // most orders first
    expect(r.campaigns.slice(0, 2)).toEqual([
      expect.objectContaining({ platform: "meta", campaign: "eid", orders: 2, delivered: 2 }),
      expect.objectContaining({ platform: "tiktok", campaign: "launch", orders: 1 }),
    ]);
    expect(r.attributedShare).toBe("85.7"); // 6 of 7 have a known source
    expect((await http().get("/v1/attribution/sources").set(as("agent")).expect(403)).body.code).toBe("insufficient_role");
  });

  it("a backfill reads the stores' recent orders again through the engine", async () => {
    expect((await http().post("/v1/attribution/sources/backfill").set(as("agent")).expect(403)).body.code).toBe("insufficient_role");
    const r = (await http().post("/v1/attribution/sources/backfill").set(as("owner")).expect(202)).body;
    expect(r).toEqual({ connections: 1, days: 60 });
    const jobs = await db.worker((trx) => trx.selectFrom("mz_outbox").select(["kind", "idempotency_key"]).where("tenant_id", "=", store).execute());
    expect(jobs.filter((j) => j.idempotency_key.includes("sources:"))).toHaveLength(1);
  });

  it("redacting the customer clears the click id with the rest of their data", async () => {
    await db.tenant(store, async (trx) => {
      const ext = (await trx.selectFrom("orders").select("external_id").where("id", "=", metaOrder).executeTakeFirstOrThrow()).external_id!;
      await (app.get(PrivacyService) as unknown as { redact(t: unknown, s: string, c: string, x: { orderIds: string[] }): Promise<unknown> }).redact(trx, store, connectionId, { orderIds: [ext] });
    });
    const after = await db.tenant(store, (trx) => trx.selectFrom("order_sources").select(["click_id", "click_id_kind", "platform"]).where("order_id", "=", metaOrder).executeTakeFirstOrThrow());
    expect(after).toEqual({ click_id: null, click_id_kind: null, platform: "meta" });
    await project({ ...order(metaAd), externalId: (await db.tenant(store, (trx) => trx.selectFrom("orders").select("external_id").where("id", "=", metaOrder).executeTakeFirstOrThrow())).external_id!, number: "#again", updatedAt: `${DAY}T13:00:00.000Z` });
    expect((await db.tenant(store, (trx) => trx.selectFrom("order_sources").select("click_id").where("order_id", "=", metaOrder).executeTakeFirstOrThrow())).click_id).toBeNull();
  });
});
