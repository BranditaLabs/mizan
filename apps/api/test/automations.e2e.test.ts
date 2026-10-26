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
 * E11-1 / E11-3: the automation core. An automation runs once per event, reads the order fresh,
 * checks its conditions and runs its steps; a chain of automations stops at depth 3 (loop
 * guard); one that keeps failing pauses itself and tells the team (error guard); a dry run shows
 * each rule's actual value and changes nothing.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
let agentId: string;
let n = 0;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
async function order(unitPrice: string): Promise<{ id: string; number: string }> {
  n++;
  const r = await http().post("/v1/orders").set(as("owner")).send({
    source: "phone", customer: { name: "Mona Adel", phone: `0100${String(3000000 + n)}` }, address: { line1: "12 Abbas El Akkad St", city: "Nasr City" },
    lines: [{ title: "Abaya", quantity: 1, unitPrice }], payment: { mode: "cod" },
  }).expect(201);
  await drain();
  return { id: r.body.id, number: r.body.number };
}
const create = async (body: object, status = 201) => (await http().post("/v1/automations").set(as("owner")).send(body).expect(status)).body;
const orderRow = (id: string) => db.tenant(store, (trx) => trx.selectFrom("orders").select(["tags", "assigned_to"]).where("id", "=", id).executeTakeFirstOrThrow());

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null);
  fake.add("owner", { uid: "fb-owner-auto", email: "owner@auto.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Auto", country: "EG" }).expect(201)).body.id;
  await http().put("/v1/settings/orders").set(as("owner")).send({ duplicateWindowHours: 0 }).expect(200);
  const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone: "01201114444", role: "agent" }).expect(201);
  fake.add("agent", { uid: "fb-agent-auto", phone: inv.body.phone });
  await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: "Bearer agent" }).expect(200);
  agentId = (await http().get("/v1/me").set({ Authorization: "Bearer agent" }).expect(200)).body.user.id;
});
afterAll(() => app.close());

describe("automation core (E11-1, E11-3)", () => {
  it("the catalogue lists triggers, fields and actions; definitions are checked against it", async () => {
    const c = (await http().get("/v1/catalog").set(as("owner")).expect(200)).body;
    expect(c.triggers).toEqual(expect.arrayContaining([{ event: "order.created", context: "order" }, { event: "stock.low", context: "item" }]));
    expect(c.triggers.map((t: { event: string }) => t.event)).not.toContain("stock.changed"); // plumbing, never a trigger
    expect(c.actions.map((a: { action: string }) => a.action)).toEqual(["order.add_tag", "order.assign", "notify.team"]);
    expect(c.fields.order.map((f: { field: string }) => f.field)).not.toContain("order.phone"); // no personal data

    const bad = await create({ name: "Wrong", trigger: "stock.low", conditions: { all: [{ field: "order.total", op: "gt", value: 1 }] }, steps: [{ action: "order.add_tag", params: { tags: ["x"] } }] }, 422);
    expect(bad.code).toBe("automation_invalid");
    expect(bad.errors.map((e: { code: string }) => e.code).sort()).toEqual(["field_not_in_context", "needs_order"]);
    expect((await create({ name: "x", trigger: "order.created", steps: [{ action: "order.add_tag", params: { tags: [] } }] }, 422)).errors[0].code).toBe("invalid_params");
    expect((await create({ name: "x", trigger: "order.teleported", steps: [{ action: "notify.team", params: { message: "hi" } }] }, 422)).code).toBe("validation_failed");
    expect((await create({ name: "x", trigger: "order.created", conditions: { all: [{ field: "order.secret", op: "eq", value: 1 }] }, steps: [{ action: "notify.team", params: { message: "hi" } }] }, 422)).errors[0].code).toBe("unknown_field");
  });

  it("runs once per event: conditions decide, steps tag the order and tell the team", async () => {
    const big = await create({
      name: "Big COD orders", trigger: "order.created", enabled: true,
      conditions: { all: [{ field: "order.total", op: "gte", value: 1000 }, { field: "order.paymentMode", op: "eq", value: "cod" }] },
      steps: [{ action: "order.add_tag", params: { tags: ["Big"] } }, { action: "notify.team", params: { message: "Big COD order {{order.number}} ({{order.total}})", roles: ["owner", "ops_manager"] } }],
    });
    expect(big).toMatchObject({ enabled: true, version: 1, steps: [{ action: "order.add_tag", params: { tags: ["big"] } }, { action: "notify.team" }] });
    const yes = await order("1150");
    const no = await order("500");
    expect((await orderRow(yes.id)).tags).toContain("big");
    expect((await orderRow(no.id)).tags).not.toContain("big");

    const detail = (await http().get(`/v1/automations/${big.id}`).set(as("owner")).expect(200)).body;
    const byEntity = Object.fromEntries(detail.runs.map((r: { entityId: string; status: string; reason: string | null }) => [r.entityId, `${r.status}:${r.reason}`]));
    expect(byEntity).toEqual({ [yes.id]: "succeeded:null", [no.id]: "skipped:conditions" });
    expect(detail.stats).toMatchObject({ runs: 1, failures: 0 });

    const notes = (await http().get("/v1/notifications").set(as("owner")).expect(200)).body;
    expect(notes.data[0]).toMatchObject({ text: `Big COD order ${yes.number} (1150)`, source: `automation:${big.id}`, entity: { type: "order", id: yes.id }, read: false });
    expect(notes.unread).toBe(1);
    expect((await http().get("/v1/notifications").set(as("agent")).expect(200)).body.data).toEqual([]); // not for agents
    expect((await http().post("/v1/notifications/read").set(as("owner")).send({ all: true }).expect(200)).body).toEqual({ marked: 1 });
    expect((await http().get("/v1/notifications").set(as("owner")).expect(200)).body.unread).toBe(0);
    await http().patch(`/v1/automations/${big.id}`).set(as("owner")).send({ enabled: false }).expect(200);
  });

  it("loop guard: two automations that undo each other stop after three links", async () => {
    await create({ name: "Unassign", trigger: "order.assigned", enabled: true, conditions: { all: [{ field: "event.data.assignedTo", op: "exists" }] }, steps: [{ action: "order.assign", params: { userId: null } }] });
    await create({ name: "Reassign", trigger: "order.assigned", enabled: true, conditions: { all: [{ field: "event.data.assignedTo", op: "not_exists" }] }, steps: [{ action: "order.assign", params: { userId: agentId } }] });
    const o = await order("300");
    await http().post("/v1/orders/bulk").set(as("owner")).send({ action: "assign", orderIds: [o.id], userId: agentId }).expect(202);
    await drain();
    const runs = await db.tenant(store, (trx) => trx.selectFrom("automation_runs").select(["depth", "status", "reason"]).where("entity_id", "=", o.id).where("event_type", "=", "order.assigned").orderBy("depth").execute());
    // depth 1: unassign (succeeds) · 2: reassign · 3: unassign · 4: stopped. Each depth also has the other automation skipped by its conditions.
    expect(runs.filter((r) => r.status === "succeeded").map((r) => r.depth)).toEqual([1, 2, 3]);
    expect(runs.filter((r) => r.reason === "loop_guard").map((r) => r.depth)).toEqual([4, 4]);
    expect((await orderRow(o.id)).assigned_to).toBeNull();
    for (const a of (await http().get("/v1/automations").set(as("owner")).expect(200)).body.data) await http().delete(`/v1/automations/${a.id}`).set(as("owner")).expect(204);
  });

  it("error guard: an automation that keeps failing pauses itself and tells the team", async () => {
    const ghost = "77777777-7777-4777-8777-777777777777";
    const a = await create({ name: "Assign to a former member", trigger: "order.created", enabled: true, steps: [{ action: "order.assign", params: { userId: ghost } }] });
    for (let i = 0; i < 5; i++) await order("200");
    const after = (await http().get(`/v1/automations/${a.id}`).set(as("owner")).expect(200)).body;
    expect(after).toMatchObject({ enabled: false, pausedReason: "errors", stats: { runs: 5, failures: 5 } });
    expect(after.runs[0]).toMatchObject({ status: "failed", reason: "the person to assign is not an active member", steps: [{ action: "order.assign", result: "failed" }] });
    const paused = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select("type").where("entity_id", "=", a.id).execute());
    expect(paused.map((e) => e.type)).toContain("automation.paused");
    expect((await http().get("/v1/notifications").set(as("owner")).expect(200)).body.data[0]).toMatchObject({ source: "automation.paused", entity: { type: "automation", id: a.id } });

    // Fixed and saved: a new version, on again, the pause cleared.
    const fixed = (await http().put(`/v1/automations/${a.id}`).set(as("owner")).send({ name: "Assign to Sara", trigger: "order.created", enabled: true, steps: [{ action: "order.assign", params: { userId: agentId } }] }).expect(200)).body;
    expect(fixed).toMatchObject({ version: 2, enabled: true, pausedReason: null });
    const o = await order("250");
    expect((await orderRow(o.id)).assigned_to).toBe(agentId);
    const v2 = (await http().get(`/v1/automations/${a.id}`).set(as("owner")).expect(200)).body.runs[0];
    expect(v2).toMatchObject({ status: "succeeded", version: 2 });
    await http().delete(`/v1/automations/${a.id}`).set(as("owner")).expect(204);
  });

  it("a dry run shows each rule's actual value and changes nothing", async () => {
    const a = await create({
      name: "Risky COD", trigger: "order.scored",
      conditions: { any: [{ field: "order.total", op: "gt", value: 5000 }, { field: "order.city", op: "contains", value: "nasr" }] },
      steps: [{ action: "order.add_tag", params: { tags: ["check"] } }, { action: "notify.team", params: { message: "Check {{order.number}}" } }],
    });
    const o = await order("900");
    const r = (await http().post(`/v1/automations/${a.id}/test`).set(as("owner")).send({ orderId: o.id }).expect(200)).body;
    expect(r.matched).toBe(true);
    expect(r.rules).toEqual([
      { field: "order.total", op: "gt", value: 5000, actual: 900, pass: false },
      { field: "order.city", op: "contains", value: "nasr", actual: "Nasr City", pass: true },
    ]);
    expect(r.steps[1]).toMatchObject({ action: "notify.team", params: { message: `Check ${o.number}` }, note: null });
    expect((await orderRow(o.id)).tags).not.toContain("check");
    const scored = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select("id").where("type", "=", "order.created").where("entity_id", "=", o.id).executeTakeFirstOrThrow());
    expect((await http().post(`/v1/automations/${a.id}/test`).set(as("owner")).send({ eventId: scored.id }).expect(422)).body.code).toBe("wrong_trigger");
  });

  it("recipes install once as the store's own copy, off until turned on; the low stock alert reaches the warehouse", async () => {
    const list = (await http().get("/v1/automations/recipes?lang=en").set(as("owner")).expect(200)).body.data;
    expect(list.map((r: { key: string }) => r.key)).toEqual(expect.arrayContaining(["big_cod_order", "low_stock_alert", "waiting_for_stock"]));
    const a = (await http().post("/v1/automations/recipes/low_stock_alert/install").set(as("owner")).send({ language: "en" }).expect(201)).body;
    expect(a).toMatchObject({ recipe: "low_stock_alert", enabled: false, trigger: "stock.low", name: "Low stock alert" });
    expect((await http().post("/v1/automations/recipes/low_stock_alert/install").set(as("owner")).send({}).expect(409)).body.code).toBe("recipe_installed");
    await http().post("/v1/automations/recipes/nope/install").set(as("owner")).send({}).expect(404);
    expect((await http().get("/v1/automations/recipes?lang=ar").set(as("owner")).expect(200)).body.data.find((r: { key: string }) => r.key === "low_stock_alert")).toMatchObject({ installed: a.id, name: "تنبيه المخزون القليل" });

    await http().patch(`/v1/automations/${a.id}`).set(as("owner")).send({ enabled: true }).expect(200);
    const variantId = await db.tenant(store, async (trx) => {
      const p = await trx.insertInto("products").values({ tenant_id: store, title: "Tote bag" }).returning("id").executeTakeFirstOrThrow();
      return (await trx.insertInto("variants").values({ tenant_id: store, product_id: p.id, sku: "BAG-TT", currency: "EGP" }).returning("id").executeTakeFirstOrThrow()).id;
    });
    await http().post("/v1/stock/movements").set(as("owner")).send({ items: [{ variantId, kind: "count", quantity: 10 }] }).expect(200);
    await http().patch(`/v1/stock/${variantId}`).set(as("owner")).send({ lowStockAt: 5 }).expect(200);
    await http().post("/v1/stock/movements").set(as("owner")).send({ items: [{ variantId, kind: "adjust", quantity: -6, reason: "damaged" }] }).expect(200);
    await drain();
    const notes = (await http().get("/v1/notifications").set(as("owner")).expect(200)).body.data;
    expect(notes[0]).toMatchObject({ text: "BAG-TT is running low: 4 left", entity: { type: "variant", id: variantId } });
  });

  it("is for managers", async () => {
    await http().get("/v1/automations").set(as("agent")).expect(403);
    await http().get("/v1/catalog").set(as("agent")).expect(403);
    await http().post("/v1/automations/00000000-0000-4000-8000-000000000000/test").set(as("owner")).send({ orderId: "00000000-0000-4000-8000-000000000001" }).expect(404);
  });
});
