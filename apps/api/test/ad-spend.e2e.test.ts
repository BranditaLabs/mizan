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
import { addDays, localDay } from "../src/modules/profit/store-day.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E9-3: ad spend per store and day, typed in or imported from a CSV, split over the orders that
 * store took that day (exactly, to the minor unit), re-split when an order joins or leaves the
 * day, converted at the day's rate, and shown when no order carries it.
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
/** Yesterday in the store's time zone: every order below is placed at its noon, so no test crosses a midnight. */
const DAY = addDays(localDay(new Date(), "Africa/Cairo"), -1);
const EMPTY_DAY = addDays(DAY, -2);

function order(over: Partial<CanonicalOrder> = {}): CanonicalOrder {
  n++;
  const at = `${DAY}T10:00:00.000Z`;
  return {
    connector: "shopify", externalId: `gid://shopify/Order/${7000 + n}`, number: `#${7000 + n}`, createdAt: at, updatedAt: at, currency: "EGP",
    total: { amount: "900.00", currency: "EGP" }, subtotal: { amount: "900.00", currency: "EGP" }, shipping: { amount: "0.00", currency: "EGP" },
    paymentMode: "cod", paymentStatus: "unpaid", gateways: ["Cash on Delivery (COD)"],
    received: { amount: "0.00", currency: "EGP" }, outstanding: { amount: "900.00", currency: "EGP" }, refunded: { amount: "0.00", currency: "EGP" },
    cancelled: false, customer: { name: "Mona Adel", phone: "+201001234821" },
    shippingAddress: { name: "Mona Adel", phone: "01001234821", line1: "12 Abbas El Akkad St", city: "Cairo", countryCode: "EG" },
    lines: [{ externalLineId: `L${n}`, sku: "AB-1", title: "Abaya", quantity: 1, unitPrice: { amount: "900.00", currency: "EGP" } }],
    fulfillmentGroups: [], tags: [], ...over,
  };
}
async function newOrder(over: Partial<CanonicalOrder> = {}): Promise<{ id: string; o: CanonicalOrder }> {
  const o = order(over);
  await app.get(OrderProjector).project(store, connectionId, o);
  await drain();
  return { id: (await db.tenant(store, (trx) => trx.selectFrom("orders").select("id").where("number", "=", o.number).executeTakeFirstOrThrow())).id, o };
}
/** Each order's ad share (minor units) for the test day. */
const shares = async () => {
  const rows = await db.tenant(store, (trx) => trx.selectFrom("order_pnl as p").innerJoin("orders as o", "o.id", "p.order_id")
    .select(["o.number", "o.status", "p.ads_minor", "p.flags"]).where("p.day", "=", new Date(`${DAY}T00:00:00Z`)).orderBy("o.placed_at").orderBy("o.id").execute());
  return rows;
};
const sum = (rows: Array<{ ads_minor: bigint | string }>) => rows.reduce((a, r) => a + BigInt(r.ads_minor), 0n);
const put = (body: object, token = "owner") => http().put("/v1/ad-spend").set(as(token)).send(body);
const list = async (q = "") => (await http().get(`/v1/ad-spend${q}`).set(as("owner")).expect(200)).body;

let orders: Array<{ id: string; o: CanonicalOrder }> = [];

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null);
  fake.add("owner", { uid: "fb-owner-ads", email: "owner@ads.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Ads", country: "EG" }).expect(201)).body.id;
  await expect(put({ day: DAY, platform: "meta", amount: "300" }).expect(422)).resolves.toMatchObject({ body: { code: "no_store" } });
  connectionId = await db.tenant(store, async (trx) => {
    const ref = await app.get(SecretsService).create(trx, store, JSON.stringify({ accessToken: "shpat_fake_token" }), { actor: { type: "system" } });
    return (await trx.insertInto("connections").values({ tenant_id: store, kind: "store", provider: "shopify", external_account: "nile-ads.myshopify.com", secret_ref: ref }).returning("id").executeTakeFirstOrThrow()).id;
  });
  const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone: "01201114444", role: "agent" }).expect(201);
  fake.add("agent", { uid: "fb-agent-ads", phone: inv.body.phone });
  await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: "Bearer agent" }).expect(200);
  orders = [await newOrder(), await newOrder(), await newOrder()];
});
afterAll(() => app.close());

describe("ad spend (E9-3)", () => {
  it("a day's spend is split over that day's orders, exactly", async () => {
    expect((await put({ day: DAY, platform: "meta", amount: "300" }).expect(200)).body).toMatchObject({ day: DAY, platform: "meta", spend: { amount: "300.00", currency: "EGP" }, connectionId });
    await drain();
    expect((await shares()).map((r) => BigInt(r.ads_minor))).toEqual([10000n, 10000n, 10000n]);
    const p = (await http().get(`/v1/orders/${orders[0]!.id}/pnl`).set(as("owner")).expect(200)).body;
    expect(p.ads).toEqual({ amount: "100.00", currency: "EGP" });
    expect(p.expectedNet.amount).toBe("800.00"); // 900 − 100 ads (nothing else is set up)

    await put({ day: DAY, platform: "tiktok", amount: "100.01" }).expect(200);
    await put({ day: DAY, platform: "meta", amount: "300" }).expect(200); // the same again changes nothing
    await drain();
    const s = await shares();
    expect(s.map((r) => BigInt(r.ads_minor))).toEqual([13334n, 13334n, 13333n]);
    expect(sum(s)).toBe(40001n);
  });

  it("an order placed that day takes its share; one cancelled gives it back", async () => {
    const late = await newOrder();
    let s = await shares();
    expect(s).toHaveLength(4);
    expect(sum(s)).toBe(40001n);
    expect(s.map((r) => BigInt(r.ads_minor))).toEqual([10001n, 10000n, 10000n, 10000n]);

    await app.get(OrderProjector).project(store, connectionId, { ...late.o, cancelled: true, updatedAt: new Date().toISOString() });
    await drain();
    s = await shares();
    expect(s.find((r) => r.status === "cancelled")!.ads_minor).toBe(0n);
    expect(sum(s)).toBe(40001n);
  });

  it("spend in another currency counts at the day's rate; without one it is flagged, not guessed", async () => {
    await put({ day: DAY, platform: "google", amount: "10", currency: "USD" }).expect(200);
    await drain();
    expect((await shares()).filter((r) => r.status !== "cancelled").every((r) => (r.flags as string[]).includes("ads_fx_missing"))).toBe(true);
    const before = await list(`?from=${DAY}&to=${DAY}`);
    expect(before.days[0]).toMatchObject({ day: DAY, spend: { amount: "400.01" }, fxMissing: true, orders: 3 });

    await http().put(`/v1/fx-rates/${DAY}/USD`).set(as("owner")).send({ rate: "0.02" }).expect(200); // 1 EGP = 0.02 USD
    await put({ day: DAY, platform: "google", amount: "10", currency: "USD" }).expect(200);
    await drain();
    const s = await shares();
    expect(sum(s)).toBe(40001n + 50000n); // 10 USD = 500 EGP
    expect(s.some((r) => (r.flags as string[]).includes("ads_fx_missing"))).toBe(false);
    const after = await list(`?from=${DAY}&to=${DAY}`);
    expect(after.byPlatform).toEqual([
      { platform: "google", spend: { amount: "500.00", currency: "EGP" } },
      { platform: "meta", spend: { amount: "300.00", currency: "EGP" } },
      { platform: "tiktok", spend: { amount: "100.01", currency: "EGP" } },
    ]);
    expect(after.days[0]).toMatchObject({ spend: { amount: "900.01" }, orders: 3, perOrder: { amount: "300.00" }, fxMissing: false });
  });

  it("a CSV replaces the days and platforms it names; one bad line saves nothing", async () => {
    const bad = await http().post("/v1/ad-spend/import").set(as("owner"))
      .send({ csv: `date,platform,spend\n${DAY},meta,150\n${DAY},myspace,10\n${addDays(DAY, 3)},meta,5\n` }).expect(422);
    expect(bad.body.code).toBe("csv_invalid");
    expect(bad.body.errors).toEqual([{ path: "line:3", code: "platform", message: "myspace" }, { path: "line:4", code: "future", message: addDays(DAY, 3) }]);
    expect(sum(await shares())).toBe(90001n);

    const ok = await http().post("/v1/ad-spend/import").set(as("owner"))
      .send({ csv: `date,platform,spend,campaign\n${DAY},Facebook,100,Abayas\n${DAY},Instagram,50,Abayas\n${DAY},meta,30,Scarves\n${EMPTY_DAY},meta,75,Abayas\n` }).expect(200);
    expect(ok.body).toEqual({ rows: 4, days: 2 });
    await drain();
    expect(sum(await shares())).toBe(18000n + 10001n + 50000n); // meta 300 → 180 (150 Abayas + 30 Scarves); tiktok and google stay
    const l = await list(`?from=${EMPTY_DAY}&to=${DAY}`);
    expect(l.data.filter((r: { platform: string; day: string }) => r.platform === "meta" && r.day === DAY).map((r: { campaign: string; spend: { amount: string }; source: string }) => [r.campaign, r.spend.amount, r.source]))
      .toEqual([["Abayas", "150.00", "csv"], ["Scarves", "30.00", "csv"]]);
    // A day the store took no orders: spend still counts, shown as not carried by any order.
    expect(l.days.find((d: { day: string }) => d.day === EMPTY_DAY)).toMatchObject({ orders: 0, perOrder: null, spend: { amount: "75.00" } });
    expect(l.unallocated).toEqual({ amount: "75.00", currency: "EGP" });
    expect(l.total).toEqual({ amount: "855.01", currency: "EGP" }); // meta 180 + tiktok 100.01 + google 500, and 75 on the empty day
  });

  it("removing a day's spend gives the orders their share back; who may change it, audited", async () => {
    await http().delete(`/v1/ad-spend/${DAY}/google`).set(as("owner")).expect(204);
    await http().delete(`/v1/ad-spend/${DAY}/google`).set(as("owner")).expect(404);
    await drain();
    expect(sum(await shares())).toBe(28001n);
    await put({ day: DAY, platform: "meta", amount: "1" }, "agent").expect(403);
    await http().get("/v1/ad-spend").set(as("agent")).expect(403);
    await put({ day: addDays(DAY, 5), platform: "meta", amount: "1" }).expect(422);
    await put({ day: DAY, platform: "meta", amount: "1.005" }).expect(422);
    const audit = await db.tenant(store, (trx) => trx.selectFrom("audit_log").select("action").where("action", "=", "ad_spend.changed").execute());
    expect(audit.length).toBeGreaterThanOrEqual(5);
  });

  it("with two stores, the spend must say which store it is for", async () => {
    const second = await db.tenant(store, async (trx) => (await trx.insertInto("connections").values({ tenant_id: store, kind: "store", provider: "shopify", external_account: "nile-two.myshopify.com" }).returning("id").executeTakeFirstOrThrow()).id);
    expect((await put({ day: DAY, platform: "meta", amount: "10" }).expect(422)).body.code).toBe("store_required");
    await put({ day: DAY, platform: "meta", amount: "10", connectionId: second }).expect(200);
    await drain();
    expect(sum(await shares())).toBe(28001n); // the first store's orders are not touched
  });
});
