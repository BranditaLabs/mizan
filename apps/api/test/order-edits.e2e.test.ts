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
import { OrderEditsService } from "../src/modules/orders/order-edits.service.js";
import { FakeVerifier } from "./support/fake-auth.js";

/** O3: PATCH /v1/orders/{id} — a manual order changes now; a store order's edit goes to the store and settles from its answer. */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
let shopify: string;
let scarf: string;
let kaftan: string;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
const detail = async (id: string) => (await http().get(`/v1/orders/${id}`).set(as("owner")).expect(200)).body;
const manual = async (over: Record<string, unknown> = {}) => (await http().post("/v1/orders").set(as("owner")).send({
  source: "phone", customer: { name: "Mona Adel", phone: "01001234821" }, address: { line1: "12 Abbas El Akkad St", city: "Nasr City" },
  lines: [{ variantId: kaftan, quantity: 2 }, { title: "Gift wrap", quantity: 1, unitPrice: "25" }], shipping: "50", payment: { mode: "cod" }, ...over,
}).expect(201)).body as { id: string; number: string };

const storeOrder = (n: number, over: Partial<CanonicalOrder> = {}): CanonicalOrder => ({
  connector: "shopify", externalId: `gid://shopify/Order/${8000 + n}`, number: `#${8000 + n}`,
  createdAt: "2026-10-22T10:00:00.000Z", updatedAt: "2026-10-22T10:00:00.000Z", currency: "EGP",
  total: { amount: "1250.00", currency: "EGP" }, subtotal: { amount: "1200.00", currency: "EGP" }, shipping: { amount: "50.00", currency: "EGP" },
  paymentMode: "cod", paymentStatus: "unpaid", gateways: ["Cash on Delivery (COD)"],
  received: { amount: "0.00", currency: "EGP" }, outstanding: { amount: "1250.00", currency: "EGP" }, refunded: { amount: "0.00", currency: "EGP" }, cancelled: false,
  customer: { name: "Karim Said", phone: "+201112223334" },
  shippingAddress: { name: "Karim Said", phone: "01112223334", line1: "5 Tahrir St", city: "Giza", countryCode: "EG" },
  lines: [{ externalLineId: `gid://shopify/LineItem/${8000 + n}1`, variantExternalId: "gid://shopify/ProductVariant/71", sku: "KAF-1", title: "Kaftan", quantity: 2, unitPrice: { amount: "600.00", currency: "EGP" } }],
  fulfillmentGroups: [], tags: [], ...over,
});

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "http://localhost:3000" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  fake.add("owner", { uid: "fb-owner", email: "owner@nile.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Abayas", country: "EG" }).expect(201)).body.id;
  const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone: "01201112222", role: "agent" }).expect(201);
  fake.add("agent", { uid: "fb-agent", phone: inv.body.phone });
  await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: "Bearer agent" }).expect(200);

  const secrets = app.get(SecretsService);
  await db.tenant(store, async (trx) => {
    const ref = await secrets.create(trx, store, JSON.stringify({ accessToken: "fake" }), { actor: { type: "system" } });
    shopify = (await trx.insertInto("connections").values({ tenant_id: store, kind: "store", provider: "shopify", external_account: "nile.myshopify.com", secret_ref: ref }).returning("id").executeTakeFirstOrThrow()).id;
    const product = async (title: string, sku: string, price: number, ext: string | null) => {
      const p = (await trx.insertInto("products").values({ tenant_id: store, title, status: "active" }).returning("id").executeTakeFirstOrThrow()).id;
      const v = (await trx.insertInto("variants").values({ tenant_id: store, product_id: p, sku, currency: "EGP", price_minor: price }).returning("id").executeTakeFirstOrThrow()).id;
      if (ext) await trx.insertInto("external_variants").values({ tenant_id: store, connection_id: shopify, external_id: ext, variant_id: v }).execute();
      return v;
    };
    kaftan = await product("Kaftan", "KAF-1", 60000, "gid://shopify/ProductVariant/71");
    scarf = await product("Scarf", "SCF-1", 15000, "gid://shopify/ProductVariant/72");
    await product("Belt", "BLT-1", 9000, null); // in Mizan only
  });
});
afterAll(() => app.close());

describe("editing a manual order (O3)", () => {
  it("changes quantity and price, adds an item, sets the fee and the address; totals, cash to collect and the timeline follow", async () => {
    const o = await manual();
    const before = await detail(o.id);
    const [kaf, wrap] = before.lines;
    const res = await http().patch(`/v1/orders/${o.id}`).set(as("owner")).send({
      lines: [{ lineId: kaf.id, quantity: 1, unitPrice: "550" }, { lineId: wrap.id, quantity: 0 }],
      add: [{ variantId: scarf, quantity: 2 }], shipping: "60", address: { line1: "9 Nile St", city: "Giza" },
    }).expect(200);
    expect(res.body).toMatchObject({ status: "applied", editId: expect.any(String) });
    await drain();

    const after = await detail(o.id);
    expect(after.lines.map((l: { title: string; quantity: number; unitPrice: { amount: string } }) => [l.title, l.quantity, l.unitPrice.amount]))
      .toEqual([["Kaftan", 1, "550.00"], ["Scarf", 2, "150.00"]]);
    expect(after).toMatchObject({ subtotal: { amount: "850.00" }, shipping: { amount: "60.00" }, total: { amount: "910.00" }, cod: { amount: "910.00" }, area: { city: "Giza" }, edit: { status: "applied" } });
    expect(after.lines[1].productId).toBeTruthy(); // the added item is linked to the catalogue
    expect(after.events.map((e: { type: string }) => e.type)).toContain("edited");
    const revealed = (await http().post(`/v1/orders/${o.id}/reveal`).set(as("owner")).expect(200)).body;
    expect(revealed).toMatchObject({ name: "Mona Adel", phone: "+201001234821", address: { line1: "9 Nile St", city: "Giza" } });
    const audit = await db.tenant(store, (trx) => trx.selectFrom("audit_log").select("after").where("action", "=", "order.edited").execute());
    expect(audit).toHaveLength(1);
  });

  it("adding a product already on the order adds to its line; the profit and stock consumers see order.edited", async () => {
    const o = await manual();
    await http().patch(`/v1/orders/${o.id}`).set(as("owner")).send({ add: [{ variantId: kaftan, quantity: 1 }] }).expect(200);
    const after = await detail(o.id);
    expect(after.lines.map((l: { title: string; quantity: number }) => [l.title, l.quantity])).toEqual([["Kaftan", 3], ["Gift wrap", 1]]);
    const events = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select("type").where("entity_id", "=", o.id).where("type", "=", "order.edited").execute());
    expect(events).toHaveLength(1);
  });

  it("refuses what cannot be: nothing left, no change, a paid order going up, below what was paid, with the courier, out of scope", async () => {
    const o = await manual();
    const lines = (await detail(o.id)).lines as Array<{ id: string }>;
    const code = async (id: string, body: unknown, status: number, token = "owner") => (await http().patch(`/v1/orders/${id}`).set(as(token)).send(body).expect(status)).body.code;
    expect(await code(o.id, { lines: lines.map((l) => ({ lineId: l.id, quantity: 0 })) }, 422)).toBe("no_items");
    expect(await code(o.id, { shipping: "50" }, 422)).toBe("no_change");
    expect(await code(o.id, {}, 422)).toBe("validation_failed");
    expect(await code(o.id, { lines: [{ lineId: "00000000-0000-4000-8000-000000000000", quantity: 1 }] }, 422)).toBe("unknown_line");
    expect(await code(o.id, { shipping: "10" }, 404, "agent")).toBe("not_found"); // not assigned to the agent

    const paid = await manual({ payment: { mode: "prepaid", method: "wallet" } });
    expect(await code(paid.id, { shipping: "80" }, 409)).toBe("paid_order");
    expect(await code(paid.id, { shipping: "0" }, 409)).toBe("refund_first");
    const deposit = await manual({ payment: { mode: "partial", method: "wallet", paid: "1000" } });
    expect(await code(deposit.id, { add: [], lines: [{ lineId: (await detail(deposit.id)).lines[0].id, quantity: 1 }] }, 409)).toBe("refund_first");

    const away = await manual();
    await db.tenant(store, (trx) => trx.updateTable("orders").set({ status: "shipped" }).where("id", "=", away.id).execute());
    expect(await code(away.id, { shipping: "10" }, 409)).toBe("not_editable");
  });
});

describe("editing a Shopify order (O3)", () => {
  it("goes to the store through the outbox (ids only), one at a time; settles from the store's answer", async () => {
    const projector = app.get(OrderProjector);
    const { orderId } = await projector.project(store, shopify, storeOrder(1));
    const line = (await detail(orderId)).lines[0];

    const code = async (body: unknown, status: number) => (await http().patch(`/v1/orders/${orderId}`).set(as("owner")).send(body).expect(status)).body;
    expect((await code({ lines: [{ lineId: line.id, quantity: 2, unitPrice: "500" }] }, 422)).code).toBe("price_in_store");
    const belt = (await db.tenant(store, (trx) => trx.selectFrom("variants").select("id").where("sku", "=", "BLT-1").executeTakeFirstOrThrow())).id;
    expect((await code({ add: [{ variantId: belt, quantity: 1 }] }, 422)).code).toBe("not_in_store");

    const sent = await code({ lines: [{ lineId: line.id, quantity: 1 }], add: [{ variantId: scarf, quantity: 1 }], shipping: "60", address: { line1: "9 Nile St", city: "Cairo" } }, 202);
    expect(sent).toMatchObject({ status: "sending" });
    expect((await code({ shipping: "70" }, 409)).code).toBe("edit_in_progress");
    expect((await detail(orderId)).edit).toMatchObject({ id: sent.editId, status: "sending" });

    const jobs = await db.tenant(store, (trx) => trx.selectFrom("mz_outbox").select(["kind", "payload"]).where("kind", "=", "shopify.editOrder").execute());
    expect(jobs).toEqual([{ kind: "shopify.editOrder", payload: { editId: sent.editId } }]);
    const stored = await db.tenant(store, (trx) => trx.selectFrom("order_edits").select(["changes", "address"]).where("id", "=", sent.editId).executeTakeFirstOrThrow());
    expect(JSON.stringify(stored.changes)).not.toMatch(/Nile|Cairo|Karim/);
    expect(stored.address).toMatch(/^pii:v1:/);

    // The engine reads it in the store's terms when the job runs.
    const edits = app.get(OrderEditsService);
    expect(await edits.loadPlan(store, sent.editId)).toEqual({
      editId: sent.editId, orderId: "gid://shopify/Order/8001", currency: "EGP",
      lines: [{ lineId: "gid://shopify/LineItem/80011", variantId: "gid://shopify/ProductVariant/71", quantity: 1, unitPrice: undefined }],
      add: [{ variantId: "gid://shopify/ProductVariant/72", quantity: 1, unitPrice: undefined }], shipping: "60",
      address: { line1: "9 Nile St", line2: undefined, city: "Cairo", province: undefined, name: "Karim Said", phone: "+201112223334", countryCode: "EG" },
    });

    // The store's answer settles it once; the address it carried goes.
    await edits.recordResult(store, sent.editId, { ok: true, outcome: "applied" });
    await edits.recordResult(store, sent.editId, { ok: false, reason: "failed", message: "late repeat" });
    const settled = await db.tenant(store, (trx) => trx.selectFrom("order_edits").select(["status", "address", "failure"]).where("id", "=", sent.editId).executeTakeFirstOrThrow());
    expect(settled).toEqual({ status: "applied", address: null, failure: null });
    expect(await edits.loadPlan(store, sent.editId)).toBeUndefined();
    const after = await detail(orderId);
    expect(after.edit).toMatchObject({ status: "applied" });
    expect(after.events.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(["edit_requested", "edited"]));
  });

  it("a refusal is kept with the store's words, and the order can be edited again", async () => {
    const { orderId } = await app.get(OrderProjector).project(store, shopify, storeOrder(2));
    const sent = (await http().patch(`/v1/orders/${orderId}`).set(as("owner")).send({ shipping: "75" }).expect(202)).body;
    await app.get(OrderEditsService).recordResult(store, sent.editId, { ok: false, reason: "validation", message: "Order is archived" });
    expect((await detail(orderId)).edit).toMatchObject({ status: "failed", failure: "validation", message: "Order is archived" });
    await http().patch(`/v1/orders/${orderId}`).set(as("owner")).send({ shipping: "80" }).expect(202);
  });
});
