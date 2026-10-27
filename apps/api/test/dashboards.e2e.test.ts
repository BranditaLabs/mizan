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
 * E15-2: built-in dashboards show the metric layer's numbers (the same as /v1/metrics/values), with
 * daily series; each role sees only its dashboards and tiles; the same content downloads as CSV or Excel.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
const binary = (res: request.Response, cb: (e: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};
async function order(status?: "delivered" | "returned") {
  const r = await http().post("/v1/orders").set(as("owner")).send({
    source: "phone", customer: { name: "Mona Adel", phone: "01001234821" }, address: { line1: "12 Abbas El Akkad St", city: "Nasr City" },
    lines: [{ title: "Abaya", quantity: 1, unitPrice: "1000" }], shipping: "0", payment: { mode: "cod" },
  }).expect(201);
  await drain();
  if (status) {
    await db.tenant(store, async (trx) => {
      await trx.updateTable("orders").set({ status, confirmed_at: new Date(), shipped_at: new Date() }).where("id", "=", r.body.id).execute();
      await app.get(ProfitService).recompute(trx, store, r.body.id);
    });
  }
}

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null);
  fake.add("owner", { uid: "fb-owner-dash", email: "owner@dash.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Dashboards", country: "EG" }).expect(201)).body.id;
  for (const [token, role, phone] of [["agent", "agent", "01201114441"], ["wh", "warehouse", "01201114442"]] as const) {
    const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone, role }).expect(201);
    fake.add(token, { uid: `fb-${token}-dash`, phone: inv.body.phone });
    await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: `Bearer ${token}` }).expect(200);
  }
  await order("delivered");
  await order("delivered");
  await order("returned");
  await order();
});
afterAll(() => app.close());

describe("dashboards (E15-2)", () => {
  // Names come in the reader's profile language: Arabic unless they chose English.
  it("tiles are the metric layer's values; the series covers every day of the period", async () => {
    const d = (await http().get("/v1/dashboards/home?days=7").set(as("owner")).expect(200)).body;
    const v = (await http().get("/v1/metrics/values?days=7").set(as("owner")).expect(200)).body;
    expect(d).toMatchObject({ id: "home", name: "نظرة عامة", from: v.from, to: v.to, currency: "EGP" });
    for (const t of d.tiles) {
      const m = v.data.find((x: { key: string }) => x.key === t.key);
      expect(t.value).toBe(m.value);
    }
    expect(d.tiles.map((t: { key: string }) => t.key)).toEqual(["orders", "net_profit", "delivered_rate", "prepaid_share"]);
    expect(d.tiles.find((t: { key: string }) => t.key === "orders").value).toBe("4");
    const [orders, net] = d.series;
    expect(orders).toMatchObject({ key: "orders", unit: "count" });
    expect(net).toMatchObject({ key: "net_profit", unit: "money" });
    expect(orders.points).toHaveLength(7);
    expect(orders.points.at(-1).day).toBe(d.to);
    expect(orders.points.reduce((s: number, p: { value: string }) => s + Number(p.value), 0)).toBe(4);
    await http().get("/v1/dashboards/home?from=2026-10-01").set(as("owner")).expect(422);
    await http().get("/v1/dashboards/nope").set(as("owner")).expect(404);
  });

  it("each role sees only its dashboards, tiles and series", async () => {
    const list = async (t: string) => (await http().get("/v1/dashboards").set(as(t)).expect(200)).body.data.map((x: { id: string }) => x.id);
    expect(await list("owner")).toEqual(["home", "operations", "profit", "payments", "stock"]);
    expect(await list("agent")).toEqual(["home", "operations", "payments", "stock"]);
    const home = (await http().get("/v1/dashboards/home").set(as("agent")).expect(200)).body;
    expect(home.tiles.map((t: { key: string }) => t.key)).toEqual(["orders"]);
    expect(home.series.map((s: { key: string }) => s.key)).toEqual(["orders"]);
    await http().get("/v1/dashboards/profit").set(as("agent")).expect(404);
    await http().get("/v1/dashboards/profit/export").set(as("agent")).expect(404);
    const stock = (await http().get("/v1/dashboards/stock").set(as("wh")).expect(200)).body;
    expect(stock.tiles.map((t: { key: string }) => t.key)).toEqual(["days_of_cover", "orders"]);
  });

  it("downloads the dashboard as CSV (UTF-8 with BOM) or Excel", async () => {
    const c = await http().get("/v1/dashboards/operations/export?format=csv&days=7").set(as("owner")).buffer(true).parse(binary).expect(200);
    expect(c.headers["content-type"]).toMatch(/^text\/csv/);
    expect(c.headers["content-disposition"]).toMatch(/^attachment; filename="mizan-operations-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(c.headers["cache-control"]).toBe("no-store");
    const text = (c.body as Buffer).toString("utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain("التشغيل");
    expect(text).toContain("المقياس,القيمة");
    expect(text.split("\r\n").filter((l) => /^\d{4}-\d{2}-\d{2},/.test(l))).toHaveLength(7);

    const x = await http().get("/v1/dashboards/profit/export?days=30").set(as("owner")).buffer(true).parse(binary).expect(200);
    expect(x.headers["content-type"]).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect((x.body as Buffer).subarray(0, 2).toString()).toBe("PK");
    await http().get("/v1/dashboards/profit/export?format=pdf").set(as("owner")).expect(422);
  });
});
