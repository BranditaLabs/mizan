import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { EventDispatcher } from "../src/platform/events/dispatcher.js";
import { MessagingRegistry } from "../src/modules/confirmation/messaging.registry.js";
import { ProfitService } from "../src/modules/profit/profit.service.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E15-1: metric values for a period of store days, from one set of facts; the same metric shows the
 * same value as the profit home; each role sees only its metrics (hidden, not zero).
 */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
const http = () => request(app.getHttpServer());
const as = (token: string, lang = "en") => ({ Authorization: `Bearer ${token}`, "Accept-Language": lang, "X-Tenant-Id": store });
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
async function order(mode: object, status?: "delivered" | "returned" | "cancelled") {
  const r = await http().post("/v1/orders").set(as("owner")).send({
    source: "phone", customer: { name: "Mona Adel", phone: "01001234821" }, address: { line1: "12 Abbas El Akkad St", city: "Nasr City" },
    lines: [{ title: "Abaya", quantity: 1, unitPrice: "1000" }], shipping: "0", payment: mode,
  }).expect(201);
  await drain();
  if (status) {
    await db.tenant(store, async (trx) => {
      await trx.updateTable("orders").set({ status, confirmed_at: new Date(), ...(status !== "cancelled" ? { shipped_at: new Date() } : {}) }).where("id", "=", r.body.id).execute();
      await app.get(ProfitService).recompute(trx, store, r.body.id);
    });
  }
  return r.body.id as string;
}

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null);
  fake.add("owner", { uid: "fb-owner-metrics", email: "owner@metrics.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Metrics", country: "EG" }).expect(201)).body.id;
  for (const [token, role, phone] of [["agent", "agent", "01201113331"], ["wh", "warehouse", "01201113332"]] as const) {
    const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone, role }).expect(201);
    fake.add(token, { uid: `fb-${token}-metrics`, phone: inv.body.phone });
    await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: `Bearer ${token}` }).expect(200);
  }
  await order({ mode: "cod" }, "delivered");
  await order({ mode: "cod" }, "delivered");
  await order({ mode: "cod" }, "delivered");
  await order({ mode: "cod" }, "returned");
  await order({ mode: "prepaid", method: "wallet" }, "delivered");
  await order({ mode: "bank_transfer" });
  await order({ mode: "cod" }, "cancelled");
});
afterAll(() => app.close());

describe("metrics (E15-1)", () => {
  it("values for the period, and the same delivered rate and net profit as the profit home", async () => {
    const v = (await http().get("/v1/metrics/values?days=30").set(as("owner")).expect(200)).body;
    const by = Object.fromEntries(v.data.map((x: { key: string }) => [x.key, x]));
    expect(by.orders.value).toBe("6"); // the cancelled one left out
    expect(by.delivered_rate).toMatchObject({ value: "80.0", numerator: "4", denominator: "5" });
    expect(by.rto_rate.value).toBe("20.0");
    expect(by.prepaid_share).toMatchObject({ value: "33.3", numerator: "2", denominator: "6" }); // wallet + transfer
    expect(by.cod_share.value).toBe("66.7");
    expect(by.average_order_value.money).toEqual({ amount: "1000.00", currency: "EGP" });
    expect(by.days_of_cover.value).toBeNull(); // nothing shipped from counted stock
    const home = (await http().get("/v1/profit/home?days=30").set(as("owner")).expect(200)).body;
    expect(by.delivered_rate.value).toBe(home.period.deliveryRate);
    expect(by.net_profit.money).toEqual(home.period.net);
    expect(v.currency).toBe("EGP");
  });

  it("each role sees its metrics only, never a zero in their place; the catalogue speaks the reader's language", async () => {
    const agent = (await http().get("/v1/metrics/values?keys=orders,net_profit,delivered_rate").set(as("agent")).expect(200)).body;
    expect(agent.data.map((x: { key: string }) => x.key)).toEqual(["orders"]);
    const wh = (await http().get("/v1/metrics/catalogue").set(as("wh")).expect(200)).body;
    expect(wh.data.map((x: { key: string }) => x.key)).toEqual(["orders", "days_of_cover"]);
    const ar = (await http().get("/v1/metrics/catalogue").set(as("owner", "ar")).expect(200)).body;
    expect(ar.data.find((x: { key: string }) => x.key === "delivered_rate")).toMatchObject({ name: "نسبة التسليم", unit: "percent", module: "M3", version: 1 });
    const en = (await http().get("/v1/metrics/catalogue").set(as("owner", "en")).expect(200)).body;
    expect(en.data.find((x: { key: string }) => x.key === "delivered_rate")).toMatchObject({ name: "Delivered rate" });
    await http().get("/v1/metrics/values?keys=orders,happiness").set(as("owner")).expect(422);
    await http().get("/v1/metrics/values?days=12").set(as("owner")).expect(422);
    await http().get("/v1/metrics/values?from=2026-01-01").set(as("owner")).expect(422);
    await http().get("/v1/metrics/values?from=2025-01-01&to=2026-06-01").set(as("owner")).expect(422);
    const range = (await http().get("/v1/metrics/values?keys=orders&from=2026-01-01&to=2026-01-31").set(as("owner")).expect(200)).body;
    expect(range).toMatchObject({ from: "2026-01-01", to: "2026-01-31", data: [{ key: "orders", value: "0" }] });
  });
});
