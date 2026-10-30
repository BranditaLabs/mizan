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
 * E8-4c: pick lists and scan-to-pack. Confirmed orders are batched into a list whose items are
 * sorted by shelf; on the phone an order is packed only when what was scanned is exactly what it
 * holds; a second phone packing the same order loses (first sync wins); the list closes itself.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
const items: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
const sync = async (ops: object[], deviceId = "pixel-7a-01") => (await http().post("/v1/ops/sync").set(as("keeper")).send({ deviceId, ops }).expect(200)).body.results;
const at = (min: number) => new Date(Date.UTC(2026, 9, 30, 9, min)).toISOString();
let n = 0;
async function confirmedOrder(lines: Array<[string, number]>) {
  const r = await http().post("/v1/orders").set(as("owner")).send({
    source: "phone", customer: { name: "Mona Adel", phone: `0100100${String(++n).padStart(4, "0")}` }, address: { line1: "12 Abbas El Akkad St", city: "Nasr City" },
    lines: lines.map(([sku, quantity]) => ({ variantId: items[sku], quantity })), payment: { mode: "cod" },
  }).expect(201);
  await drain();
  await http().post(`/v1/orders/${r.body.id}/confirmation`).set(as("owner")).send({ answer: "confirm", byCall: true }).expect(200);
  await drain();
  return r.body as { id: string; number: string };
}

beforeAll(async () => {
  app = await createApp(loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" }), { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null);
  fake.add("owner", { uid: "fb-owner-pick", email: "owner@pick.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Pick", country: "EG" }).expect(201)).body.id;
  await db.tenant(store, async (trx) => {
    for (const [sku, barcode, title] of [["AB-1", "6221000000001", "Abaya"], ["SC-1", "6221000000002", "Scarf"], ["BG-1", "6221000000003", "Bag"]] as const) {
      const p = await trx.insertInto("products").values({ tenant_id: store, title }).returning("id").executeTakeFirstOrThrow();
      items[sku] = (await trx.insertInto("variants").values({ tenant_id: store, product_id: p.id, sku, barcode, currency: "EGP", price_minor: 50000 }).returning("id").executeTakeFirstOrThrow()).id;
    }
  });
  for (const [name, phone, role] of [["keeper", "01201118881", "warehouse"], ["agent", "01201118882", "agent"]] as const) {
    const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone, role }).expect(201);
    fake.add(name, { uid: `fb-${name}-pick`, phone: inv.body.phone });
    await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: `Bearer ${name}` }).expect(200);
  }
  await http().post("/v1/stock/movements").set(as("owner")).send({ items: Object.values(items).map((variantId) => ({ variantId, kind: "count", quantity: 50 })) }).expect(200);
  for (const [sku, bin] of [["AB-1", "C-11-1"], ["SC-1", "A-03-2"], ["BG-1", "B-02-4"]]) {
    expect((await http().patch(`/v1/stock/${items[sku]}`).set(as("keeper")).send({ bin }).expect(200)).body).toMatchObject({ bin });
  }
});
afterAll(() => app.close());

describe("pick lists and scan-to-pack (E8-4c)", () => {
  let a: { id: string; number: string };
  let b: { id: string; number: string };
  let list: { id: string; number: number };

  it("a pick list takes the confirmed orders ready to pack; items are totalled and sorted by shelf", async () => {
    a = await confirmedOrder([["AB-1", 1], ["SC-1", 2]]);
    b = await confirmedOrder([["SC-1", 1], ["BG-1", 1]]);
    const waiting = (await http().post("/v1/orders").set(as("owner")).send({
      source: "phone", customer: { name: "Sara Nabil", phone: "01009998888" }, address: { line1: "5 Makram Ebeid", city: "Nasr City" },
      lines: [{ variantId: items["AB-1"], quantity: 1 }], payment: { mode: "cod" },
    }).expect(201)).body; // not confirmed: not picked
    await http().post("/v1/picklists").set(as("agent")).send({}).expect(403);
    const created = (await http().post("/v1/picklists").set(as("keeper")).send({}).expect(201)).body;
    list = created;
    expect(created).toMatchObject({ number: 1, status: "open" });
    expect(created.orders.map((o: { id: string }) => o.id).sort()).toEqual([a.id, b.id].sort());
    expect(created.orders.map((o: { id: string }) => o.id)).not.toContain(waiting.id);
    expect(created.items.map((i: { sku: string; bin: string; quantity: number }) => [i.sku, i.bin, i.quantity])).toEqual([["SC-1", "A-03-2", 3], ["BG-1", "B-02-4", 1], ["AB-1", "C-11-1", 1]]);
    expect((await http().post("/v1/picklists").set(as("keeper")).send({}).expect(409)).body.code).toBe("nothing_to_pick"); // already on an open list
    expect((await http().get("/v1/picklists").set(as("keeper")).expect(200)).body.data).toEqual([expect.objectContaining({ number: 1, orders: 2, packed: 0 })]);
  });

  it("a wrong item or a missing one is refused; the right scan packs the order once; a second phone gets a conflict", async () => {
    const pack = (opId: string, itemsScanned: object[], min: number, device?: string) => sync([{ opId, type: "order.pack", payload: { orderId: a.id, items: itemsScanned }, at: at(min) }], device);
    const wrong = await pack("op-pack-wrong-01", [{ barcode: "6221000000001", quantity: 1 }, { barcode: "6221000000003", quantity: 2 }], 1);
    expect(wrong[0]).toMatchObject({ status: "rejected", code: "wrong_item" });
    const short = await pack("op-pack-short-01", [{ barcode: "6221000000001", quantity: 1 }, { barcode: "6221000000002", quantity: 1 }], 2);
    expect(short[0]).toMatchObject({ status: "rejected", code: "incomplete" });
    expect(short[0].message).toContain("Scarf ×1");
    const ok = await pack("op-pack-good-01", [{ barcode: "6221000000002", quantity: 1 }, { sku: "AB-1", quantity: 1 }, { barcode: "6221000000002", quantity: 1 }], 3);
    expect(ok[0]).toMatchObject({ status: "applied", result: { orderId: a.id, number: a.number } });
    expect((await pack("op-pack-good-01", [], 3))[0]).toMatchObject({ status: "duplicate", original: "applied" }); // the same op again
    const other = await pack("op-pack-other-1", [{ barcode: "6221000000002", quantity: 2 }, { barcode: "6221000000001", quantity: 1 }], 4, "pixel-7a-02");
    expect(other[0]).toMatchObject({ status: "conflict", code: "already_packed" });

    const detail = (await http().get(`/v1/orders/${a.id}`).set(as("owner")).expect(200)).body;
    expect(detail.events.map((e: { type: string }) => e.type)).toContain("packed");
    const ev = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select("type").where("type", "=", "order.packed").execute());
    expect(ev).toHaveLength(1);
    const view = (await http().get(`/v1/picklists/${list.id}`).set(as("keeper")).expect(200)).body;
    expect(view.orders.find((o: { id: string }) => o.id === a.id).packedAt).toEqual(expect.any(String));
    expect(view.items.map((i: { sku: string; quantity: number }) => [i.sku, i.quantity])).toEqual([["SC-1", 1], ["BG-1", 1]]); // what is left to pick
  });

  it("packing the last order closes the list; a closed list is not offered again", async () => {
    const r = await sync([{ opId: "op-pack-b-00001", type: "order.pack", payload: { orderNumber: b.number, items: [{ barcode: "6221000000002", quantity: 1 }, { barcode: "6221000000003", quantity: 1 }], manual: true }, at: at(5) }]);
    expect(r[0].status).toBe("applied");
    const closed = (await http().get(`/v1/picklists/${list.id}`).set(as("keeper")).expect(200)).body;
    expect(closed).toMatchObject({ status: "closed", closedAt: expect.any(String) });
    expect((await http().get("/v1/picklists").set(as("keeper")).expect(200)).body.data).toEqual([]);
    expect((await http().get("/v1/picklists?status=closed").set(as("keeper")).expect(200)).body.data).toEqual([expect.objectContaining({ number: 1, orders: 2, packed: 2 })]);
    const audit = (await http().get("/v1/audit-log?action=picklist.closed").set(as("owner")).expect(200)).body.data;
    expect(audit).toHaveLength(1);
  });

  it("a list closed by hand frees its unpacked orders for the next one; packing a cancelled order is a conflict", async () => {
    const c = await confirmedOrder([["BG-1", 2]]);
    const l2 = (await http().post("/v1/picklists").set(as("keeper")).send({ orderIds: [c.id] }).expect(201)).body;
    expect(l2.number).toBe(2);
    await http().post(`/v1/picklists/${l2.id}/close`).set(as("keeper")).expect(200);
    const l3 = (await http().post("/v1/picklists").set(as("keeper")).send({}).expect(201)).body;
    expect(l3.orders.map((o: { id: string }) => o.id)).toEqual([c.id]);
    await http().post("/v1/orders/bulk").set(as("owner")).send({ action: "cancel", orderIds: [c.id], reason: "other" }).expect(202);
    await drain();
    const r = await sync([{ opId: "op-pack-c-00001", type: "order.pack", payload: { orderId: c.id, items: [{ sku: "BG-1", quantity: 2 }] }, at: at(9) }]);
    expect(r[0]).toMatchObject({ status: "conflict", code: "not_packable" });
  });
});
