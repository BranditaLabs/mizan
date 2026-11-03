import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { FakeVerifier } from "./support/fake-auth.js";

/** O4: POST /v1/orders/documents — what invoices and packing slips print, audited per order. */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
let kaftan: string;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const order = async (name: string, phone: string, payment: Record<string, unknown> = { mode: "cod" }) => (await http().post("/v1/orders").set(as("owner")).send({
  source: "phone", customer: { name, phone }, address: { line1: "12 Abbas El Akkad St", line2: "Floor 3", city: "Nasr City", province: "Cairo" },
  lines: [{ variantId: kaftan, quantity: 2 }, { title: "Gift wrap", quantity: 1, unitPrice: "25" }], shipping: "50", discount: "20", payment,
}).expect(201)).body as { id: string; number: string };

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
  kaftan = await db.tenant(store, async (trx) => {
    const p = (await trx.insertInto("products").values({ tenant_id: store, title: "Kaftan", status: "active" }).returning("id").executeTakeFirstOrThrow()).id;
    await trx.insertInto("product_images").values({ tenant_id: store, product_id: p, url: "https://cdn.shopify.com/kaftan.jpg", position: 0, is_main: true }).execute();
    return (await trx.insertInto("variants").values({ tenant_id: store, product_id: p, sku: "KAF-1", barcode: "6221234567890", currency: "EGP", price_minor: 60000 }).returning("id").executeTakeFirstOrThrow()).id;
  });
});
afterAll(() => app.close());

describe("invoices and packing slips (O4)", () => {
  it("prints the orders in the order asked, with the contact, lines, money and cash to collect; each view audited", async () => {
    const a = await order("Mona Adel", "01001234821");
    const b = await order("Karim Said", "01112223334", { mode: "prepaid", method: "wallet" });
    const res = await http().post("/v1/orders/documents").set(as("owner")).send({ kind: "invoice", orderIds: [b.id, a.id] }).expect(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const doc = res.body;
    expect(doc).toMatchObject({ kind: "invoice", store: { name: "Nile Abayas", country: "EG" } });
    expect(doc.orders.map((o: { number: string }) => o.number)).toEqual([b.number, a.number]);
    expect(doc.orders[1]).toMatchObject({
      customer: { name: "Mona Adel", phone: "+201001234821", address: { line1: "12 Abbas El Akkad St", line2: "Floor 3", city: "Nasr City" } },
      lines: [{ title: "Kaftan", sku: "KAF-1", barcode: "6221234567890", quantity: 2, unitPrice: { amount: "600.00" }, total: { amount: "1200.00" }, picture: null }, { title: "Gift wrap", quantity: 1 }],
      pieces: 3, subtotal: { amount: "1225.00" }, shipping: { amount: "50.00" }, discount: { amount: "20.00" }, total: { amount: "1255.00" }, cod: { amount: "1255.00" },
    });
    expect(doc.orders[0]).toMatchObject({ paymentMode: "prepaid", cod: { amount: "0.00" }, paid: { amount: "1255.00" } });
    const audit = await db.tenant(store, (trx) => trx.selectFrom("audit_log").select(["entity_id", "after"]).where("action", "=", "customer.pii_viewed").execute());
    expect(audit.map((r) => r.entity_id).sort()).toEqual([a.id, b.id].sort());
    expect(audit[0]!.after).toMatchObject({ via: "invoice" });
  });

  it("a packing slip carries the pictures; a redacted order prints without the person; out of scope is refused whole", async () => {
    const a = await order("Mona Adel", "01001234821");
    await db.tenant(store, (trx) => trx.updateTable("orders").set({ pii_redacted_at: new Date(), ship_name: null, ship_phone: null, ship_line1: null }).where("id", "=", a.id).execute());
    const slip = (await http().post("/v1/orders/documents").set(as("owner")).send({ kind: "packing_slip", orderIds: [a.id] }).expect(200)).body;
    expect(slip.orders[0]).toMatchObject({ customer: null, lines: [{ picture: { url: "https://cdn.shopify.com/kaftan.jpg" } }, { picture: null }] });

    const b = await order("Karim Said", "01112223334");
    expect((await http().post("/v1/orders/documents").set(as("agent")).send({ kind: "invoice", orderIds: [b.id] }).expect(404)).body.code).toBe("not_found");
    await http().post("/v1/orders/documents").set(as("owner")).send({ kind: "receipt", orderIds: [b.id] }).expect(422);
    await http().post("/v1/orders/documents").set(as("owner")).send({ kind: "invoice", orderIds: [] }).expect(422);
  });
});
