import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * M16-1: suppliers, purchase orders and receiving. A PO is drafted, approved by amount, sent and
 * received from the web or the ops app (exactly once per opId); good units go into stock, damaged
 * ones are only recorded; each receipt moves the item's cost to the moving average at the day's
 * FX rate, locked on the receipt; more than ordered needs a manager.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
let supplier: string;
const items: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const sync = async (ops: object[], deviceId = "pixel-7a-po") => (await http().post("/v1/ops/sync").set(as("keeper")).send({ deviceId, ops }).expect(200)).body.results;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
const cost = async (sku: string) => db.tenant(store, async (trx) => trx.selectFrom("variants").select(["cogs_minor", "cogs_set_at"]).where("id", "=", items[sku]!).executeTakeFirstOrThrow());
const onHand = async (sku: string) => db.tenant(store, async (trx) => (await trx.selectFrom("stock_levels").select("on_hand").where("variant_id", "=", items[sku]!).executeTakeFirstOrThrow()).on_hand);

beforeAll(async () => {
  app = await createApp(loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" }), { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  fake.add("owner", { uid: "fb-owner-po", email: "owner@po.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Purchasing", country: "EG" }).expect(201)).body.id;
  await db.tenant(store, async (trx) => {
    for (const [sku, barcode, title] of [["AB-1", "6221000000101", "Abaya"], ["SC-1", "6221000000102", "Scarf"], ["BG-1", "6221000000103", "Bag"]] as const) {
      const p = await trx.insertInto("products").values({ tenant_id: store, title }).returning("id").executeTakeFirstOrThrow();
      items[sku] = (await trx.insertInto("variants").values({ tenant_id: store, product_id: p.id, sku, barcode, currency: "EGP", price_minor: 50000 }).returning("id").executeTakeFirstOrThrow()).id;
    }
    // The abaya has a cost already; the scarf and bag do not.
    await trx.updateTable("variants").set({ cogs_minor: 8000, cogs_set_at: new Date() }).where("id", "=", items["AB-1"]!).execute();
  });
  for (const [name, phone, role] of [["keeper", "01201117771", "warehouse"], ["opsman", "01201117772", "ops_manager"], ["agent", "01201117773", "agent"]] as const) {
    const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone, role }).expect(201);
    fake.add(name, { uid: `fb-${name}-po`, phone: inv.body.phone });
    await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: `Bearer ${name}` }).expect(200);
  }
  await http().post("/v1/stock/movements").set(as("owner")).send({ items: [{ variantId: items["AB-1"], kind: "count", quantity: 50 }, { variantId: items["SC-1"], kind: "count", quantity: 20 }] }).expect(200);
});
afterAll(() => app.close());

describe("suppliers (M16-1)", () => {
  it("are created by managers, unique by name among active ones, archived and restored", async () => {
    await http().post("/v1/suppliers").set(as("agent")).send({ name: "Alex Textiles", currency: "EGP" }).expect(403);
    const s = (await http().post("/v1/suppliers").set(as("opsman")).send({ name: "Alex Textiles", currency: "EGP", phone: "+20 3 480 1234", leadTimeDays: 7 }).expect(201)).body;
    expect(s).toMatchObject({ name: "Alex Textiles", currency: "EGP", phone: "+2034801234", leadTimeDays: 7, archived: false, openOrders: 0 });
    supplier = s.id;
    await http().post("/v1/suppliers").set(as("owner")).send({ name: "alex textiles", currency: "EGP" }).expect(409);
    const other = (await http().post("/v1/suppliers").set(as("owner")).send({ name: "Shenzhen Pack Co.", currency: "USD", country: "CN" }).expect(201)).body;
    expect((await http().patch(`/v1/suppliers/${other.id}`).set(as("owner")).send({ archived: true }).expect(200)).body.archived).toBe(true);
    expect((await http().get("/v1/suppliers").set(as("owner")).expect(200)).body.data.map((x: { name: string }) => x.name)).toEqual(["Alex Textiles"]);
    expect((await http().get("/v1/suppliers?archived=true").set(as("owner")).expect(200)).body.data.map((x: { name: string }) => x.name)).toEqual(["Shenzhen Pack Co."]);
    await http().post("/v1/purchase-orders").set(as("owner")).send({ supplierId: other.id, lines: [{ variantId: items["AB-1"], quantity: 1, unitCost: "1" }] }).expect(409);
    await http().patch(`/v1/suppliers/${other.id}`).set(as("owner")).send({ archived: false }).expect(200);
  });
});

describe("purchase orders and receiving (M16-1)", () => {
  let po: { id: string; number: string };

  it("a draft is numbered, priced in the supplier's currency and edited as a whole", async () => {
    await http().post("/v1/purchase-orders").set(as("keeper")).send({ supplierId: supplier, lines: [{ variantId: items["AB-1"], quantity: 1, unitCost: "1" }] }).expect(403);
    await http().post("/v1/purchase-orders").set(as("owner")).send({ supplierId: supplier, lines: [{ variantId: items["AB-1"], quantity: 1, unitCost: "1.005" }] }).expect(422);
    const created = (await http().post("/v1/purchase-orders").set(as("opsman")).send({
      supplierId: supplier, expectedAt: "2026-11-05", lines: [{ variantId: items["AB-1"], quantity: 8, unitCost: "100" }],
    }).expect(201)).body;
    expect(created).toMatchObject({ number: "PO-0001", status: "draft", total: { amount: "800.00", currency: "EGP" }, items: 1, units: 8, receivedUnits: 0, expectedAt: "2026-11-05", needsOwner: false });
    po = created;
    const edited = (await http().put(`/v1/purchase-orders/${po.id}`).set(as("opsman")).send({
      supplierId: supplier, expectedAt: "2026-11-05", notes: "Winter batch",
      lines: [{ variantId: items["AB-1"], quantity: 10, unitCost: "100.00" }, { variantId: items["SC-1"], quantity: 5, unitCost: "40" }],
    }).expect(200)).body;
    expect(edited).toMatchObject({ total: { amount: "1200.00" }, items: 2, units: 15, notes: "Winter batch" });
    expect(edited.lines.map((l: { sku: string; unitCost: { amount: string } }) => [l.sku, l.unitCost.amount])).toEqual([["AB-1", "100.00"], ["SC-1", "40.00"]]);
  });

  it("nothing is received before approval; above the threshold only the owner approves", async () => {
    expect((await http().get("/v1/settings/purchasing").set(as("owner")).expect(200)).body).toEqual({ approveOver: "50000.00", currency: "EGP" });
    await http().put("/v1/settings/purchasing").set(as("opsman")).send({ approveOver: "1000" }).expect(403);
    expect((await http().put("/v1/settings/purchasing").set(as("owner")).send({ approveOver: "1000" }).expect(200)).body).toEqual({ approveOver: "1000.00", currency: "EGP" });
    expect((await http().post(`/v1/purchase-orders/${po.id}/receipts`).set(as("keeper")).send({ items: [{ variantId: items["AB-1"], quantity: 1 }] }).expect(409)).body.code).toBe("po_not_open");
    await http().post(`/v1/purchase-orders/${po.id}/approve`).set(as("keeper")).expect(403);
    expect((await http().post(`/v1/purchase-orders/${po.id}/approve`).set(as("opsman")).expect(403)).body.code).toBe("needs_owner");
    expect((await http().post(`/v1/purchase-orders/${po.id}/approve`).set(as("owner")).expect(200)).body).toMatchObject({ status: "approved", needsOwner: true });
    await http().put(`/v1/purchase-orders/${po.id}`).set(as("owner")).send({ supplierId: supplier, lines: [{ variantId: items["AB-1"], quantity: 1, unitCost: "1" }] }).expect(409);
    const sent = (await http().post(`/v1/purchase-orders/${po.id}/send`).set(as("opsman")).expect(200)).body;
    expect(sent.status).toBe("sent");
    expect((await http().post(`/v1/purchase-orders/${po.id}/send`).set(as("opsman")).expect(200)).body.sentAt).toBe(sent.sentAt);
  });

  it("a web receipt stocks good units, records damaged ones and moves the cost to the moving average", async () => {
    await http().post(`/v1/purchase-orders/${po.id}/receipts`).set(as("agent")).send({ items: [{ variantId: items["AB-1"], quantity: 1 }] }).expect(403);
    expect((await http().post(`/v1/purchase-orders/${po.id}/receipts`).set(as("keeper")).send({ items: [{ sku: "BG-1", quantity: 1 }] }).expect(422)).body.code).toBe("not_on_po");
    const r = (await http().post(`/v1/purchase-orders/${po.id}/receipts`).set(as("keeper")).send({ items: [{ barcode: "6221000000101", quantity: 6, damaged: 1 }] }).expect(201)).body;
    expect(r).toMatchObject({ status: "partially_received", receivedUnits: 7 });
    expect(r.lines[0]).toMatchObject({ sku: "AB-1", received: 6, damaged: 1 });
    expect(r.receipts).toEqual([expect.objectContaining({ number: 1, units: 6, damaged: 1, costStatus: "applied", fxRate: "1", viaApp: false, overApproved: false })]);
    expect(await onHand("AB-1")).toBe(56);
    // (50 × 80.00 + 6 × 100.00) ÷ 56 = 82.142… → 82.14
    expect(Number((await cost("AB-1")).cogs_minor)).toBe(8214);
  });

  it("the ops app receives against the PO by number, exactly once; the last units complete it", async () => {
    const op = { opId: "op-po-receive-0001", type: "po.receive", at: new Date().toISOString(), payload: { number: "PO-0001", items: [{ barcode: "6221000000101", quantity: 3 }, { sku: "SC-1", quantity: 5 }] } };
    const [first] = await sync([op]);
    expect(first).toMatchObject({ status: "applied", result: { number: "PO-0001", receipt: 2, units: 8, damaged: 0, status: "received", costStatus: "applied" } });
    const [again] = await sync([op], "pixel-7a-other");
    expect(again).toMatchObject({ status: "duplicate", original: "applied" });
    expect(await onHand("AB-1")).toBe(59);
    expect(await onHand("SC-1")).toBe(25);
    // (56 × 82.14 + 3 × 100.00) ÷ 59 = 83.051… → 83.05; the scarf had no cost: it takes the PO's.
    expect(Number((await cost("AB-1")).cogs_minor)).toBe(8305);
    expect(Number((await cost("SC-1")).cogs_minor)).toBe(4000);
    const done = (await http().get(`/v1/purchase-orders/${po.id}`).set(as("keeper")).expect(200)).body;
    expect(done).toMatchObject({ status: "received", receivedUnits: 15, late: false });
    expect(done.receivedAt).not.toBeNull();
    expect(done.receipts[1]).toMatchObject({ number: 2, viaApp: true });
    const [late] = await sync([{ opId: "op-po-receive-0002", type: "po.receive", at: new Date().toISOString(), payload: { number: "1", items: [{ sku: "SC-1", quantity: 1 }] } }]);
    expect(late).toMatchObject({ status: "conflict", code: "po_not_open" });
    expect((await http().post(`/v1/purchase-orders/${po.id}/cancel`).set(as("owner")).expect(409)).body.code).toBe("has_receipts");
    const events = await db.tenant(store, async (trx) => trx.selectFrom("domain_events").select(["type"]).where("type", "like", "po.%").orderBy("occurred_at").execute());
    expect(events.map((e) => e.type)).toEqual(["po.approved", "po.sent", "po.received", "po.received"]);
  });

  it("a foreign-currency PO needs the owner; more than ordered needs a manager; the FX rate is locked on the receipt", async () => {
    const usd = (await http().post("/v1/suppliers").set(as("owner")).send({ name: "Guangzhou Bags", currency: "USD" }).expect(201)).body;
    const p = (await http().post("/v1/purchase-orders").set(as("opsman")).send({ supplierId: usd.id, lines: [{ variantId: items["BG-1"], quantity: 2, unitCost: "2.50" }] }).expect(201)).body;
    expect(p).toMatchObject({ number: "PO-0002", total: { amount: "5.00", currency: "USD" }, needsOwner: true });
    expect((await http().post(`/v1/purchase-orders/${p.id}/approve`).set(as("opsman")).expect(403)).body.code).toBe("needs_owner");
    await http().post(`/v1/purchase-orders/${p.id}/approve`).set(as("owner")).expect(200);
    await http().put(`/v1/fx-rates/${today()}/USD`).set(as("owner")).send({ rate: "0.02" }).expect(200); // 1 EGP = 0.02 USD
    const [over] = await sync([{ opId: "op-po-receive-0003", type: "po.receive", at: new Date().toISOString(), payload: { purchaseOrderId: p.id, items: [{ sku: "BG-1", quantity: 3 }] } }]);
    expect(over).toMatchObject({ status: "conflict", code: "over_receipt" });
    await http().post(`/v1/purchase-orders/${p.id}/receipts`).set(as("keeper")).send({ items: [{ sku: "BG-1", quantity: 3 }], allowOver: true }).expect(403);
    const r = (await http().post(`/v1/purchase-orders/${p.id}/receipts`).set(as("opsman")).send({ items: [{ sku: "BG-1", quantity: 3 }], allowOver: true }).expect(201)).body;
    expect(r).toMatchObject({ status: "received", receivedUnits: 3 });
    expect(r.receipts[0]).toMatchObject({ fxRate: "0.02", overApproved: true, costStatus: "applied" });
    // 3 × 2.50 USD = 7.50 USD = 375.00 EGP; nothing was on hand: 125.00 each.
    expect(Number((await cost("BG-1")).cogs_minor)).toBe(12500);
    expect(await onHand("BG-1")).toBe(3);
  });

  it("without a rate for the day the stock still goes in and the cost waits", async () => {
    const sar = (await http().post("/v1/suppliers").set(as("owner")).send({ name: "Riyadh Trims", currency: "SAR" }).expect(201)).body;
    const p = (await http().post("/v1/purchase-orders").set(as("owner")).send({ supplierId: sar.id, lines: [{ variantId: items["SC-1"], quantity: 4, unitCost: "9" }] }).expect(201)).body;
    await http().post(`/v1/purchase-orders/${p.id}/approve`).set(as("owner")).expect(200);
    const r = (await http().post(`/v1/purchase-orders/${p.id}/receipts`).set(as("keeper")).send({ items: [{ variantId: items["SC-1"], quantity: 4 }] }).expect(201)).body;
    expect(r.receipts[0]).toMatchObject({ costStatus: "fx_missing", fxRate: null });
    expect(await onHand("SC-1")).toBe(29);
    expect(Number((await cost("SC-1")).cogs_minor)).toBe(4000);
  });

  it("lists by status with counts; a draft can be cancelled; the trail is audited", async () => {
    const d = (await http().post("/v1/purchase-orders").set(as("owner")).send({ supplierId: supplier, lines: [{ variantId: items["BG-1"], quantity: 1, unitCost: "50" }] }).expect(201)).body;
    expect((await http().post(`/v1/purchase-orders/${d.id}/cancel`).set(as("opsman")).expect(200)).body.status).toBe("cancelled");
    const all = (await http().get("/v1/purchase-orders").set(as("owner")).expect(200)).body;
    expect(all.counts).toMatchObject({ received: 3, cancelled: 1, draft: 0 });
    expect(all.data.map((x: { number: string }) => x.number)).toEqual(["PO-0004", "PO-0003", "PO-0002", "PO-0001"]);
    expect((await http().get("/v1/purchase-orders?status=open").set(as("keeper")).expect(200)).body.data).toEqual([]);
    const actions = await db.tenant(store, async (trx) => trx.selectFrom("audit_log").select("action").where("action", "like", "po.%").execute());
    expect(new Set(actions.map((a) => a.action))).toEqual(new Set(["po.created", "po.updated", "po.approved", "po.sent", "po.received", "po.cancelled"]));
  });
});

describe("landed costs (M16-4a)", () => {
  it("are spread by value or quantity into the unit cost at receipt, each currency at the day's rate", async () => {
    const ids: Record<string, string> = {};
    await db.tenant(store, async (trx) => {
      for (const [sku, title] of [["LC-X", "Kaftan"], ["LC-Y", "Belt"]] as const) {
        const p = await trx.insertInto("products").values({ tenant_id: store, title }).returning("id").executeTakeFirstOrThrow();
        ids[sku] = (await trx.insertInto("variants").values({ tenant_id: store, product_id: p.id, sku, currency: "EGP", price_minor: 50000 }).returning("id").executeTakeFirstOrThrow()).id;
      }
    });
    const p = (await http().post("/v1/purchase-orders").set(as("owner")).send({ supplierId: supplier, lines: [
      { variantId: ids["LC-X"], quantity: 10, unitCost: "100" }, { variantId: ids["LC-Y"], quantity: 5, unitCost: "40" },
    ] }).expect(201)).body;
    await http().post(`/v1/purchase-orders/${p.id}/landed-costs`).set(as("keeper")).send({ kind: "freight", amount: "600" }).expect(403);
    await http().post(`/v1/purchase-orders/${p.id}/landed-costs`).set(as("owner")).send({ kind: "bribe", amount: "1" }).expect(422);
    const withFreight = (await http().post(`/v1/purchase-orders/${p.id}/landed-costs`).set(as("opsman")).send({ kind: "freight", amount: "600", description: "Alexandria to Cairo" }).expect(201)).body;
    // 600.00 by value over 1,200.00 of goods: 50% on each unit.
    expect(withFreight.lines.map((l: { sku: string; landedUnitCost: { amount: string } }) => [l.sku, l.landedUnitCost.amount])).toEqual([["LC-X", "150.00"], ["LC-Y", "60.00"]]);
    const withCustoms = (await http().post(`/v1/purchase-orders/${p.id}/landed-costs`).set(as("owner")).send({ kind: "customs", amount: "10", currency: "USD", allocateBy: "quantity" }).expect(201)).body;
    expect(withCustoms.landedCosts).toHaveLength(2);
    expect(withCustoms.lines[0].landedUnitCost).toBeNull(); // a cost in another currency is converted at receipt
    const wrong = (await http().post(`/v1/purchase-orders/${p.id}/landed-costs`).set(as("owner")).send({ kind: "other", amount: "1" }).expect(201)).body;
    const extra = wrong.landedCosts.find((c: { kind: string }) => c.kind === "other").id;
    expect((await http().delete(`/v1/purchase-orders/${p.id}/landed-costs/${extra}`).set(as("owner")).expect(200)).body.landedCosts).toHaveLength(2);

    await http().post(`/v1/purchase-orders/${p.id}/approve`).set(as("owner")).expect(200);
    await http().post(`/v1/purchase-orders/${p.id}/receipts`).set(as("keeper")).send({ items: [{ sku: "LC-X", quantity: 4 }] }).expect(201);
    // Goods 4 × 100.00 = 400.00; freight 600 × (1000/1200) × 4/10 = 200.00; customs 10 USD × 10/15 × 4/10 = 2.67 USD = 133.50 at 50 EGP.
    // (400.00 + 200.00 + 133.50) ÷ 4 = 183.375 → 183.38
    expect(Number((await db.tenant(store, async (trx) => trx.selectFrom("variants").select("cogs_minor").where("id", "=", ids["LC-X"]!).executeTakeFirstOrThrow())).cogs_minor)).toBe(18338);
    const line = await db.tenant(store, async (trx) => trx.selectFrom("purchase_receipt_lines").select(["landed_minor", "unit_cost_minor"]).where("variant_id", "=", ids["LC-X"]!).executeTakeFirstOrThrow());
    expect([Number(line.landed_minor), Number(line.unit_cost_minor)]).toEqual([33350, 18338]);

    // A received PO's costs are final.
    const done = (await http().get("/v1/purchase-orders?status=received").set(as("owner")).expect(200)).body.data[0];
    expect((await http().post(`/v1/purchase-orders/${done.id}/landed-costs`).set(as("owner")).send({ kind: "freight", amount: "5" }).expect(409)).body.code).toBe("po_closed");
  });
});
