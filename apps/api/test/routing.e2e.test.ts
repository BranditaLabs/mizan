import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import type { CanonicalOrder } from "@mizan/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { EventDispatcher } from "../src/platform/events/dispatcher.js";
import { OrderProjector } from "../src/modules/orders/order-projector.js";
import { MessagingRegistry } from "../src/modules/confirmation/messaging.registry.js";
import { DEFAULT_CONFIRMATION } from "../src/modules/confirmation/confirmation.settings.js";

/**
 * E6-2: with routing on, a new order's score (E6-1) decides what confirmation does: a trusted
 * cash customer is confirmed without being asked; a new one is asked (the cascade); a customer
 * who refused before goes straight to the team's calls; the riskiest are held for review; a paid
 * order is approved; an unpaid bank transfer waits. Every routed order says its route.
 */
const T = "aaaaaaaa-0000-4000-8000-0000000000e2";
let app: INestApplication;
let db: Database;
let connectionId: string;
let n = 0;

function order(phone: string, over: Partial<CanonicalOrder> = {}): CanonicalOrder {
  n++;
  const at = new Date(Date.now() - 5 * 60_000).toISOString();
  return {
    connector: "shopify", externalId: `gid://shopify/Order/${9700 + n}`, number: `#${9700 + n}`, createdAt: at, updatedAt: at, currency: "EGP",
    total: { amount: "1000.00", currency: "EGP" }, paymentMode: "cod", paymentStatus: "unpaid", gateways: ["COD"],
    received: { amount: "0.00", currency: "EGP" }, outstanding: { amount: "1000.00", currency: "EGP" }, refunded: { amount: "0.00", currency: "EGP" },
    cancelled: false, customer: { name: "Mona Adel", phone },
    shippingAddress: { name: "Mona Adel", phone, line1: "12 Abbas El Akkad St", city: "Nasr City", countryCode: "EG" },
    lines: [{ externalLineId: `L${n}`, sku: `SKU-${n}`, title: `Item ${n}`, quantity: 1, unitPrice: { amount: "1000.00", currency: "EGP" } }],
    fulfillmentGroups: [], tags: [], ...over,
  };
}
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
async function place(o: CanonicalOrder, history?: "delivered" | "returned") {
  await app.get(OrderProjector).project(T, connectionId, o);
  const id = (await db.tenant(T, (trx) => trx.selectFrom("orders").select("id").where("number", "=", o.number).executeTakeFirstOrThrow())).id;
  if (history) await db.tenant(T, (trx) => trx.updateTable("orders").set({ status: history, shipped_at: new Date() }).where("id", "=", id).execute());
  await drain();
  return id;
}
const state = (id: string) => db.tenant(T, async (trx) => {
  const o = await trx.selectFrom("orders").select(["status", "risk_score", "confirm_route"]).where("id", "=", id).executeTakeFirstOrThrow();
  const run = await trx.selectFrom("confirmation_runs").select(["status", "reason"]).where("order_id", "=", id).executeTakeFirst();
  const sends = await trx.selectFrom("confirmation_steps as s").innerJoin("confirmation_runs as r", "r.id", "s.run_id").select("s.status").where("r.order_id", "=", id).where("s.kind", "=", "send").where("s.status", "=", "pending").execute();
  return { ...o, run: run ?? null, pendingSends: sends.length };
});

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }) });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null); // no channels: the cascade can only reach the team
  await db.kysely.insertInto("tenants").values({
    id: T, name: "Nile Routing", slug: "nile-routing",
    settings: JSON.stringify({ phoneCountry: "EG", orders: { duplicateWindowHours: 0 }, confirmation: { ...DEFAULT_CONFIRMATION, callingHours: { start: "00:00", end: "23:59" }, routing: { enabled: true, autoMax: 25, botMax: 60, agentMax: 85 } } }),
  }).execute();
  connectionId = await db.tenant(T, async (trx) => (await trx.insertInto("connections").values({ tenant_id: T, kind: "store", provider: "shopify", external_account: "routing.myshopify.com" }).returning("id").executeTakeFirstOrThrow()).id);
});
afterAll(() => app.close());

describe("routing by risk (E6-2)", () => {
  it("a trusted cash customer is confirmed without being asked", async () => {
    for (let i = 0; i < 3; i++) await place(order("+201005556661"), "delivered");
    const id = await place(order("+201005556661"));
    expect(await state(id)).toMatchObject({ status: "confirmed", risk_score: 0, confirm_route: "auto", run: null, pendingSends: 0 });
    const ev = await db.tenant(T, (trx) => trx.selectFrom("domain_events").select(["type", "data"]).where("entity_id", "=", id).where("type", "in", ["confirmation.routed", "order.confirmed"]).orderBy("occurred_at").execute());
    expect(ev.map((e) => [e.type, (e.data as { route?: string; channel?: string }).route ?? (e.data as { channel?: string }).channel])).toEqual(expect.arrayContaining([["confirmation.routed", "auto"], ["order.confirmed", "auto"]])); // one transaction: same time
  });

  it("a new customer is asked (the cascade); one who refused before goes to the team; the riskiest wait for review", async () => {
    const fresh = await place(order("+201006667771"));
    expect(await state(fresh)).toMatchObject({ status: "pending_confirmation", risk_score: 30, confirm_route: "bot" });

    await place(order("+201007778881"), "returned");
    await place(order("+201007778881"), "returned");
    const refuser = await place(order("+201007778881"));
    expect(await state(refuser)).toMatchObject({ status: "pending_confirmation", risk_score: 70, confirm_route: "agent", run: { status: "needs_agent", reason: "high_risk" }, pendingSends: 0 });

    const risky = await place(order("+201008889991", { lines: [{ externalLineId: "B1", sku: "X", title: "Phone", quantity: 6, unitPrice: { amount: "1000.00", currency: "EGP" } }], shippingAddress: { line1: "x", city: "Giza", countryCode: "EG", phone: "+201008889991" } }));
    await place(order("+201008889991"), "returned");
    await place(order("+201008889991"), "returned");
    const riskier = await place(order("+201008889991", { shippingAddress: { line1: "y", city: "Giza", countryCode: "EG", phone: "+201008889991" }, lines: [{ externalLineId: "B2", sku: "X", title: "Phone", quantity: 6, unitPrice: { amount: "1000.00", currency: "EGP" } }] }));
    expect((await state(risky)).confirm_route).toBe("bot"); // 20 + 10 first + 10 short street + 10 bulk = 50
    // 20 + 50 two refusals + 10 short street + 10 bulk = 90
    expect(await state(riskier)).toMatchObject({ risk_score: 90, confirm_route: "hold", run: { status: "needs_agent", reason: "hold" } });
  });

  it("paid online: approved; an unpaid bank transfer waits", async () => {
    const paid = await place(order("+201009990001", { paymentMode: "prepaid", paymentStatus: "paid", received: { amount: "1000.00", currency: "EGP" }, outstanding: { amount: "0.00", currency: "EGP" } }));
    expect(await state(paid)).toMatchObject({ status: "confirmed", confirm_route: "auto", run: null });
    const transfer = await place(order("+201009990002", { paymentMode: "bank_transfer", paymentStatus: "unpaid" }));
    expect(await state(transfer)).toMatchObject({ status: "new", confirm_route: null, run: null });
  });
});
