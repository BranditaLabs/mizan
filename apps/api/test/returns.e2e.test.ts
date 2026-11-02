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
import { StockService } from "../src/modules/stock/stock.service.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E10-3: what came back is inspected line by line. Sellable units go back into stock (once),
 * lost ones count on the order's profit, and a returned order not yet inspected says so. The ops
 * app records the same thing by scanning, exactly once per operation.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
let abaya: string;
let scarf: string;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
const onHand = async (variantId: string) => (await db.tenant(store, (trx) => trx.selectFrom("stock_levels").select("on_hand").where("variant_id", "=", variantId).executeTakeFirstOrThrow())).on_hand;
const pnl = (orderId: string) => db.tenant(store, (trx) => trx.selectFrom("order_pnl").select(["cogs_minor", "flags"]).where("order_id", "=", orderId).executeTakeFirstOrThrow());
const state = async (orderId: string, token = "wh") => (await http().get(`/v1/orders/${orderId}/returns`).set(as(token)).expect(200)).body;
const inspect = (orderId: string, body: object, token = "wh") => http().post(`/v1/orders/${orderId}/returns/inspect`).set(as(token)).send(body);
/** A COD order for 3 abayas and 1 scarf, moved to `status` as the courier would (shipping is M3). */
async function order(status: "returned" | "delivered" | "pending_confirmation") {
  const r = await http().post("/v1/orders").set(as("owner")).send({
    source: "phone", customer: { name: "Mona Adel", phone: "01001234821" }, address: { line1: "12 Abbas El Akkad St", city: "Nasr City" },
    lines: [{ variantId: abaya, quantity: 3 }, { variantId: scarf, quantity: 1 }], shipping: "0", payment: { mode: "cod" },
  }).expect(201);
  await drain();
  if (status !== "pending_confirmation") {
    await db.tenant(store, (trx) => trx.updateTable("orders").set({ status, confirmed_at: new Date(), shipped_at: new Date() }).where("id", "=", r.body.id).execute());
  }
  const lines = await db.tenant(store, (trx) => trx.selectFrom("order_lines").select(["id", "variant_id"]).where("order_id", "=", r.body.id).execute());
  return { id: r.body.id as string, number: r.body.number as string, abayaLine: lines.find((l) => l.variant_id === abaya)!.id, scarfLine: lines.find((l) => l.variant_id === scarf)!.id };
}

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null);
  fake.add("owner", { uid: "fb-owner-returns", email: "owner@returns.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Returns", country: "EG" }).expect(201)).body.id;
  for (const [token, role, phone] of [["wh", "warehouse", "01201119991"], ["finance", "finance", "01201119992"], ["agent", "agent", "01201119993"]] as const) {
    const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone, role }).expect(201);
    fake.add(token, { uid: `fb-${token}-returns`, phone: inv.body.phone });
    await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: `Bearer ${token}` }).expect(200);
  }
  ({ abaya, scarf } = await db.tenant(store, async (trx) => {
    const p = (await trx.insertInto("products").values({ tenant_id: store, title: "Abaya" }).returning("id").executeTakeFirstOrThrow()).id;
    const a = (await trx.insertInto("variants").values({ tenant_id: store, product_id: p, sku: "AB-1", barcode: "6221000000017", title: "Black / L", currency: "EGP", price_minor: 125000, cogs_minor: 50000, cogs_set_at: new Date() }).returning("id").executeTakeFirstOrThrow()).id;
    const s = (await trx.insertInto("variants").values({ tenant_id: store, product_id: p, sku: "SC-1", title: "Scarf", currency: "EGP", price_minor: 15000, cogs_minor: 4000, cogs_set_at: new Date() }).returning("id").executeTakeFirstOrThrow()).id;
    return { abaya: a, scarf: s };
  }));
  await http().post("/v1/stock/movements").set(as("owner")).send({ items: [{ variantId: abaya, kind: "count", quantity: 10 }] }).expect(200);
});
afterAll(() => app.close());

const recompute = async (orderId: string) => {
  const { ProfitService } = await import("../src/modules/profit/profit.service.js");
  await db.tenant(store, (trx) => app.get(ProfitService).recompute(trx, store, orderId));
};

describe("return inspection (E10-3)", () => {
  it("a refused order: sellable units go back into stock, lost ones cost the order; until then it waits for inspection", async () => {
    const o = await order("returned");
    await recompute(o.id);
    expect(await pnl(o.id)).toMatchObject({ cogs_minor: 0n, flags: expect.arrayContaining(["awaiting_inspection"]) });
    const s = await state(o.id);
    expect(s).toMatchObject({ eligible: true, canInspect: true });
    expect(s.lines).toEqual(expect.arrayContaining([expect.objectContaining({ lineId: o.abayaLine, sku: "AB-1", quantity: 3, remaining: 3 })]));

    const before = await onHand(abaya);
    const after = (await inspect(o.id, { items: [{ lineId: o.abayaLine, quantity: 2, outcome: "restock" }, { lineId: o.abayaLine, quantity: 1, outcome: "damaged" }], note: "One with a torn seam" }).expect(200)).body;
    expect(after.lines.find((l: { lineId: string }) => l.lineId === o.abayaLine)).toMatchObject({ restock: 2, damaged: 1, writeOff: 0, remaining: 0 });
    await drain();
    expect(await onHand(abaya)).toBe(before + 2);
    const moves = await db.tenant(store, (trx) => trx.selectFrom("stock_movements").select(["reason", "delta", "ref_type"]).where("variant_id", "=", abaya).where("ref_type", "=", "return").execute());
    expect(moves).toEqual([{ reason: "return_restock", delta: 2, ref_type: "return" }]);
    expect(await pnl(o.id)).toMatchObject({ cogs_minor: 50000n, flags: expect.arrayContaining(["awaiting_inspection"]) }); // the scarf is still to inspect

    await inspect(o.id, { items: [{ lineId: o.scarfLine, quantity: 1, outcome: "write_off" }] }).expect(200);
    await drain();
    const p = await pnl(o.id);
    expect(p.cogs_minor).toBe(54000n); // one abaya and the scarf lost
    expect(p.flags).not.toContain("awaiting_inspection");

    // The event delivered again changes nothing in stock.
    const inspection = await db.tenant(store, (trx) => trx.selectFrom("return_inspections").select(["id", "quantity"]).where("order_id", "=", o.id).where("outcome", "=", "restock").executeTakeFirstOrThrow());
    expect(await db.tenant(store, (trx) => app.get(StockService).restockReturn(trx, store, { inspectionId: inspection.id, orderId: o.id, variantId: abaya, quantity: 2 }, { type: "system" }))).toBe(false);
    expect(await onHand(abaya)).toBe(before + 2);

    const audit = await db.tenant(store, (trx) => trx.selectFrom("audit_log").select("action").where("entity_id", "=", o.id).where("action", "=", "return.inspected").execute());
    expect(audit).toHaveLength(2);
    expect((await state(o.id)).inspections.map((i: { outcome: string; quantity: number }) => `${i.outcome}:${i.quantity}`).sort()).toEqual(["damaged:1", "restock:2", "write_off:1"]);
  });

  it("never past a line's quantity, only on returned or delivered orders, by the warehouse and managers", async () => {
    const o = await order("returned");
    await inspect(o.id, { items: [{ lineId: o.abayaLine, quantity: 2, outcome: "restock" }, { lineId: o.abayaLine, quantity: 2, outcome: "damaged" }] }).expect(409)
      .expect((x) => expect(x.body.code).toBe("over_quantity"));
    await inspect(o.id, { items: [{ lineId: "00000000-0000-4000-8000-000000000000", quantity: 1, outcome: "restock" }] }).expect(422);
    await inspect(o.id, { items: [{ lineId: o.abayaLine, quantity: 1, outcome: "restock" }] }, "finance").expect(403);
    await inspect(o.id, { items: [{ lineId: o.abayaLine, quantity: 1, outcome: "restock" }] }, "agent").expect(403);
    expect((await state(o.id, "finance")).canInspect).toBe(false);
    const open = await order("pending_confirmation");
    expect((await state(open.id)).eligible).toBe(false);
    await inspect(open.id, { items: [{ lineId: open.abayaLine, quantity: 1, outcome: "restock" }] }).expect(409).expect((x) => expect(x.body.code).toBe("not_returned"));
  });

  it("a delivered order sent back: the units back in stock come off its product cost", async () => {
    const o = await order("delivered");
    await recompute(o.id);
    expect((await pnl(o.id)).cogs_minor).toBe(154000n);
    await inspect(o.id, { items: [{ lineId: o.abayaLine, quantity: 1, outcome: "restock" }] }).expect(200);
    await drain();
    expect((await pnl(o.id)).cogs_minor).toBe(104000n);
  });

  it("the ops app inspects by scanning, once per operation", async () => {
    const o = await order("returned");
    const before = await onHand(abaya);
    const op = (opId: string, items: object[]) => ({ opId, type: "return.inspect", at: new Date().toISOString(), payload: { orderNumber: o.number, items } });
    const first = (await http().post("/v1/ops/sync").set(as("wh")).send({ deviceId: "wh-phone-1", ops: [op("ret-op-0001", [{ barcode: "6221000000017", quantity: 3, outcome: "restock" }])] }).expect(200)).body;
    expect(first.results[0]).toMatchObject({ status: "applied", result: { orderId: o.id, inspected: 1, complete: false } });
    const again = (await http().post("/v1/ops/sync").set(as("wh")).send({ deviceId: "wh-phone-1", ops: [op("ret-op-0001", [{ barcode: "6221000000017", quantity: 3, outcome: "restock" }])] }).expect(200)).body;
    expect(again.results[0]).toMatchObject({ status: "duplicate", original: "applied" });
    const more = (await http().post("/v1/ops/sync").set(as("wh")).send({ deviceId: "wh-phone-1", ops: [
      op("ret-op-0002", [{ sku: "AB-1", quantity: 1, outcome: "restock" }]),
      op("ret-op-0003", [{ barcode: "0000", quantity: 1, outcome: "restock" }]),
      op("ret-op-0004", [{ sku: "SC-1", quantity: 1, outcome: "restock" }]),
    ] }).expect(200)).body;
    expect(more.results.map((r: { status: string; code: string | null }) => [r.status, r.code])).toEqual([["conflict", "over_quantity"], ["rejected", "unknown_item"], ["applied", null]]);
    await drain();
    expect(await onHand(abaya)).toBe(before + 3);
    expect((await state(o.id)).lines.every((l: { remaining: number }) => l.remaining === 0)).toBe(true);
  });
});
