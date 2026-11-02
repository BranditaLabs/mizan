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
import { OrderProjector } from "../src/modules/orders/order-projector.js";
import { MessagingRegistry } from "../src/modules/confirmation/messaging.registry.js";
import { DEFAULT_CONFIRMATION } from "../src/modules/confirmation/confirmation.settings.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E6-6: the results the owner sees are what confirmation did. Orders go through the real flow
 * (routing by risk, the cascade, the team's answers); the summary counts them by route and by
 * the channel that got the answer, and never names a customer.
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

function order(phone: string, over: Partial<CanonicalOrder> = {}): CanonicalOrder {
  n++;
  const at = new Date(Date.now() - 30 * 60_000).toISOString();
  return {
    connector: "shopify", externalId: `gid://shopify/Order/${9900 + n}`, number: `#${9900 + n}`, createdAt: at, updatedAt: at, currency: "EGP",
    total: { amount: "1000.00", currency: "EGP" }, paymentMode: "cod", paymentStatus: "unpaid", gateways: ["COD"],
    received: { amount: "0.00", currency: "EGP" }, outstanding: { amount: "1000.00", currency: "EGP" }, refunded: { amount: "0.00", currency: "EGP" },
    cancelled: false, customer: { name: "Mona Adel", phone },
    shippingAddress: { name: "Mona Adel", phone, line1: "12 Abbas El Akkad St", city: "Nasr City", countryCode: "EG" },
    lines: [{ externalLineId: `L${n}`, sku: `SKU-${n}`, title: `Item ${n}`, quantity: 1, unitPrice: { amount: "1000.00", currency: "EGP" } }],
    fulfillmentGroups: [], tags: [], ...over,
  };
}
async function place(o: CanonicalOrder, history?: "delivered" | "returned") {
  await app.get(OrderProjector).project(store, connectionId, o);
  const id = (await db.tenant(store, (trx) => trx.selectFrom("orders").select("id").where("number", "=", o.number).executeTakeFirstOrThrow())).id;
  if (history) await db.tenant(store, (trx) => trx.updateTable("orders").set({ status: history, shipped_at: new Date() }).where("id", "=", id).execute());
  await drain();
  return id;
}

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null); // no channels: the cascade can only reach the team
  fake.add("owner", { uid: "fb-owner-cstats", email: "owner@cstats.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Results", country: "EG" }).expect(201)).body.id;
  await db.tenant(store, async (trx) => {
    const t = await trx.selectFrom("tenants").select("settings").where("id", "=", store).executeTakeFirstOrThrow();
    await trx.updateTable("tenants").set({ settings: JSON.stringify({
      ...(t.settings as object), orders: { duplicateWindowHours: 0 },
      confirmation: { ...DEFAULT_CONFIRMATION, callingHours: { start: "00:00", end: "23:59" }, routing: { enabled: true, autoMax: 25, botMax: 60, agentMax: 85 } },
    }) }).where("id", "=", store).execute();
  });
  connectionId = await db.tenant(store, async (trx) => (await trx.insertInto("connections").values({ tenant_id: store, kind: "store", provider: "shopify", external_account: "results.myshopify.com" }).returning("id").executeTakeFirstOrThrow()).id);
});
afterAll(() => app.close());

describe("confirmation results (E6-6)", () => {
  it("counts what each route and channel did", async () => {
    const empty = await http().get("/v1/confirmation/summary?days=7").set(as("owner")).expect(200);
    expect(empty.body).toEqual({ days: 7, orders: 0, confirmed: 0, cancelled: 0, pending: 0, rate: null, needsTeam: 0, medianMinutes: null, byRoute: [], byChannel: [] });

    // Auto: a trusted customer (3 delivered before; those are history, not confirmation) and a paid order.
    for (let i = 0; i < 3; i++) await place(order("+201005550001"), "delivered");
    await place(order("+201005550001"));
    await place(order("+201005550002", { paymentMode: "prepaid", paymentStatus: "paid", received: { amount: "1000.00", currency: "EGP" }, outstanding: { amount: "0.00", currency: "EGP" } }));
    // Bot: three new customers; with no channel connected the cascade hands them to the team's calls.
    const bot = [await place(order("+201005550011")), await place(order("+201005550012")), await place(order("+201005550013"))];
    // Agent: a customer who refused twice.
    await place(order("+201005550021"), "returned");
    await place(order("+201005550021"), "returned");
    const refuser = await place(order("+201005550021"));
    // An unpaid bank transfer waits for its money: not in confirmation.
    await place(order("+201005550031", { paymentMode: "bank_transfer" }));

    // The team calls: two of the new customers confirm, one cancels; the refuser confirms with an agent.
    for (const [id, answer] of [[bot[0], "confirm"], [bot[1], "confirm"], [bot[2], "cancel"]] as const) {
      await http().post(`/v1/orders/${id}/confirmation`).set(as("owner")).send({ answer, byCall: true, ...(answer === "cancel" ? { reason: "changed_mind" } : {}) }).expect(200);
    }
    await http().post(`/v1/orders/${refuser}/confirmation`).set(as("owner")).send({ answer: "confirm" }).expect(200);
    // One more new customer, still waiting for the team.
    await place(order("+201005550014"));

    const r = await http().get("/v1/confirmation/summary").set(as("owner")).expect(200);
    expect(r.body).toMatchObject({ days: 30, orders: 7, confirmed: 5, cancelled: 1, pending: 1, rate: "83.3", needsTeam: 1 });
    expect(r.body.medianMinutes).toBeGreaterThanOrEqual(29); // placed 30 minutes ago, confirmed now
    expect(r.body.byRoute).toEqual([
      { route: "auto", orders: 2, confirmed: 2, cancelled: 0, pending: 0, rate: "100.0" },
      { route: "bot", orders: 4, confirmed: 2, cancelled: 1, pending: 1, rate: "66.7" },
      { route: "agent", orders: 1, confirmed: 1, cancelled: 0, pending: 0, rate: "100.0" },
    ]);
    expect(r.body.byChannel).toEqual([
      { channel: "auto", confirmed: 2, cancelled: 0 },
      { channel: "call_team", confirmed: 2, cancelled: 1 },
      { channel: "agent", confirmed: 1, cancelled: 0 },
    ]);
    expect(JSON.stringify(r.body)).not.toMatch(/Mona|555|Abbas|#99/);
  });

  it("signed-in staff only; the period is 7, 30 or 90 days", async () => {
    await http().get("/v1/confirmation/summary?days=14").set(as("owner")).expect(422);
    await http().get("/v1/confirmation/summary").expect(401);
  });
});
