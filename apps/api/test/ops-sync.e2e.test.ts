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
 * E8-3: the ops app's batch sync. Each op is applied once by its opId: a lost response, a retry or
 * two phones sending the same op change nothing more. Ops run in the order they happened on the
 * phone; a bad op is rejected alone; the server's stock wins a conflict.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
let tote: string;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const sync = async (ops: object[], token = "keeper", deviceId = "pixel-7a-01") => (await http().post("/v1/ops/sync").set(as(token)).send({ deviceId, ops }).expect(200)).body;
const at = (min: number) => new Date(Date.UTC(2026, 9, 26, 9, min)).toISOString();
const level = () => db.tenant(store, (trx) => trx.selectFrom("stock_levels").select(["on_hand", "reserved"]).where("variant_id", "=", tote).executeTakeFirst());
const movements = () => db.tenant(store, (trx) => trx.selectFrom("stock_movements").select(["delta", "device_op_id"]).where("variant_id", "=", tote).orderBy("seq").execute());

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  fake.add("owner", { uid: "fb-owner-ops", email: "owner@ops.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Ops", country: "EG" }).expect(201)).body.id;
  tote = await db.tenant(store, async (trx) => {
    const p = await trx.insertInto("products").values({ tenant_id: store, title: "Tote bag" }).returning("id").executeTakeFirstOrThrow();
    return (await trx.insertInto("variants").values({ tenant_id: store, product_id: p.id, sku: "BAG-TT", barcode: "6221000000777", currency: "EGP" }).returning("id").executeTakeFirstOrThrow()).id;
  });
  for (const [name, phone, role] of [["keeper", "01201119991", "warehouse"], ["agent", "01201119992", "agent"]] as const) {
    const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone, role }).expect(201);
    fake.add(name, { uid: `fb-${name}-ops`, phone: inv.body.phone });
    await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: `Bearer ${name}` }).expect(200);
  }
});
afterAll(() => app.close());

describe("ops app sync (E8-3)", () => {
  it("applies ops in the order they happened, by scan or SKU, and returns one result per op in the order sent", async () => {
    const r = await sync([
      { opId: "op-receive-0001", type: "stock.receive", payload: { barcode: "6221000000777", quantity: 5 }, at: at(10) },
      { opId: "op-count-000001", type: "stock.count", payload: { sku: "BAG-TT", quantity: 20 }, at: at(1) },
    ]);
    expect(r.results.map((x: { opId: string; status: string }) => [x.opId, x.status])).toEqual([["op-receive-0001", "applied"], ["op-count-000001", "applied"]]);
    expect(r.results[0].result).toMatchObject({ variantId: tote, onHand: 25, reserved: 0, available: 25 }); // counted 20 at 09:01, then +5 at 09:10
    expect(await level()).toEqual({ on_hand: 25, reserved: 0 });
    expect((await movements()).map((m) => m.device_op_id)).toEqual(["op-count-000001", "op-receive-0001"]);
  });

  it("a replay changes nothing and returns the first outcome, even inside one batch and from another phone", async () => {
    const again = await sync([
      { opId: "op-receive-0001", type: "stock.receive", payload: { barcode: "6221000000777", quantity: 5 }, at: at(10) },
      { opId: "op-adjust-00001", type: "stock.adjust", payload: { sku: "BAG-TT", quantity: -2, reason: "damaged" }, at: at(20) },
      { opId: "op-adjust-00001", type: "stock.adjust", payload: { sku: "BAG-TT", quantity: -2, reason: "damaged" }, at: at(20) },
    ], "keeper", "pixel-7a-02");
    expect(again.results.map((x: { status: string; original: string | null }) => [x.status, x.original])).toEqual([["duplicate", "applied"], ["applied", null], ["duplicate", "applied"]]);
    expect(again.results[0].result).toMatchObject({ onHand: 25 }); // what it was when first applied
    expect(await level()).toEqual({ on_hand: 23, reserved: 0 });
    expect(await movements()).toHaveLength(3);
  });

  it("a bad op is rejected alone and stays rejected; a conflict with orders' holds is reported, the server wins", async () => {
    await db.tenant(store, (trx) => trx.updateTable("stock_levels").set({ reserved: 10 }).where("variant_id", "=", tote).execute());
    const r = await sync([
      { opId: "op-unknown-0001", type: "stock.teleport", payload: {}, at: at(30) },
      { opId: "op-bad-qty-0001", type: "stock.receive", payload: { sku: "BAG-TT", quantity: -1 }, at: at(31) },
      { opId: "op-no-item-0001", type: "stock.receive", payload: { barcode: "0000", quantity: 1 }, at: at(32) },
      { opId: "op-noreason-001", type: "stock.adjust", payload: { sku: "BAG-TT", quantity: -1 }, at: at(33) },
      { opId: "op-conflict-001", type: "stock.count", payload: { sku: "BAG-TT", quantity: 4 }, at: at(34) },
      { opId: "op-good-000001", type: "stock.receive", payload: { sku: "BAG-TT", quantity: 1 }, at: at(35) },
    ]);
    expect(r.results.map((x: { status: string; code: string | null }) => `${x.status}:${x.code}`)).toEqual([
      "rejected:unknown_type", "rejected:invalid_payload", "rejected:unknown_item", "rejected:invalid_payload", "conflict:below_reserved", "applied:null",
    ]);
    expect(r.results[4].message).toContain("10 reserved");
    expect(await level()).toEqual({ on_hand: 24, reserved: 10 });
    const replay = await sync([{ opId: "op-conflict-001", type: "stock.count", payload: { sku: "BAG-TT", quantity: 30 }, at: at(34) }]);
    expect(replay.results[0]).toMatchObject({ status: "duplicate", original: "conflict", code: "below_reserved" });
    expect(await level()).toEqual({ on_hand: 24, reserved: 10 });
    const audit = await db.tenant(store, (trx) => trx.selectFrom("audit_log").select("after").where("action", "=", "ops.synced").execute());
    expect(audit).toHaveLength(4);
  });

  it("refuses a malformed batch and roles without warehouse work", async () => {
    await http().post("/v1/ops/sync").set(as("keeper")).send({ deviceId: "x", ops: [] }).expect(422);
    await http().post("/v1/ops/sync").set(as("keeper")).send({ deviceId: "x", ops: [{ opId: "short", type: "stock.count", payload: {}, at: at(1) }] }).expect(422);
    await http().post("/v1/ops/sync").set(as("agent")).send({ deviceId: "x", ops: [{ opId: "op-agent-00001", type: "stock.count", payload: { sku: "BAG-TT", quantity: 1 }, at: at(1) }] }).expect(403);
  });
});
