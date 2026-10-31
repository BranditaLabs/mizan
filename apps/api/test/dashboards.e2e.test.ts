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
import { localDay } from "../src/modules/profit/store-day.js";
import { isoWeekOf, isoWeekRange, lastFullWeek } from "../src/modules/reports/week.js";
import { toMinor } from "@mizan/shared";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E15-2: built-in dashboards show the metric layer's numbers (the same as /v1/metrics/values), with
 * daily series; each role sees only its dashboards and tiles; the same content downloads as CSV or Excel.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
const ids: string[] = [];
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
const binary = (res: request.Response, cb: (e: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};
async function order(status?: "delivered" | "returned" | "shipped") {
  const r = await http().post("/v1/orders").set(as("owner")).send({
    source: "phone", customer: { name: "Mona Adel", phone: "01001234821" }, address: { line1: "12 Abbas El Akkad St", city: "Nasr City" },
    lines: [{ title: "Abaya", quantity: 1, unitPrice: "1000" }], shipping: "0", payment: { mode: "cod" },
  }).expect(201);
  await drain();
  ids.push(r.body.id);
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
  // Names come in the request's language (the dashboard sends its own), else the profile's.
  it("tiles are the metric layer's values; the series covers every day of the period", async () => {
    const d = (await http().get("/v1/dashboards/home?days=7").set(as("owner")).expect(200)).body;
    const v = (await http().get("/v1/metrics/values?days=7").set(as("owner")).expect(200)).body;
    expect(d).toMatchObject({ id: "home", name: "Overview", from: v.from, to: v.to, currency: "EGP" });
    const ar = (await http().get("/v1/dashboards/home?days=7").set({ ...as("owner"), "Accept-Language": "ar" }).expect(200)).body;
    expect(ar.name).toBe("نظرة عامة");
    const none = (await http().get("/v1/dashboards").set({ Authorization: "Bearer owner", "X-Tenant-Id": store }).expect(200)).body;
    expect(none.data[0].name).toBe("نظرة عامة"); // no header: the profile's language (Arabic by default)
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
    expect(await list("owner")).toEqual(["home", "operations", "profit", "payments", "stock", "pilot"]);
    expect(await list("agent")).toEqual(["home", "operations", "payments", "stock", "pilot"]);
    const home = (await http().get("/v1/dashboards/home").set(as("agent")).expect(200)).body;
    expect(home.tiles.map((t: { key: string }) => t.key)).toEqual(["orders"]);
    expect(home.series.map((s: { key: string }) => s.key)).toEqual(["orders"]);
    await http().get("/v1/dashboards/profit").set(as("agent")).expect(404);
    await http().get("/v1/dashboards/profit/export").set(as("agent")).expect(404);
    const stock = (await http().get("/v1/dashboards/stock").set(as("wh")).expect(200)).body;
    expect(stock.tiles.map((t: { key: string }) => t.key)).toEqual(["days_of_cover", "orders"]);
  });

  it("downloads the dashboard as CSV (UTF-8 with BOM) or Excel", async () => {
    const c = await http().get("/v1/dashboards/operations/export?format=csv&days=7").set({ ...as("owner"), "Accept-Language": "ar" }).buffer(true).parse(binary).expect(200);
    expect(c.headers["content-type"]).toMatch(/^text\/csv/);
    expect(c.headers["content-disposition"]).toMatch(/^attachment; filename="mizan-operations-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(c.headers["cache-control"]).toBe("no-store");
    const text = (c.body as Buffer).toString("utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain("التشغيل");
    expect(text).toContain("المقياس,القيمة");
    // Downloaded from the English dashboard: an English file.
    const en = (await http().get("/v1/dashboards/operations/export?format=csv&days=7").set(as("owner")).buffer(true).parse(binary).expect(200)).body as Buffer;
    expect(en.toString("utf8")).toContain("Metric,Value");
    expect(text.split("\r\n").filter((l) => /^\d{4}-\d{2}-\d{2},/.test(l))).toHaveLength(7);

    const x = await http().get("/v1/dashboards/profit/export?days=30").set(as("owner")).buffer(true).parse(binary).expect(200);
    expect(x.headers["content-type"]).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect((x.body as Buffer).subarray(0, 2).toString()).toBe("PK");
    await http().get("/v1/dashboards/profit/export?format=pdf").set(as("owner")).expect(422);
  });
});

describe("pilot dashboard (L1-7)", () => {
  // Who confirmed each order: the WhatsApp bot and the link page are automation; a team member is not.
  beforeAll(async () => {
    const owner = (await http().get("/v1/me").set({ Authorization: "Bearer owner" }).expect(200)).body.user.id as string;
    await db.tenant(store, async (trx) => {
      await trx.deleteFrom("confirmations").where("order_id", "in", ids).execute();
      await trx.insertInto("confirmations").values([
        { tenant_id: store, order_id: ids[0]!, channel: "whatsapp", outcome: "confirmed" },
        { tenant_id: store, order_id: ids[1]!, channel: "link", outcome: "confirmed" },
        { tenant_id: store, order_id: ids[2]!, channel: "agent", outcome: "confirmed", agent_id: owner },
        { tenant_id: store, order_id: ids[3]!, channel: "whatsapp", outcome: "no_reply" }, // asked, never confirmed
      ]).execute();
    });
    // One more order, confirmed from the store (no attempt) and still on the road: its shipping and
    // packaging are booked, the cash is not in yet.
    await order("shipped");
    await db.tenant(store, (trx) => trx.updateTable("order_pnl").set({ shipping_minor: 6000n, packaging_minor: 1500n }).where("order_id", "=", ids[4]!).execute());
  });

  it("shows the pilot's six numbers from the metric layer, with orders and net profit per day", async () => {
    const d = (await http().get("/v1/dashboards/pilot?days=7").set(as("owner")).expect(200)).body;
    expect(d).toMatchObject({ id: "pilot", name: "Pilot" });
    expect((await http().get("/v1/dashboards/pilot?days=7").set({ ...as("owner"), "Accept-Language": "ar" }).expect(200)).body.name).toBe("متابعة التجربة");
    const by = Object.fromEntries(d.tiles.map((t: { key: string }) => [t.key, t]));
    expect(d.tiles.map((t: { key: string }) => t.key)).toEqual(["orders", "delivered_rate", "rto_rate", "cost_per_delivered_order", "profit_per_completed_order", "automation_share"]);
    expect(by.orders.value).toBe("5");
    expect(by.delivered_rate.value).toBe("66.7"); // 2 delivered of 3 that ended; the one on the road is not counted
    expect(by.rto_rate.value).toBe("33.3");
    expect(by.cost_per_delivered_order.value).toBe("0.00"); // no ad spend entered
    expect(by.automation_share).toMatchObject({ value: "50.0", unit: "percent" }); // 2 of 4 confirmed with nobody involved (the store confirmed one)
    const v = (await http().get("/v1/metrics/values?days=7&keys=net_profit,profit_per_completed_order,automation_share").set(as("owner")).expect(200)).body;
    const m = Object.fromEntries(v.data.map((x: { key: string }) => [x.key, x]));
    expect(m.automation_share).toMatchObject({ numerator: "2", denominator: "4" });
    // The net profit tile less the order still on the road (-75.00), over the 3 orders that ended.
    expect(m.profit_per_completed_order).toMatchObject({ numerator: String(toMinor(m.net_profit.money) + 7500n), denominator: "3" });
    expect(by.profit_per_completed_order.value).toBe(m.profit_per_completed_order.value);
    expect(d.series.map((s: { key: string }) => s.key)).toEqual(["orders", "net_profit"]);

    const agent = (await http().get("/v1/dashboards/pilot?days=7").set(as("agent")).expect(200)).body;
    expect(agent.tiles.map((t: { key: string }) => t.key)).toEqual(["orders"]); // rates, money and automation are for managers
    expect(agent.series.map((s: { key: string }) => s.key)).toEqual(["orders"]);
  });

  it("downloads one ISO week (Monday to Sunday, store days) as CSV or Excel; refuses a week that does not exist", async () => {
    const tz = (await db.tenant(store, (trx) => trx.selectFrom("tenants").select("timezone").where("id", "=", store).executeTakeFirstOrThrow())).timezone;
    const today = localDay(new Date(), tz);
    const week = isoWeekOf(today);
    const range = isoWeekRange(week)!;
    const c = await http().get(`/v1/dashboards/pilot/export?format=csv&week=${week}`).set(as("owner")).buffer(true).parse(binary).expect(200);
    expect(c.headers["content-disposition"]).toBe(`attachment; filename="mizan-pilot-${week}.csv"`);
    const text = (c.body as Buffer).toString("utf8");
    expect(text).toContain(`${week} · ${range.from} → ${range.to}`);
    const days = text.split("\r\n").filter((l) => /^\d{4}-\d{2}-\d{2},/.test(l));
    expect(days.map((l) => l.slice(0, 10))).toEqual(Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${range.from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10)));
    expect(days.reduce((n, l) => n + Number(l.split(",")[1]), 0)).toBe(5); // this week's orders, every one
    expect(text).toContain("Orders,5,count");

    const last = await http().get("/v1/dashboards/pilot/export?format=csv&week=last").set(as("owner")).buffer(true).parse(binary).expect(200);
    expect(last.headers["content-disposition"]).toBe(`attachment; filename="mizan-pilot-${lastFullWeek(today)}.csv"`);
    expect((last.body as Buffer).toString("utf8")).toContain("Orders,0,count");
    const shown = (await http().get("/v1/dashboards/pilot?week=last").set(as("owner")).expect(200)).body;
    expect({ from: shown.from, to: shown.to }).toEqual(isoWeekRange(lastFullWeek(today)));

    const x = await http().get(`/v1/dashboards/pilot/export?week=${week}`).set(as("owner")).buffer(true).parse(binary).expect(200);
    expect(x.headers["content-type"]).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(x.headers["content-disposition"]).toBe(`attachment; filename="mizan-pilot-${week}.xlsx"`);

    for (const bad of ["2025-W53", "2026-W00", "2026-W54", "2026-43", "W43", "last-week"]) {
      await http().get(`/v1/dashboards/pilot/export?format=csv&week=${bad}`).set(as("owner")).expect(422);
    }
    await http().get(`/v1/dashboards/pilot/export?week=${week}&days=7`).set(as("owner")).expect(422); // a week alone
    await http().get(`/v1/dashboards/pilot?week=${week}&from=2026-10-01&to=2026-10-02`).set(as("owner")).expect(422);
    await http().get(`/v1/metrics/values?week=2025-W53`).set(as("owner")).expect(422);
  });
});
