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
import { FakeFxSource } from "../src/modules/profit/fx/fx-source.js";
import { FxService } from "../src/modules/profit/fx/fx.service.js";
import { FakeVerifier } from "./support/fake-auth.js";

/** E9-2: order_pnl follows the order, its costs and rates, through events; the API shows one order's profit. */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
let connectionId: string;
let variantId: string;
let n = 0;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };

function order(over: Partial<CanonicalOrder> = {}): CanonicalOrder {
  n++;
  const at = new Date(Date.now() - 60_000).toISOString();
  return {
    connector: "shopify", externalId: `gid://shopify/Order/${6000 + n}`, number: `#${6000 + n}`, createdAt: at, updatedAt: at, currency: "EGP",
    total: { amount: "1250.00", currency: "EGP" }, subtotal: { amount: "1250.00", currency: "EGP" }, shipping: { amount: "0.00", currency: "EGP" },
    paymentMode: "cod", paymentStatus: "unpaid", gateways: ["Cash on Delivery (COD)"],
    received: { amount: "0.00", currency: "EGP" }, outstanding: { amount: "1250.00", currency: "EGP" }, refunded: { amount: "0.00", currency: "EGP" },
    cancelled: false, customer: { name: "Mona Adel", phone: "+201001234821" },
    shippingAddress: { name: "Mona Adel", phone: "01001234821", line1: "12 Abbas El Akkad St", city: "Cairo", countryCode: "EG" },
    lines: [{ externalLineId: `L${n}`, sku: "AB-1", title: "Abaya", quantity: 2, unitPrice: { amount: "625.00", currency: "EGP" } }],
    fulfillmentGroups: [], tags: [], ...over,
  };
}
async function newOrder(over: Partial<CanonicalOrder> = {}): Promise<string> {
  const o = order(over);
  await app.get(OrderProjector).project(store, connectionId, o);
  const id = (await db.tenant(store, (trx) => trx.selectFrom("orders").select("id").where("number", "=", o.number).executeTakeFirstOrThrow())).id;
  await db.tenant(store, (trx) => trx.updateTable("order_lines").set({ variant_id: variantId }).where("order_id", "=", id).execute());
  await drain();
  return id;
}
const pnl = async (id: string) => (await http().get(`/v1/orders/${id}/pnl`).set(as("owner")).expect(200)).body;
const amounts = (p: Record<string, { amount: string }>) => Object.fromEntries(["revenue", "productCost", "shipping", "codFee", "agent", "packaging", "returns", "net", "expectedRevenue", "expectedNet"].map((k) => [k, p[k]!.amount]));
const post = (body: object) => http().post("/v1/cost-rules").set(as("owner")).send(body).expect(201);

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null);
  fake.add("owner", { uid: "fb-owner", email: "owner@nile.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Abayas", country: "EG" }).expect(201)).body.id;
  ({ connectionId, variantId } = await db.tenant(store, async (trx) => {
    const secrets = app.get(SecretsService);
    const ref = await secrets.create(trx, store, JSON.stringify({ accessToken: "shpat_fake_token" }), { actor: { type: "system" } });
    const c = (await trx.insertInto("connections").values({ tenant_id: store, kind: "store", provider: "shopify", external_account: "nile.myshopify.com", secret_ref: ref }).returning("id").executeTakeFirstOrThrow()).id;
    const bref = await secrets.create(trx, store, JSON.stringify({ apiKey: "k" }), { actor: { type: "system" } });
    await trx.insertInto("connections").values({ tenant_id: store, kind: "courier", provider: "bosta", external_account: "bosta", secret_ref: bref, status: "active" }).execute();
    const p = (await trx.insertInto("products").values({ tenant_id: store, title: "Abaya" }).returning("id").executeTakeFirstOrThrow()).id;
    const v = (await trx.insertInto("variants").values({ tenant_id: store, product_id: p, sku: "AB-1", currency: "EGP", price_minor: 62500 }).returning("id").executeTakeFirstOrThrow()).id;
    return { connectionId: c, variantId: v };
  }));
  for (const [token, phone, role] of [["agent", "01201117777", "agent"], ["finance", "01201115555", "finance"]] as const) {
    const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone, role }).expect(201);
    fake.add(token, { uid: `fb-${token}`, phone: inv.body.phone });
    await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: `Bearer ${token}` }).expect(200);
  }
});
afterAll(() => app.close());

describe("order profit", () => {
  it("names what is missing before anything is set up", async () => {
    const id = await newOrder();
    const p = await pnl(id);
    expect(p).toMatchObject({ currency: "EGP", isFinal: false, net: { amount: "0.00" }, expectedRevenue: { amount: "1250.00" }, expectedNet: { amount: "1250.00" } });
    expect(p.flags).toEqual(["cost_missing"]);
  });

  it("follows costs: product cost and rules recompute open orders through events", async () => {
    const id = await newOrder();
    await http().put("/v1/products/variants/costs").set(as("owner")).send({ items: [{ variantId, cost: "400" }] }).expect(200);
    await post({ kind: "packaging_per_order", amount: "7.50" });
    await post({ kind: "agent_per_order", amount: "12" });
    await post({ kind: "cod_fee_pct", pct: "1.5" });
    await post({ kind: "courier_rate", amount: "60", returnAmount: "30", scope: { courier: "bosta", zone: "cairo" } });
    await drain();
    // Still open: nothing realised yet; expected 1,250 − 800 − 60 − 7.50 − 12 − 18.75 = 351.75
    expect(amounts(await pnl(id))).toMatchObject({ net: "0.00", expectedRevenue: "1250.00", expectedNet: "351.75" });
  });

  it("locks the product cost on confirmation, then realises revenue on delivery", async () => {
    const id = await newOrder();
    await http().post(`/v1/orders/${id}/confirmation`).set(as("owner")).send({ answer: "confirm" }).expect(200);
    await drain();
    expect(amounts(await pnl(id))).toMatchObject({ productCost: "800.00", agent: "12.00", net: "-812.00", expectedNet: "351.75" });

    // A later price change does not touch a confirmed order.
    await http().put("/v1/products/variants/costs").set(as("owner")).send({ items: [{ variantId, cost: "450" }] }).expect(200);
    await drain();
    expect((await pnl(id)).productCost.amount).toBe("800.00");

    await db.tenant(store, (trx) => trx.updateTable("orders").set({ status: "delivered", shipped_at: new Date(), delivered_at: new Date() }).where("id", "=", id).execute());
    await http().post("/v1/profit/recalculate").set(as("finance")).send({}).expect(200);
    const p = await pnl(id);
    expect(amounts(p)).toMatchObject({ revenue: "1250.00", productCost: "800.00", shipping: "60.00", codFee: "18.75", packaging: "7.50", agent: "12.00", net: "351.75", expectedNet: "351.75" });
    expect(p.flags).toEqual(["awaiting_settlement", "estimated"]);
    expect(p.isFinal).toBe(false);
  });

  it("a refused order loses shipping both ways and earns nothing; a cancelled one before shipping is final", async () => {
    const refused = await newOrder();
    await db.tenant(store, (trx) => trx.updateTable("orders").set({ status: "returned", confirmed_at: new Date(), shipped_at: new Date() }).where("id", "=", refused).execute());
    const o = order();
    await app.get(OrderProjector).project(store, connectionId, o);
    await drain();
    const cancelled = (await db.tenant(store, (trx) => trx.selectFrom("orders").select("id").where("number", "=", o.number).executeTakeFirstOrThrow())).id;
    await app.get(OrderProjector).project(store, connectionId, { ...o, cancelled: true, updatedAt: new Date().toISOString() });
    await drain();
    await http().post("/v1/profit/recalculate").set(as("owner")).send({}).expect(200);
    expect(amounts(await pnl(refused))).toMatchObject({ revenue: "0.00", productCost: "0.00", shipping: "60.00", returns: "30.00", net: "-109.50" });
    const c = await pnl(cancelled);
    expect(c).toMatchObject({ isFinal: true, net: { amount: "0.00" }, expectedNet: { amount: "0.00" } });
  });

  it("converts a foreign-currency order with the rate of its day, once there is one", async () => {
    const id = await newOrder({ currency: "USD", total: { amount: "100.00", currency: "USD" }, subtotal: { amount: "100.00", currency: "USD" }, shipping: { amount: "0.00", currency: "USD" },
      received: { amount: "0.00", currency: "USD" }, outstanding: { amount: "100.00", currency: "USD" }, refunded: { amount: "0.00", currency: "USD" },
      lines: [{ externalLineId: "LX", sku: "AB-1", title: "Abaya", quantity: 1, unitPrice: { amount: "100.00", currency: "USD" } }] });
    const before = await pnl(id);
    expect(before).toMatchObject({ currency: "USD", expectedRevenue: { amount: "100.00", currency: "USD" } });
    expect(before.flags).toContain("fx_missing");
    await app.get(FxService).refresh(new Date(), new FakeFxSource({ EGP: "50" }, before.day));
    const day = before.day as string;
    await http().put(`/v1/fx-rates/${day}/USD`).set(as("finance")).send({ rate: "0.02" }).expect(200);
    await drain();
    const after = await pnl(id);
    expect(after).toMatchObject({ currency: "EGP", expectedRevenue: { amount: "5000.00", currency: "EGP" } });
    expect(after.flags).not.toContain("fx_missing");
  });

  it("is for owner, admin, finance and ops; emits pnl.recomputed only when a number changes", async () => {
    const id = await newOrder();
    await http().get(`/v1/orders/${id}/pnl`).set(as("agent")).expect(403);
    await http().post("/v1/profit/recalculate").set(as("agent")).send({}).expect(403);
    await http().get("/v1/orders/00000000-0000-4000-8000-000000000000/pnl").set(as("owner")).expect(404);
    const count = async () => (await db.tenant(store, (trx) => trx.selectFrom("domain_events").select("id").where("type", "=", "pnl.recomputed").where("entity_id", "=", id).execute())).length;
    const first = await count();
    await http().post("/v1/profit/recalculate").set(as("owner")).send({}).expect(200);
    expect(await count()).toBe(first);
    const events = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select("data").where("type", "=", "pnl.recomputed").where("entity_id", "=", id).execute());
    expect(JSON.stringify(events)).not.toMatch(/Mona|1001234821/);
  });
});
