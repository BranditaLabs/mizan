import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import type { CanonicalOrder } from "@mizan/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { SecretsService } from "../src/platform/secrets/secrets.service.js";
import { OrderProjector, REDACTED_ORDER } from "../src/modules/orders/order-projector.js";
import { FakeVerifier } from "./support/fake-auth.js";

/** E5-2: GET /v1/orders/{id} (masked) and POST /v1/orders/{id}/reveal (decrypted, audited, scoped). */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
const ids: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });

const order = (n: number, over: Partial<CanonicalOrder> = {}): CanonicalOrder => ({
  connector: "shopify", externalId: `gid://shopify/Order/${7000 + n}`, number: `#${7000 + n}`,
  createdAt: new Date(Date.UTC(2026, 9, 21, 9, n)).toISOString(), updatedAt: new Date(Date.UTC(2026, 9, 21, 9, n)).toISOString(), currency: "EGP",
  total: { amount: "1250.00", currency: "EGP" }, subtotal: { amount: "1200.00", currency: "EGP" }, shipping: { amount: "50.00", currency: "EGP" },
  paymentMode: "cod", paymentStatus: "unpaid", gateways: ["Cash on Delivery (COD)"],
  received: { amount: "0.00", currency: "EGP" }, outstanding: { amount: "1250.00", currency: "EGP" }, refunded: { amount: "0.00", currency: "EGP" },
  cancelled: false,
  customer: { name: "Mona Adel", phone: "+201001234821", email: "mona@example.com" },
  shippingAddress: { name: "Mona Adel", phone: "010 0123 4821", line1: "12 Abbas El Akkad St", line2: "Floor 3", city: "Nasr City", province: "Cairo", countryCode: "EG" },
  lines: [
    { externalLineId: `L${n}a`, sku: "AB-1", title: "Abaya", quantity: 2, unitPrice: { amount: "500.00", currency: "EGP" } },
    { externalLineId: `L${n}b`, sku: "SC-2", title: "Scarf", quantity: 1, unitPrice: { amount: "200.00", currency: "EGP" } },
  ],
  fulfillmentGroups: [], tags: ["vip"],
  ...over,
});

const auditRows = () => db.tenant(store, (trx) => trx.selectFrom("audit_log").select(["action", "actor_id", "entity_id", "after"]).where("action", "=", "customer.pii_viewed").execute());

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "http://localhost:3000" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  fake.add("owner", { uid: "fb-owner", email: "owner@nile.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Abayas", country: "EG" }).expect(201)).body.id;
  const connectionId = await db.tenant(store, async (trx) => {
    const ref = await app.get(SecretsService).create(trx, store, JSON.stringify({ accessToken: "shpat_fake_token" }), { actor: { type: "system" } });
    return (await trx.insertInto("connections").values({ tenant_id: store, kind: "store", provider: "shopify", external_account: "nile.myshopify.com", secret_ref: ref }).returning("id").executeTakeFirstOrThrow()).id;
  });
  const projector = app.get(OrderProjector);
  await projector.project(store, connectionId, order(1));
  // The customer pays on the store later: a payment_changed event and a ledger line.
  await projector.project(store, connectionId, order(1, {
    updatedAt: new Date(Date.UTC(2026, 9, 21, 10, 0)).toISOString(), paymentMode: "prepaid", paymentStatus: "paid", gateways: ["paymob"],
    received: { amount: "1250.00", currency: "EGP" }, outstanding: { amount: "0.00", currency: "EGP" },
  }));
  await projector.project(store, connectionId, order(2));
  await projector.project(store, connectionId, order(3));
  for (const n of [1, 2, 3]) {
    ids[n] = (await db.tenant(store, (trx) => trx.selectFrom("orders").select("id").where("number", "=", `#${7000 + n}`).executeTakeFirstOrThrow())).id;
  }
  await db.tenant(store, async (trx) => {
    await trx.updateTable("orders").set({ ship_lat: 30.0561, ship_lng: 31.3301, risk_score: 64, risk_reasons: JSON.stringify(["new_customer", { code: "high_value" }]) }).where("id", "=", ids[1]!).execute();
    await trx.updateTable("orders").set({ ...REDACTED_ORDER, pii_redacted_at: new Date() }).where("id", "=", ids[3]!).execute();
  });

  const join = async (token: string, phone: string, role: string) => {
    const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone, role }).expect(201);
    fake.add(token, { uid: `fb-${token}`, phone: inv.body.phone });
    await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: `Bearer ${token}` }).expect(200);
  };
  await join("agent", "01201112222", "agent");
  await join("finance", "01201115555", "finance");
  const agentId = (await db.kysely.selectFrom("users").select("id").where("firebase_uid", "=", "fb-agent").executeTakeFirstOrThrow()).id;
  await db.tenant(store, (trx) => trx.updateTable("orders").set({ assigned_to: agentId }).where("id", "=", ids[2]!).execute());
});
afterAll(() => app.close());

describe("GET /v1/orders/{id}", () => {
  it("returns lines, money, payments and a newest-first timeline with the customer still masked", async () => {
    const { body } = await http().get(`/v1/orders/${ids[1]}`).set(as("owner")).expect(200);
    expect(body).toMatchObject({
      number: "#7001", status: "new", store: { provider: "shopify" }, customer: { label: "Mona A.", phoneLast4: "4821" },
      total: { amount: "1250.00" }, subtotal: { amount: "1200.00" }, shipping: { amount: "50.00" }, paid: { amount: "1250.00" }, balance: { amount: "0.00" },
      paymentMode: "prepaid", paymentStatus: "paid", cod: { amount: "0.00" },
      area: { city: "Nasr City", province: "Cairo", country: "EG" }, hasLocation: true, redacted: false,
      risk: 64, riskReasons: ["new_customer", "high_value"], tags: ["vip"], shipments: [],
    });
    expect(body.lines.map((l: { sku: string; quantity: number; total: { amount: string } }) => [l.sku, l.quantity, l.total.amount]))
      .toEqual(expect.arrayContaining([["AB-1", 2, "1000.00"], ["SC-2", 1, "200.00"]]));
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0]).toMatchObject({ kind: "sale", status: "succeeded", amount: { amount: "1250.00", currency: "EGP" } });
    expect(body.events[0].type).not.toBe("created");
    expect(body.events.at(-1)).toMatchObject({ type: "created", actorType: "system" });
    const times = body.events.map((e: { at: string }) => e.at);
    expect([...times].sort().reverse()).toEqual(times);
    // Nothing personal beyond the label, last four digits and the area.
    expect(JSON.stringify(body)).not.toMatch(/Mona Adel|Adel|Abbas|Floor|0123|mona@|\+2010|30\.05|31\.33/);
  });

  it("is not found outside the caller's scope or store, and for unknown or malformed ids", async () => {
    expect((await http().get(`/v1/orders/${ids[1]}`).set(as("agent")).expect(404)).body.code).toBe("not_found");
    await http().get(`/v1/orders/${ids[2]}`).set(as("agent")).expect(200);
    await http().get("/v1/orders/00000000-0000-4000-8000-000000000000").set(as("owner")).expect(404);
    await http().get("/v1/orders/nope").set(as("owner")).expect(400);
  });

  it("marks a redacted order", async () => {
    const { body } = await http().get(`/v1/orders/${ids[3]}`).set(as("owner")).expect(200);
    expect(body).toMatchObject({ redacted: true, customer: { label: null, phoneLast4: null }, hasLocation: false });
  });
});

describe("POST /v1/orders/{id}/reveal", () => {
  it("decrypts the delivery contact for this person and records one audit row with field names only", async () => {
    const before = (await auditRows()).length;
    const res = await http().post(`/v1/orders/${ids[1]}/reveal`).set(as("owner")).expect(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({
      name: "Mona Adel", phone: "+201001234821",
      address: { line1: "12 Abbas El Akkad St", line2: "Floor 3", city: "Nasr City", province: "Cairo", country: "EG" },
      location: { lat: 30.0561, lng: 31.3301 },
    });
    const rows = await auditRows();
    expect(rows).toHaveLength(before + 1);
    const row = rows.at(-1)!;
    expect(row.entity_id).toBe(ids[1]);
    expect(row.after).toEqual({ fields: ["name", "phone", "address", "location"] });
    expect(JSON.stringify(row)).not.toMatch(/Mona|Abbas|4821/);
  });

  it("never stores or replays the answer under an Idempotency-Key: each view is audited", async () => {
    const before = (await auditRows()).length;
    for (let i = 0; i < 2; i++) {
      const res = await http().post(`/v1/orders/${ids[2]}/reveal`).set({ ...as("owner"), "Idempotency-Key": "reveal-twice" }).expect(200);
      expect(res.headers["idempotency-replayed"]).toBeUndefined();
      expect(res.body.location).toBeNull();
    }
    expect(await auditRows()).toHaveLength(before + 2);
    const stored = await db.kysely.selectFrom("idempotency_keys").select("key").where("key", "=", "reveal-twice").execute();
    expect(stored).toEqual([]);
  });

  it("follows the role scope; finance cannot reveal; a redacted order is gone and leaves no audit row", async () => {
    const before = (await auditRows()).length;
    await http().post(`/v1/orders/${ids[1]}/reveal`).set(as("agent")).expect(404);
    expect((await http().post(`/v1/orders/${ids[2]}/reveal`).set(as("agent")).expect(200)).body.name).toBe("Mona Adel");
    expect((await http().post(`/v1/orders/${ids[1]}/reveal`).set(as("finance")).expect(403)).body.code).toBe("insufficient_role");
    await http().get(`/v1/orders/${ids[1]}`).set(as("finance")).expect(200);
    expect((await http().post(`/v1/orders/${ids[3]}/reveal`).set(as("owner")).expect(410)).body.code).toBe("pii_redacted");
    expect(await auditRows()).toHaveLength(before + 1); // the agent's view only
  });
});
