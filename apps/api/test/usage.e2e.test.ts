import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { MessagingRegistry } from "../src/modules/confirmation/messaging.registry.js";
import { UsageCloser } from "../src/modules/billing/usage-closer.service.js";
import { monthOf } from "../src/modules/billing/plans.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E12-3: a store's usage per month, counted in the store's time zone (Riyadh here: no summer time,
 * so the month's edges are exact), and frozen once the month is over so invoices never move.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
let n = 0;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const usage = async (q = "", token = "owner") => (await http().get(`/v1/usage${q}`).set(as(token)).expect(200)).body;
const placeAt = (iso: string) => db.tenant(store, (trx) => trx.insertInto("orders").values({
  tenant_id: store, external_id: `usage-${++n}`, number: `#U${n}`, currency: "SAR", total_minor: 10000, placed_at: new Date(iso), status: n % 3 === 0 ? "cancelled" : "new",
}).execute());
const sendAt = (iso: string, status = "sent") => db.tenant(store, (trx) => trx.insertInto("whatsapp_messages").values({
  tenant_id: store, direction: "out", wamid: `wamid.${++n}`, kind: "template", status, created_at: new Date(iso),
}).execute());

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null);
  fake.add("owner", { uid: "fb-owner-usage", email: "owner@usage.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Riyadh Usage", country: "SA" }).expect(201)).body.id;
  await db.tenant(store, (trx) => trx.updateTable("tenants").set({ timezone: "Asia/Riyadh" }).where("id", "=", store).execute());
  for (const [token, role, phone] of [["finance", "finance", "+966501110001"], ["ops", "ops_manager", "+966501110002"]] as const) {
    const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone, role }).expect(201);
    fake.add(token, { uid: `fb-${token}-usage`, phone: inv.body.phone });
    await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: `Bearer ${token}` }).expect(200);
  }
});
afterAll(() => app.close());

describe("usage (E12-3)", () => {
  it("counts a month's orders and messages in the store's time zone, against the plan's limits", async () => {
    await placeAt("2026-09-30T20:59:59Z"); // 23:59:59 on 30 Sep in Riyadh
    await placeAt("2026-09-30T21:00:00Z"); // midnight, 1 Oct
    await placeAt("2026-10-15T09:00:00Z"); // cancelled: still an order Mizan handled
    await sendAt("2026-10-02T10:00:00Z");
    await sendAt("2026-10-02T10:01:00Z", "delivered");
    await sendAt("2026-10-02T10:02:00Z", "failed");
    await sendAt("2026-09-12T10:00:00Z");

    const oct = await usage("?month=2026-10", "finance");
    expect(oct).toMatchObject({
      month: "2026-10", timezone: "Asia/Riyadh", plan: "free", closed: false,
      usage: { orders: 2, whatsappMessages: 2, aiOffers: 0, stores: 0, users: 3 },
      limits: { ordersPerMonth: 300, stores: 1, users: 2 },
    });
    expect((await usage("?month=2026-09")).usage).toMatchObject({ orders: 1, whatsappMessages: 1 });
    const now = await usage();
    expect(now.month).toBe(monthOf(new Date(), "Asia/Riyadh").slice(0, 7));
    expect(now.history).toHaveLength(6);
    expect(now.history.find((h: { month: string }) => h.month === "2026-09")).toMatchObject({ orders: 1, whatsappMessages: 1, closed: false });
    await http().get("/v1/usage").set(as("ops")).expect(403);
    await http().get("/v1/usage?month=2026-13").set(as("owner")).expect(422);
  });

  it("freezes a month once it is over: once, and late orders never change it", async () => {
    const closer = app.get(UsageCloser);
    // 03:30 on 1 Nov in Riyadh: October is over.
    expect(await closer.runOnce(new Date("2026-11-01T00:30:00Z"))).toBeGreaterThanOrEqual(1);
    const frozen = await usage("?month=2026-10");
    expect(frozen).toMatchObject({ closed: true, usage: { orders: 2, whatsappMessages: 2, users: 3 } });
    await placeAt("2026-10-20T09:00:00Z"); // a late backfill
    expect((await usage("?month=2026-10")).usage.orders).toBe(2);
    const again = await db.tenant(store, (trx) => trx.selectFrom("usage_months").select(["orders", "plan"]).execute());
    expect(again).toEqual([{ orders: 2, plan: "free" }]);
    // 23:00 on 31 Oct in Riyadh: October is not over, so September would be the one to close.
    await closer.runOnce(new Date("2026-10-31T20:00:00Z"));
    expect((await usage("?month=2026-09")).closed).toBe(true);
    expect(await closer.runOnce(new Date("2026-11-01T00:30:00Z"))).toBe(0);
  });

  it("tells the owner and admins once a month when a limit is near or passed, and records an upgrade request (E12-1)", async () => {
    // 3 team members on Free (2): over. 240 orders this month: near the 300. (The earlier test froze
    // October, which may be this month by the clock: start from the live count.)
    await db.tenant(store, (trx) => trx.deleteFrom("usage_months").execute());
    const live = (await usage()).usage.orders;
    const placedNow = new Date();
    await db.tenant(store, (trx) => trx.insertInto("orders").values(Array.from({ length: 239 - live }, () => ({
      tenant_id: store, external_id: `bulk-${++n}`, number: `#B${n}`, currency: "SAR", total_minor: 1000, placed_at: placedNow,
    }))).execute());
    const place = () => http().post("/v1/orders").set(as("owner")).send({
      source: "phone", customer: { name: "Mona Adel", phone: "+966501234567" }, address: { line1: "King Fahd Rd 12", city: "Riyadh" },
      lines: [{ title: "Abaya", quantity: 1, unitPrice: "100" }], shipping: "0", payment: { mode: "cod" },
    }).expect(201);
    await place(); // the 240th: its order.created checks the limits
    const drain = async () => { const { EventDispatcher } = await import("../src/platform/events/dispatcher.js"); const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
    await drain();

    const u = await usage();
    expect(u.alerts).toEqual(expect.arrayContaining([
      { metric: "orders", level: "near", used: 240, limit: 300 }, { metric: "users", level: "over", used: 3, limit: 2 },
    ]));
    expect(u.nextPlan).toEqual({ plan: "growth", limits: { ordersPerMonth: 3000, stores: 3, users: 8 } });
    const notes = async () => db.tenant(store, (trx) => trx.selectFrom("notifications").select(["text", "source", "roles", "entity_type"]).where("source", "=", "plan.limit").orderBy("text").execute());
    expect(await notes()).toEqual([
      { text: "orders|near|240|300|free", source: "plan.limit", roles: ["owner", "admin"], entity_type: "plan" },
      { text: "users|over|3|2|free", source: "plan.limit", roles: ["owner", "admin"], entity_type: "plan" },
    ]);
    await place(); // another order: no second note for the same month and level
    await drain();
    expect(await notes()).toHaveLength(2);
    const bell = (await http().get("/v1/notifications?limit=20").set(as("owner")).expect(200)).body;
    expect(bell.data.filter((x: { source: string }) => x.source === "plan.limit")).toHaveLength(2);

    await http().post("/v1/usage/upgrade").set(as("finance")).send({ plan: "growth" }).expect(403);
    await http().post("/v1/usage/upgrade").set(as("owner")).send({ plan: "free" }).expect(422);
    const asked = (await http().post("/v1/usage/upgrade").set(as("owner")).send({ plan: "growth" }).expect(202)).body;
    expect(asked).toEqual({ plan: "growth", at: expect.any(String) });
    expect((await usage()).upgradeRequest).toEqual({ plan: "growth", at: asked.at });
    await drain();
    const ev = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select(["type", "data"]).where("type", "in", ["plan.upgrade_requested", "plan.limit_reached"]).orderBy("type").execute());
    expect(ev.map((e) => e.type)).toEqual(["plan.limit_reached", "plan.limit_reached", "plan.upgrade_requested"]);
    // Once on Growth, the request is done and the limits move.
    await db.tenant(store, (trx) => trx.updateTable("tenants").set({ plan: "growth" }).where("id", "=", store).execute());
    expect(await usage()).toMatchObject({ plan: "growth", upgradeRequest: null, alerts: [], nextPlan: { plan: "scale" } });
  });
});
