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
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E5-3: a customer who orders the same product again within the store's window gets a likely
 * duplicate, held from confirmation (no second message) until the team keeps it (confirmation
 * starts) or merges it into the first (cancelled here, tagged mizan-duplicate in Shopify).
 */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
let connectionId: string;
let n = 0;
const MIN = 60_000;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };

async function placed(minutesAgo: number, over: Partial<CanonicalOrder> = {}, line: Partial<CanonicalOrder["lines"][number]> = {}): Promise<string> {
  n++;
  const at = new Date(Date.now() - minutesAgo * MIN).toISOString();
  const o: CanonicalOrder = {
    connector: "shopify", externalId: `gid://shopify/Order/${9300 + n}`, number: `#${9300 + n}`, createdAt: at, updatedAt: at, currency: "EGP",
    total: { amount: "1150.00", currency: "EGP" }, paymentMode: "cod", paymentStatus: "unpaid", gateways: ["COD"],
    received: { amount: "0.00", currency: "EGP" }, outstanding: { amount: "1150.00", currency: "EGP" }, refunded: { amount: "0.00", currency: "EGP" },
    cancelled: false, customer: { name: "Mona Adel", phone: "+201001234821" },
    shippingAddress: { name: "Mona Adel", phone: "01001234821", line1: "12 Abbas El Akkad St", city: "Nasr City", countryCode: "EG" },
    lines: [{ externalLineId: `L${n}`, sku: "SER-30", title: "Vitamin C serum", quantity: 1, unitPrice: { amount: "1150.00", currency: "EGP" }, ...line }],
    fulfillmentGroups: [], tags: [], ...over,
  };
  await app.get(OrderProjector).project(store, connectionId, o);
  await drain();
  return (await db.tenant(store, (trx) => trx.selectFrom("orders").select("id").where("number", "=", o.number).executeTakeFirstOrThrow())).id;
}
const row = (id: string) => db.tenant(store, (trx) => trx.selectFrom("orders").select(["status", "duplicate_of", "duplicate_status", "duplicate_reason"]).where("id", "=", id).executeTakeFirstOrThrow());
const runs = (id: string) => db.tenant(store, (trx) => trx.selectFrom("confirmation_runs").select("status").where("order_id", "=", id).execute());
const detail = async (id: string) => (await http().get(`/v1/orders/${id}`).set(as("owner")).expect(200)).body;

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null);
  fake.add("owner", { uid: "fb-owner-dup", email: "owner@dup.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Dupes", country: "EG" }).expect(201)).body.id;
  connectionId = await db.tenant(store, async (trx) => {
    const ref = await app.get(SecretsService).create(trx, store, JSON.stringify({ accessToken: "shpat_fake_token" }), { actor: { type: "system" } });
    return (await trx.insertInto("connections").values({ tenant_id: store, kind: "store", provider: "shopify", external_account: "nile-dupes.myshopify.com", secret_ref: ref }).returning("id").executeTakeFirstOrThrow()).id;
  });
  const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone: "01201113333", role: "agent" }).expect(201);
  fake.add("agent", { uid: "fb-agent-dup", phone: inv.body.phone });
  await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: "Bearer agent" }).expect(200);
});
afterAll(() => app.close());

describe("likely duplicate orders (E5-3)", () => {
  let first: string;
  let again: string;

  it("the same customer and product within 48 h: held as a likely duplicate of the first, no second confirmation", async () => {
    first = await placed(90);
    again = await placed(10, {}, { sku: "SER-30", title: "Vitamin C serum" });
    expect(await row(first)).toMatchObject({ duplicate_status: null });
    expect(await row(again)).toMatchObject({ duplicate_of: first, duplicate_status: "suspected", status: "new", duplicate_reason: { items: ["Vitamin C serum"], minutesApart: 80, windowHours: 48 } });
    expect(await runs(first)).toHaveLength(1);
    expect(await runs(again)).toHaveLength(0);
    const ev = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select(["type", "data"]).where("entity_id", "=", again).where("type", "=", "order.duplicate_found").execute());
    expect(ev).toHaveLength(1);
    expect(JSON.stringify(ev[0]!.data)).not.toMatch(/Mona|4821/);

    const list = (await http().get("/v1/orders?duplicate=suspected").set(as("owner")).expect(200)).body;
    expect(list.duplicates).toBe(1);
    expect(list.data.map((o: { id: string; duplicate: string }) => [o.id, o.duplicate])).toEqual([[again, "suspected"]]);
    const d = await detail(again);
    expect(d.duplicateOf).toMatchObject({ id: first, status: "pending_confirmation", items: ["Vitamin C serum"], minutesApart: 80 });
    expect(d.events.find((e: { type: string }) => e.type === "duplicate_found").data).toMatchObject({ of: expect.stringMatching(/^#/) });
  });

  it("a different product, another customer, or outside the window is not a duplicate", async () => {
    const other = await placed(5, {}, { sku: "SUN-50", title: "Sunscreen", externalLineId: "X1" });
    const stranger = await placed(5, { customer: { name: "Karim", phone: "+201112223333" }, shippingAddress: { line1: "1 St", city: "Giza", countryCode: "EG", phone: "01112223333" } });
    const late = await placed(3 * 24 * 60 + 5);
    const after = await placed(1, {}, {});
    expect((await row(other)).duplicate_status).toBeNull();
    expect((await row(stranger)).duplicate_status).toBeNull();
    expect((await row(late)).duplicate_status).toBeNull();
    // An order three days earlier is outside the window: the newest one points at the first within it.
    expect(await row(after)).toMatchObject({ duplicate_status: "suspected", duplicate_of: first });
    await http().post(`/v1/orders/${after}/duplicate`).set(as("owner")).send({ action: "keep" }).expect(200);
  });

  it("keep: both are real orders, confirmation starts; the answer stands", async () => {
    expect((await http().post(`/v1/orders/${again}/duplicate`).set(as("agent")).send({ action: "keep" }).expect(404)).body.code).toBe("not_found"); // not assigned to the agent
    expect((await http().post(`/v1/orders/${again}/duplicate`).set(as("owner")).send({ action: "keep" }).expect(200)).body).toEqual({ status: "kept" });
    await drain();
    expect(await row(again)).toMatchObject({ duplicate_status: "kept" });
    expect(await runs(again)).toHaveLength(1);
    expect((await http().post(`/v1/orders/${again}/duplicate`).set(as("owner")).send({ action: "merge" }).expect(200)).body).toEqual({ status: "kept" });
    expect((await http().post(`/v1/orders/${first}/duplicate`).set(as("owner")).send({ action: "keep" }).expect(409)).body.code).toBe("not_a_duplicate");
  });

  it("merge: cancelled as a duplicate of the earlier, confirmation stopped, tagged in Shopify, audited", async () => {
    await http().put("/v1/settings/orders").set(as("owner")).send({ duplicateWindowHours: 2 }).expect(200);
    expect((await http().get("/v1/settings/orders").set(as("owner")).expect(200)).body).toEqual({ duplicateWindowHours: 2 });
    const one = await placed(30, {}, { sku: "OIL-1", title: "Argan oil" });
    const two = await placed(20, {}, { sku: "OIL-1", title: "Argan oil" });
    expect(await row(two)).toMatchObject({ duplicate_status: "suspected", duplicate_of: one });
    expect((await http().post(`/v1/orders/${two}/duplicate`).set(as("owner")).send({ action: "merge" }).expect(200)).body).toEqual({ status: "merged" });
    await drain();
    expect(await row(two)).toMatchObject({ status: "cancelled", duplicate_status: "merged" });
    expect((await row(one)).status).toBe("pending_confirmation");
    const job = await db.tenant(store, (trx) => trx.selectFrom("mz_outbox").select(["kind", "payload"]).where("kind", "=", "shopify.addTags").execute());
    expect(job).toEqual([expect.objectContaining({ payload: { id: expect.stringMatching(/Order\//), tags: ["mizan-duplicate"] } })]);
    const audit = await db.tenant(store, (trx) => trx.selectFrom("audit_log").select("action").where("action", "=", "order.duplicate_resolved").execute());
    expect(audit.length).toBeGreaterThanOrEqual(2);
    const d = await detail(two);
    expect(d.events[0]).toMatchObject({ type: "duplicate_merged", toStatus: "cancelled", data: { into: expect.stringMatching(/^#/), reason: "duplicate" } });
    await http().put("/v1/settings/orders").set(as("owner")).send({ duplicateWindowHours: 200 }).expect(422);
  });
});
