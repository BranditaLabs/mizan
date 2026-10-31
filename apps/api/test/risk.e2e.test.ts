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

/**
 * E6-1: each new order is scored as it arrives, from the customer's history with the store (by
 * phone), the store's average order and what the order says; reasons are codes with points and
 * never personal data; order.scored is emitted.
 */
const T = "aaaaaaaa-0000-4000-8000-0000000000e1";
let app: INestApplication;
let db: Database;
let connectionId: string;
let n = 0;

function order(phone: string, over: Partial<CanonicalOrder> = {}): CanonicalOrder {
  n++;
  const at = new Date(Date.now() - (100 - n) * 60_000).toISOString();
  return {
    connector: "shopify", externalId: `gid://shopify/Order/${9600 + n}`, number: `#${9600 + n}`, createdAt: at, updatedAt: at, currency: "EGP",
    total: { amount: "1000.00", currency: "EGP" }, paymentMode: "cod", paymentStatus: "unpaid", gateways: ["COD"],
    received: { amount: "0.00", currency: "EGP" }, outstanding: { amount: "1000.00", currency: "EGP" }, refunded: { amount: "0.00", currency: "EGP" },
    cancelled: false, customer: { name: "Mona Adel", phone },
    shippingAddress: { name: "Mona Adel", phone, line1: "12 Abbas El Akkad St", city: "Nasr City", countryCode: "EG" },
    lines: [{ externalLineId: `L${n}`, sku: `SKU-${n}`, title: `Item ${n}`, quantity: 1, unitPrice: { amount: "1000.00", currency: "EGP" } }],
    fulfillmentGroups: [], tags: [], ...over,
  };
}
async function place(o: CanonicalOrder, status?: "delivered" | "returned"): Promise<{ id: string; risk_score: number | null; risk_reasons: unknown }> {
  await app.get(OrderProjector).project(T, connectionId, o);
  await app.get(EventDispatcher).runOnce();
  return db.tenant(T, async (trx) => {
    const r = await trx.selectFrom("orders").select(["id", "risk_score", "risk_reasons"]).where("number", "=", o.number).executeTakeFirstOrThrow();
    if (status) await trx.updateTable("orders").set({ status, shipped_at: new Date() }).where("id", "=", r.id).execute();
    return r;
  });
}
const codes = (r: unknown) => (r as Array<{ code: string }>).map((x) => x.code);

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }) });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null);
  await db.kysely.insertInto("tenants").values({ id: T, name: "Nile Risk", slug: "nile-risk", settings: JSON.stringify({ phoneCountry: "EG" }) }).execute();
  connectionId = await db.tenant(T, async (trx) => (await trx.insertInto("connections").values({ tenant_id: T, kind: "store", provider: "shopify", external_account: "risk.myshopify.com" }).returning("id").executeTakeFirstOrThrow()).id);
});
afterAll(() => app.close());

describe("risk score on arrival (E6-1)", () => {
  it("a first-time cash customer: medium, because they are new", async () => {
    const r = await place(order("+201001112221"));
    expect(r.risk_score).toBe(30);
    expect(r.risk_reasons).toEqual([{ code: "first_order", points: 10 }]);
    const ev = await db.tenant(T, (trx) => trx.selectFrom("domain_events").select("data").where("type", "=", "order.scored").where("entity_id", "=", r.id).executeTakeFirstOrThrow());
    expect(ev.data).toMatchObject({ score: 30, band: "medium", reasons: ["first_order"] });
    expect(JSON.stringify(ev.data)).not.toMatch(/Mona|1112221|Abbas/);
  });

  it("a customer who received before is trusted; one who refused before is not", async () => {
    for (let i = 0; i < 3; i++) await place(order("+201002223331"), "delivered");
    const trusted = await place(order("01002223331")); // the same phone, written another way
    expect(trusted.risk_score).toBe(0);
    expect(codes(trusted.risk_reasons)).toEqual(["delivered_before"]);

    await place(order("+201003334441"), "returned");
    await place(order("+201003334441"), "returned");
    const refuser = await place(order("+201003334441"));
    expect(refuser.risk_score).toBe(70);
    expect(codes(refuser.risk_reasons)[0]).toBe("refused_before");
  });

  it("what the order itself says: an unknown phone, no street, far above the store's average", async () => {
    const r = await place(order("12345", { total: { amount: "9000.00", currency: "EGP" }, shippingAddress: { line1: "x", city: "Giza", countryCode: "EG", phone: "12345" } }));
    expect(codes(r.risk_reasons)).toEqual(["phone_invalid", "very_high_value", "first_order"]); // address_incomplete (+10) ties first_order and counts in the score
    expect(r.risk_score).toBe(85);
  });

  it("paid by card: fraud signals, not refusal", async () => {
    const r = await place(order("+201004445551", { paymentMode: "prepaid", paymentStatus: "paid", received: { amount: "1000.00", currency: "EGP" }, outstanding: { amount: "0.00", currency: "EGP" } }));
    expect(r.risk_score).toBe(10);
    expect(r.risk_reasons).toEqual([]);
  });
});
