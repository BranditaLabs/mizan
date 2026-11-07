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
import { fixedCostsFor } from "../src/modules/profit/home.js";
import { addDays, localDay } from "../src/modules/profit/store-day.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E9-4: the profit home adds up what the order screens show. Four orders on one day (delivered,
 * refused, on its way, cancelled), ad spend split over them, a day of spend with no orders, a
 * monthly rent: every number below can be checked by hand.
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
const TODAY = localDay(new Date(), "Africa/Cairo");
const DAY = addDays(TODAY, -1);
const SINCE = addDays(TODAY, -40);
const egp = (amount: string) => ({ amount, currency: "EGP" });

async function placed(status: "delivered" | "returned" | "shipped" | "cancelled", opts: { day?: string; currency?: string; variant?: string; title?: string } = {}): Promise<string> {
  n++;
  const day = opts.day ?? DAY;
  const at = `${day}T10:00:00.000Z`;
  const m = (amount: string) => ({ amount, currency: opts.currency ?? "EGP" });
  const o: CanonicalOrder = {
    connector: "shopify", externalId: `gid://shopify/Order/${8000 + n}`, number: `#${8000 + n}`, createdAt: at, updatedAt: at, currency: opts.currency ?? "EGP",
    total: m("1000.00"), subtotal: m("1000.00"), shipping: m("0.00"), paymentMode: "cod", paymentStatus: "unpaid", gateways: ["Cash on Delivery (COD)"],
    received: m("0.00"), outstanding: m("1000.00"), refunded: m("0.00"), cancelled: false, customer: { name: "Mona Adel", phone: "+201001234821" },
    shippingAddress: { name: "Mona Adel", phone: "01001234821", line1: "12 Abbas El Akkad St", city: "Cairo", countryCode: "EG" },
    lines: [{ externalLineId: `L${n}`, sku: opts.variant ? "SC-1" : "AB-1", variantExternalId: `gid://shopify/ProductVariant/${opts.variant ?? "9"}`, title: opts.title ?? "Abaya", quantity: 1, unitPrice: m("1000.00") }],
    fulfillmentGroups: [], tags: [],
  };
  await app.get(OrderProjector).project(store, connectionId, o);
  await drain();
  return db.tenant(store, async (trx) => {
    const { id } = await trx.selectFrom("orders").select("id").where("number", "=", o.number).executeTakeFirstOrThrow();
    const t = new Date(`${day}T12:00:00.000Z`);
    await trx.updateTable("orders").set({
      status, confirmed_at: status === "cancelled" ? null : t, shipped_at: status === "cancelled" ? null : t,
      ...(status === "delivered" ? { delivered_at: t } : {}), ...(status === "cancelled" ? { cancelled_at: t } : {}),
    }).where("id", "=", id).execute();
    await app.get(ProfitService).recompute(trx, store, id);
    return id;
  });
}

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null);
  fake.add("owner", { uid: "fb-owner-home", email: "owner@home.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Home", country: "EG" }).expect(201)).body.id;
  connectionId = await db.tenant(store, async (trx) => {
    const secrets = app.get(SecretsService);
    const ref = await secrets.create(trx, store, JSON.stringify({ accessToken: "shpat_fake_token" }), { actor: { type: "system" } });
    const c = (await trx.insertInto("connections").values({ tenant_id: store, kind: "store", provider: "shopify", external_account: "nile-home.myshopify.com", secret_ref: ref }).returning("id").executeTakeFirstOrThrow()).id;
    const bref = await secrets.create(trx, store, JSON.stringify({ apiKey: "k" }), { actor: { type: "system" } });
    await trx.insertInto("connections").values({ tenant_id: store, kind: "courier", provider: "bosta", external_account: "bosta", secret_ref: bref, status: "active" }).execute();
    const p = (await trx.insertInto("products").values({ tenant_id: store, title: "Abaya" }).returning("id").executeTakeFirstOrThrow()).id;
    const v = (await trx.insertInto("variants").values({ tenant_id: store, product_id: p, sku: "AB-1", currency: "EGP", price_minor: 100000, cogs_minor: 40000, cogs_set_at: new Date() }).returning("id").executeTakeFirstOrThrow()).id;
    await trx.insertInto("external_variants").values({ tenant_id: store, connection_id: c, external_id: "gid://shopify/ProductVariant/9", variant_id: v }).execute();
    // FX-2: a product with no cost yet (used only by the provisional tests at the end).
    const sp = (await trx.insertInto("products").values({ tenant_id: store, title: "Scarf" }).returning("id").executeTakeFirstOrThrow()).id;
    const sv = (await trx.insertInto("variants").values({ tenant_id: store, product_id: sp, sku: "SC-1", currency: "EGP", price_minor: 100000 }).returning("id").executeTakeFirstOrThrow()).id;
    await trx.insertInto("external_variants").values({ tenant_id: store, connection_id: c, external_id: "gid://shopify/ProductVariant/10", variant_id: sv }).execute();
    return c;
  });
  const post = (body: object) => http().post("/v1/cost-rules").set(as("owner")).send({ validFrom: SINCE, ...body }).expect(201);
  await post({ kind: "courier_rate", amount: "60", returnAmount: "30", scope: { courier: "bosta", zone: "cairo" } });
  await post({ kind: "cod_fee_pct", pct: "1" });
  await post({ kind: "packaging_per_order", amount: "0" });
  await post({ kind: "agent_per_order", amount: "0" });
  await post({ kind: "fixed_monthly", amount: "3100", scope: { label: "Rent" } });
  await drain();
});
afterAll(() => app.close());

describe("profit home (E9-4)", () => {
  it("before any order: zeros, and nothing made up", async () => {
    const h = (await http().get("/v1/profit/home").set(as("owner")).expect(200)).body;
    expect(h).toMatchObject({ baseCurrency: "EGP", today: TODAY, days: 30, to: TODAY, from: addDays(TODAY, -29) });
    expect(h.period).toMatchObject({ orders: 0, revenue: egp("0.00"), net: egp("0.00"), margin: null, deliveryRate: null, keptPer100: null });
    expect(h.trend).toHaveLength(30);
    expect(h.leaks).toEqual([]);
    // FX-2: nothing delivered yet, so nothing on the home can read as final.
    expect(h.period.quality).toEqual({ costsComplete: true, delivered: false, provisional: true, ordersMissingCosts: 0, productsMissingCost: 0 });
  });

  it("adds up the orders: delivered, refused, on its way, cancelled; ads, rent and spend no order carried", async () => {
    const delivered = await placed("delivered");
    await placed("returned");
    await placed("shipped");
    await placed("cancelled");
    await http().put("/v1/ad-spend").set(as("owner")).send({ day: DAY, platform: "meta", amount: "300" }).expect(200);
    await http().put("/v1/ad-spend").set(as("owner")).send({ day: addDays(DAY, -3), platform: "meta", amount: "50" }).expect(200);
    await drain();
    expect((await http().get(`/v1/orders/${delivered}/pnl`).set(as("owner")).expect(200)).body.net).toEqual(egp("430.00")); // 1000 − 400 − 60 − 10 COD fee − 100 ads

    const h = (await http().get("/v1/profit/home").set(as("owner")).expect(200)).body;
    // Delivered +430; refused −190 (60 out, 30 back, 100 ads; goods back in stock); on its way −560 so far (+430 if it delivers).
    const rent = fixedCostsFor([{ amountMinor: 310000n, validFrom: SINCE, validTo: null }], h.from, h.to);
    const fixed = (Number(rent) / 100).toFixed(2);
    expect(h.period).toMatchObject({
      orders: 4, revenue: egp("1000.00"), net: egp("-320.00"), expectedNet: egp("670.00"), adSpend: egp("350.00"), unallocatedAds: egp("50.00"),
      fixedCosts: egp(fixed), delivered: 1, returned: 1, deliveryRate: "50.0", refusalLoss: egp("190.00"),
    });
    const kept = -32000 - Number(rent) - 5000;
    expect(h.period.kept).toEqual(egp((kept / 100).toFixed(2)));
    expect(h.period.breakdown).toMatchObject({
      revenue: egp("1000.00"), productCost: egp("800.00"), shippingAndCod: egp("190.00"), ads: egp("350.00"), returns: egp("30.00"), fixed: egp(fixed), kept: egp((kept / 100).toFixed(2)),
    });
    expect(h.yesterday).toMatchObject({ day: DAY, orders: 4, net: egp("-320.00"), expectedNet: egp("670.00") });
    expect(h.cash).toEqual({ inTransit: egp("1000.00"), inTransitOrders: 1, awaitingRemittance: egp("1000.00"), awaitingRemittanceOrders: 1 });
    expect(h.trend.find((d: { day: string }) => d.day === DAY)).toMatchObject({ orders: 4, net: egp("-320.00") });
    expect(h.leaks.map((l: { kind: string }) => l.kind)).toEqual(["losing_orders", "refusals", "unallocated_ads"]);
    // FX-2: every cost in and an order delivered: the figures are final.
    expect(h.period.quality).toEqual({ costsComplete: true, delivered: true, provisional: false, ordersMissingCosts: 0, productsMissingCost: 0 });
    expect(h.leaks[0]).toMatchObject({ kind: "losing_orders", count: 1, amount: egp("190.00") }); // the refused order: still losing when all is done
  });

  it("a week, a quarter; nothing else", async () => {
    const week = (await http().get("/v1/profit/home?days=7").set(as("owner")).expect(200)).body;
    expect(week).toMatchObject({ days: 7, from: addDays(TODAY, -6) });
    expect(week.period.net).toEqual(egp("-320.00"));
    await http().get("/v1/profit/home?days=90").set(as("owner")).expect(200);
    await http().get("/v1/profit/home?days=12").set(as("owner")).expect(422);
  });
});

describe("profit breakdown (E9-5)", () => {
  it("every grouping adds up to the home's orders (ads no order carried and rent stay on the home)", async () => {
    const get = async (by: string) => (await http().get(`/v1/profit/breakdown?by=${by}`).set(as("owner")).expect(200)).body;
    const total = { orders: 4, delivered: 1, returned: 1, revenue: egp("1000.00"), productCost: egp("800.00"), shippingAndCod: egp("190.00"), ads: egp("300.00"), returns: egp("30.00"), net: egp("-320.00"), expectedNet: egp("670.00"), margin: "-32.0", costsMissing: 0 };
    const day = await get("day");
    expect(day).toMatchObject({ by: "day", baseCurrency: "EGP", to: TODAY, from: addDays(TODAY, -29), total });
    expect(day.rows).toEqual([expect.objectContaining({ key: DAY, label: DAY, special: false, orders: 4, net: egp("-320.00") })]);
    const product = await get("product");
    expect(product.rows).toEqual([expect.objectContaining({ label: "Abaya", special: false, ...total })]);
    const store = await get("store");
    expect(store.rows).toEqual([expect.objectContaining({ key: connectionId, label: "nile-home.myshopify.com", orders: 4 })]);
    const courier = await get("courier");
    expect(courier.rows).toEqual([expect.objectContaining({ key: "none", special: true, orders: 4 })]); // no shipment booked through Mizan yet
    const country = await get("country");
    expect(country.rows).toEqual([expect.objectContaining({ key: "EG", orders: 4, net: egp("-320.00") })]);
    for (const b of [product, store, courier, country]) expect(b.total).toEqual(day.total);
    expect(JSON.stringify(product)).not.toMatch(/Mona|1234821|Abbas/);
  });

  it("a chosen range; nothing upside down or longer than a year", async () => {
    const one = (await http().get(`/v1/profit/breakdown?by=day&from=${DAY}&to=${DAY}`).set(as("owner")).expect(200)).body;
    expect(one).toMatchObject({ from: DAY, to: DAY, total: { orders: 4 } });
    const before = (await http().get(`/v1/profit/breakdown?by=day&from=${addDays(DAY, -5)}&to=${addDays(DAY, -1)}`).set(as("owner")).expect(200)).body;
    expect(before).toMatchObject({ rows: [], total: { orders: 0, net: egp("0.00"), margin: null } });
    await http().get(`/v1/profit/breakdown?by=day&from=${DAY}&to=${addDays(DAY, -1)}`).set(as("owner")).expect(422);
    await http().get(`/v1/profit/breakdown?by=day&from=${addDays(DAY, -400)}&to=${DAY}`).set(as("owner")).expect(422);
    await http().get("/v1/profit/breakdown?by=campaign").set(as("owner")).expect(422);
  });
});

describe("provisional profit on real rows (FX-2): every screen counts the same orders", () => {
  const GAP_DAY = addDays(TODAY, -10);
  const range = `from=${GAP_DAY}&to=${GAP_DAY}`;

  it("an order with a product without a cost makes the period provisional; a cancelled one never counts", async () => {
    await placed("delivered", { day: GAP_DAY, variant: "10", title: "Scarf" });
    await placed("cancelled", { day: GAP_DAY, variant: "10", title: "Scarf" });

    const h = (await http().get("/v1/profit/home").set(as("owner")).expect(200)).body;
    expect(h.period.quality).toEqual({ costsComplete: false, delivered: true, provisional: true, ordersMissingCosts: 1, productsMissingCost: 1 });
    expect(h.period.margin).toBeNull();

    const values = (await http().get(`/v1/metrics/values?keys=net_profit,orders&${range}`).set(as("owner")).expect(200)).body;
    expect(values.quality).toMatchObject({ costsComplete: false, provisional: true, ordersMissingCosts: 1, productsMissingCost: 1 });
    expect(values.data.find((v: { key: string }) => v.key === "net_profit")).toMatchObject({ provisional: true });
    expect(values.data.find((v: { key: string }) => v.key === "orders")).toMatchObject({ provisional: false });

    const dash = (await http().get(`/v1/dashboards/profit?${range}`).set(as("owner")).expect(200)).body;
    expect(dash.quality).toMatchObject({ provisional: true, ordersMissingCosts: 1 });
    expect(dash.tiles.find((t: { key: string }) => t.key === "net_profit")).toMatchObject({ provisional: true });
    const file = await http().get(`/v1/dashboards/profit/export?format=csv&${range}`).set(as("owner")).expect(200);
    expect(file.text).toContain("Provisional profit: 1 order misses a cost.");

    // Breakdown by product: the delivered scarf is missing; the cancelled one (same product, no cost) is not.
    const byProduct = (await http().get(`/v1/profit/breakdown?by=product&${range}`).set(as("owner")).expect(200)).body;
    expect(byProduct.total).toMatchObject({ orders: 2, costsMissing: 1, margin: null });
    expect(byProduct.rows).toEqual([expect.objectContaining({ label: "Scarf", orders: 2, costsMissing: 1, margin: null })]);
    const byDay = (await http().get(`/v1/profit/breakdown?by=day&${range}`).set(as("owner")).expect(200)).body;
    expect(byDay.total).toMatchObject({ costsMissing: 1 });
  });

  it("an order in a currency with no exchange rate counts too, though it stays out of the totals", async () => {
    const usd = await placed("delivered", { day: GAP_DAY, currency: "USD" });
    expect((await http().get(`/v1/orders/${usd}/pnl`).set(as("owner")).expect(200)).body.flags).toContain("fx_missing");
    const h = (await http().get("/v1/profit/home").set(as("owner")).expect(200)).body;
    expect(h.period.quality).toMatchObject({ costsComplete: false, provisional: true, ordersMissingCosts: 2, productsMissingCost: 1 });
    expect(h.period.margin).toBeNull();
    const values = (await http().get(`/v1/metrics/values?keys=net_profit&${range}`).set(as("owner")).expect(200)).body;
    expect(values.quality).toMatchObject({ provisional: true, ordersMissingCosts: 2 });
  });
});
