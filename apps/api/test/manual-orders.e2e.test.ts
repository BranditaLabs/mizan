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
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E5-5: an order taken on the phone is entered by hand and from then on is an order like any
 * other: numbered per store, personal data encrypted, lines linked to the catalogue (so profit has
 * their cost), the deposit in the payments ledger, scored, and confirmation starts.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
let abaya: string;
let archived: string;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
const body = (over: Record<string, unknown> = {}) => ({
  source: "phone", customer: { name: "Mona Adel", phone: "01001234821" }, address: { line1: "12 Abbas El Akkad St", city: "Nasr City" },
  lines: [{ variantId: abaya, quantity: 2 }], shipping: "50", payment: { mode: "cod" }, ...over,
});

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null);
  fake.add("owner", { uid: "fb-owner-manual", email: "owner@manual.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Phone Orders", country: "EG" }).expect(201)).body.id;
  const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone: "01201114444", role: "agent" }).expect(201);
  fake.add("agent", { uid: "fb-agent-manual", phone: inv.body.phone });
  await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: "Bearer agent" }).expect(200);
  fake.add("finance", { uid: "fb-fin-manual", email: "fin@manual.test", emailVerified: true });
  ({ abaya, archived } = await db.tenant(store, async (trx) => {
    const p = (await trx.insertInto("products").values({ tenant_id: store, title: "Abaya" }).returning("id").executeTakeFirstOrThrow()).id;
    const a = (await trx.insertInto("variants").values({ tenant_id: store, product_id: p, sku: "AB-1", title: "Black / L", currency: "EGP", price_minor: 125000, cogs_minor: 50000, cogs_set_at: new Date() }).returning("id").executeTakeFirstOrThrow()).id;
    const old = (await trx.insertInto("products").values({ tenant_id: store, title: "Old scarf", status: "archived" }).returning("id").executeTakeFirstOrThrow()).id;
    const x = (await trx.insertInto("variants").values({ tenant_id: store, product_id: old, sku: "SC-0", currency: "EGP", price_minor: 9000 }).returning("id").executeTakeFirstOrThrow()).id;
    return { abaya: a, archived: x };
  }));
});
afterAll(() => app.close());

describe("manual orders (E5-5)", () => {
  it("the team picks products and enters the order; it is an order like any other", async () => {
    const products = await http().get("/v1/orders/products?q=aba").set(as("agent")).expect(200);
    expect(products.body.data).toEqual([{ variantId: abaya, sku: "AB-1", title: "Abaya — Black / L", price: { amount: "1250.00", currency: "EGP" }, available: null }]);

    const r = await http().post("/v1/orders").set(as("owner")).send(body({ lines: [{ variantId: abaya, quantity: 2 }, { title: "Gift wrap", quantity: 1, unitPrice: "25" }] })).expect(201);
    expect(r.body).toEqual({ id: expect.any(String), number: "M-1001", status: expect.stringMatching(/new|pending_confirmation/) });
    await drain();

    const o = await db.tenant(store, (trx) => trx.selectFrom("orders").select(["channel", "connection_id", "total_minor", "cod_minor", "payment_mode", "status", "risk_score", "ship_line1", "phone_last4", "tags", "assigned_to"]).where("id", "=", r.body.id).executeTakeFirstOrThrow());
    expect(o).toMatchObject({ channel: "manual", connection_id: null, total_minor: 257500n, cod_minor: 257500n, payment_mode: "cod", status: "pending_confirmation", risk_score: 30, phone_last4: "4821", tags: ["source:phone"], assigned_to: null });
    expect(String(o.ship_line1)).not.toContain("Abbas"); // encrypted
    const lines = await db.tenant(store, (trx) => trx.selectFrom("order_lines").select(["title", "variant_id", "quantity"]).where("order_id", "=", r.body.id).orderBy("external_line_id").execute());
    expect(lines).toEqual([{ title: "Abaya — Black / L", variant_id: abaya, quantity: 2 }, { title: "Gift wrap", variant_id: null, quantity: 1 }]);
    const ev = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select(["type", "actor"]).where("entity_id", "=", r.body.id).where("type", "in", ["order.created", "order.scored"]).orderBy("occurred_at").execute());
    expect(ev.map((e) => e.type)).toEqual(expect.arrayContaining(["order.created", "order.scored"]));
    expect(ev.find((e) => e.type === "order.created")!.actor).toMatchObject({ type: "user" });
    expect(await db.tenant(store, (trx) => trx.selectFrom("confirmation_runs").select("status").where("order_id", "=", r.body.id).executeTakeFirst())).toBeTruthy();
    const audit = await db.tenant(store, (trx) => trx.selectFrom("audit_log").select(["action", "after"]).where("entity_id", "=", r.body.id).execute());
    expect(audit).toEqual([{ action: "order.created_manually", after: expect.objectContaining({ number: "M-1001", source: "phone", paymentMode: "cod", total: "2575.00" }) }]);
    expect(JSON.stringify(audit)).not.toMatch(/Mona|4821|Abbas/);

    const detail = await http().get(`/v1/orders/${r.body.id}`).set(as("owner")).expect(200);
    expect(detail.body).toMatchObject({ number: "M-1001", channel: "manual", cod: { amount: "2575.00" } });
  });

  it("an agent's order is theirs; a deposit is in the ledger and the courier collects the rest; numbers go up", async () => {
    const r = await http().post("/v1/orders").set(as("agent")).send(body({ source: "whatsapp", customer: { name: "Ahmed Samir", phone: "+201112223334" }, payment: { mode: "partial", method: "instapay", paid: "500" } })).expect(201);
    expect(r.body.number).toBe("M-1002");
    await drain();
    const o = await db.tenant(store, (trx) => trx.selectFrom("orders").select(["paid_minor", "cod_minor", "payment_status", "assigned_to"]).where("id", "=", r.body.id).executeTakeFirstOrThrow());
    expect(o).toMatchObject({ paid_minor: 50000n, cod_minor: 205000n, payment_status: "partially_paid" });
    expect(o.assigned_to).toBeTruthy();
    const pay = await db.tenant(store, (trx) => trx.selectFrom("payments").select(["method", "kind", "amount_minor"]).where("order_id", "=", r.body.id).execute());
    expect(pay).toEqual([{ method: "instapay", kind: "sale", amount_minor: 50000n }]);
    await http().get(`/v1/orders/${r.body.id}`).set(as("agent")).expect(200); // agents see orders assigned to them
  });

  it("refuses what cannot be an order, with a reason", async () => {
    const code = async (b: object, status = 422) => (await http().post("/v1/orders").set(as("owner")).send(b).expect(status)).body.code;
    expect(await code(body({ customer: { name: "Mona Adel", phone: "123456" } }))).toBe("phone_invalid");
    expect(await code(body({ lines: [{ variantId: archived, quantity: 1 }] }))).toBe("unknown_product");
    expect(await code(body({ discount: "9999" }))).toBe("total_invalid");
    expect(await code(body({ payment: { mode: "cod", paid: "100" } }))).toBe("paid_invalid");
    expect(await code(body({ lines: [{ title: "No price", quantity: 1 }] }))).toBe("validation_failed");
    expect(await code(body({ lines: [] }))).toBe("validation_failed");
    fake.add("fin2", { uid: "fb-fin-manual-2", email: "fin2@manual.test", emailVerified: true });
    await http().post("/v1/orders").set(as("fin2")).send(body()).expect(403); // not a member, or not allowed
    const n = await db.tenant(store, (trx) => trx.selectFrom("orders").select((eb) => eb.fn.countAll<string>().as("n")).where("channel", "=", "manual").executeTakeFirstOrThrow());
    expect(Number(n.n)).toBe(2); // nothing half-made
  });
});
