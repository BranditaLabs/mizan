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
 * E10-1: tickets numbered per store, linked to their order, with a fixed reason, an assignee,
 * a deadline and a history; one open case of a kind per order; closed is final. Agents work their
 * own tickets and the unassigned queue; warehouse reads and adds notes.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
const ids: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
const order = async () => {
  const r = await http().post("/v1/orders").set(as("owner")).send({
    source: "phone", customer: { name: "Mona Adel", phone: "01001234821" }, address: { line1: "12 Abbas El Akkad St", city: "Nasr City" },
    lines: [{ title: "Abaya", quantity: 1, unitPrice: "1000" }], shipping: "0", payment: { mode: "cod" },
  }).expect(201);
  await drain();
  return r.body as { id: string; number: string };
};
const list = async (token: string, q = "") => (await http().get(`/v1/tickets${q}`).set(as(token)).expect(200)).body;

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null);
  fake.add("owner", { uid: "fb-owner-tickets", email: "owner@tickets.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Tickets", country: "EG" }).expect(201)).body.id;
  for (const [token, role, phone] of [["agent", "agent", "01201116661"], ["agent2", "agent", "01201116662"], ["ops", "ops_manager", "01201116663"], ["wh", "warehouse", "01201116664"]] as const) {
    const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone, role }).expect(201);
    fake.add(token, { uid: `fb-${token}-tickets`, phone: inv.body.phone });
    await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: `Bearer ${token}` }).expect(200);
    ids[token] = (await http().get("/v1/me").set({ Authorization: `Bearer ${token}` }).expect(200)).body.user.id;
  }
  ids.owner = (await http().get("/v1/me").set({ Authorization: "Bearer owner" }).expect(200)).body.user.id;
});
afterAll(() => app.close());

describe("tickets (E10-1)", () => {
  it("opens a ticket on an order by its number; one open case of a kind per order; history, event and audit hold no customer words", async () => {
    const o = await order();
    const before = Date.now();
    const r = await http().post("/v1/tickets").set(as("owner")).send({ type: "exchange", reason: "wrong_size", orderNumber: o.number, description: "Mona wants an L instead of an M", source: "whatsapp" }).expect(201);
    expect(r.body).toMatchObject({
      number: "T-1001", type: "exchange", reason: "wrong_size", status: "open", source: "whatsapp", order: { id: o.id, number: o.number, status: expect.any(String) },
      assignee: null, late: false, description: "Mona wants an L instead of an M", canEdit: true, resolvedAt: null, closedAt: null,
    });
    const due = new Date(r.body.dueAt).getTime();
    expect(due - before).toBeGreaterThan(23.9 * 3600_000);
    expect(due - before).toBeLessThan(24.1 * 3600_000);
    expect(r.body.history).toEqual([expect.objectContaining({ type: "created", data: { type: "exchange", reason: "wrong_size" }, note: null })]);
    expect(r.body.assignees.map((a: { role: string }) => a.role)).toEqual(expect.arrayContaining(["owner", "agent", "ops_manager", "warehouse"]));

    await http().post("/v1/tickets").set(as("owner")).send({ type: "exchange", orderId: o.id }).expect(409).expect((x) => expect(x.body.code).toBe("ticket_open"));
    const other = await http().post("/v1/tickets").set(as("owner")).send({ type: "complaint", reason: "late_delivery", orderId: o.id }).expect(201);
    expect(other.body.number).toBe("T-1002");

    await drain();
    const ev = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select(["type", "data", "entity_type"]).where("entity_id", "=", r.body.id).execute());
    expect(ev).toEqual([{ type: "ticket.created", entity_type: "ticket", data: expect.objectContaining({ number: "T-1001", type: "exchange", reason: "wrong_size", orderId: o.id, source: "whatsapp" }) }]);
    const audit = await db.tenant(store, (trx) => trx.selectFrom("audit_log").select(["action", "after"]).where("entity_id", "=", r.body.id).execute());
    expect(audit).toEqual([{ action: "ticket.created", after: expect.objectContaining({ number: "T-1001" }) }]);
    expect(JSON.stringify([ev, audit])).not.toContain("Mona");

    await http().post("/v1/tickets").set(as("owner")).send({ type: "refund", orderNumber: "#99999" }).expect(422);
    await http().post("/v1/tickets").set(as("owner")).send({ type: "refund", reason: "too_slow" }).expect(422);
    await http().post("/v1/tickets").set(as("owner")).send({ type: "refund", orderId: o.id, orderNumber: o.number }).expect(422);
    await http().post("/v1/tickets").set(as("wh")).send({ type: "refund" }).expect(403);
  });

  it("moves through its statuses, can be reopened once resolved, and is final once closed", async () => {
    const t = (await http().post("/v1/tickets").set(as("owner")).send({ type: "delivery_issue", reason: "not_delivered" }).expect(201)).body;
    const patch = (body: object, token = "owner") => http().patch(`/v1/tickets/${t.id}`).set(as(token)).send(body);
    await patch({ status: "waiting_courier", note: "Asked Bosta for the driver's report" }).expect(200);
    const resolved = (await patch({ status: "resolved" }).expect(200)).body;
    expect(resolved.resolvedAt).toEqual(expect.any(String));
    const reopened = (await patch({ status: "open", reason: "courier_behaviour" }).expect(200)).body;
    expect(reopened).toMatchObject({ status: "open", reason: "courier_behaviour", resolvedAt: null });
    const closed = (await patch({ status: "closed" }).expect(200)).body;
    expect(closed).toMatchObject({ status: "closed", canEdit: false, closedAt: expect.any(String), resolvedAt: expect.any(String) });
    await patch({ status: "open" }).expect(409).expect((x) => expect(x.body.code).toBe("ticket_closed"));
    await patch({ reason: "other" }).expect(409);
    const noted = (await patch({ note: "Customer called again; told them it's closed" }).expect(200)).body;
    expect(noted.history.map((h: { type: string; data: object }) => [h.type, h.data])).toEqual([
      ["note", {}], ["status", { from: "open", to: "closed" }], ["updated", { reason: { from: "not_delivered", to: "courier_behaviour" } }],
      ["status", { from: "resolved", to: "open" }], ["status", { from: "waiting_courier", to: "resolved" }], ["note", {}], ["status", { from: "open", to: "waiting_courier" }], ["created", { type: "delivery_issue", reason: "not_delivered" }],
    ]);
    await patch({}).expect(422);
    await drain();
    const ev = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select(["type", "data"]).where("entity_id", "=", t.id).where("type", "=", "ticket.status_changed").orderBy("occurred_at").execute());
    expect(ev.map((e) => `${(e.data as { from: string }).from}→${(e.data as { to: string }).to}`)).toEqual(["open→waiting_courier", "waiting_courier→resolved", "resolved→open", "open→closed"]);
  });

  it("agents work their tickets and the unassigned queue; warehouse reads and adds notes", async () => {
    const mine = (await http().post("/v1/tickets").set(as("agent")).send({ type: "complaint", reason: "quality" }).expect(201)).body;
    expect(mine.assignee).toMatchObject({ id: ids.agent });
    expect(mine.assignees).toEqual([expect.objectContaining({ id: ids.agent, role: "agent" })]);
    const queue = (await http().post("/v1/tickets").set(as("owner")).send({ type: "return", reason: "changed_mind" }).expect(201)).body;
    const theirs = (await http().post("/v1/tickets").set(as("owner")).send({ type: "return", reason: "damaged", assignedTo: ids.agent2 }).expect(201)).body;

    const seen = (await list("agent", "?view=all&limit=100")).data.map((t: { id: string }) => t.id);
    expect(seen).toEqual(expect.arrayContaining([mine.id, queue.id]));
    expect(seen).not.toContain(theirs.id);
    await http().get(`/v1/tickets/${theirs.id}`).set(as("agent")).expect(404);

    await http().patch(`/v1/tickets/${queue.id}`).set(as("agent")).send({ assignedTo: ids.agent2 }).expect(403);
    const taken = (await http().patch(`/v1/tickets/${queue.id}`).set(as("agent")).send({ assignedTo: ids.agent, status: "waiting_customer" }).expect(200)).body;
    expect(taken).toMatchObject({ assignee: { id: ids.agent }, status: "waiting_customer" });
    expect((await list("agent", "?mine=true&view=all")).data.map((t: { id: string }) => t.id).sort()).toEqual([mine.id, queue.id].sort());
    await http().patch(`/v1/tickets/${theirs.id}`).set(as("ops")).send({ assignedTo: ids.wh }).expect(200);
    await http().patch(`/v1/tickets/${theirs.id}`).set(as("ops")).send({ assignedTo: "00000000-0000-4000-8000-000000000000" }).expect(422);

    await http().patch(`/v1/tickets/${theirs.id}`).set(as("wh")).send({ status: "in_inspection" }).expect(403);
    const note = (await http().patch(`/v1/tickets/${theirs.id}`).set(as("wh")).send({ note: "Box arrived torn" }).expect(200)).body;
    expect(note).toMatchObject({ canEdit: false, history: expect.arrayContaining([expect.objectContaining({ type: "note", note: "Box arrived torn" })]) });
    await drain();
    const assigned = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select("data").where("entity_id", "=", queue.id).where("type", "=", "ticket.assigned").execute());
    expect(assigned).toEqual([{ data: expect.objectContaining({ number: queue.number, assignedTo: ids.agent }) }]);
  });

  it("lists by status group with counts, finds by ticket or order number, shows what is late, and pages", async () => {
    const o = await order();
    const t = (await http().post("/v1/tickets").set(as("ops")).send({ type: "refused", reason: "changed_mind", orderId: o.id }).expect(201)).body;
    await db.tenant(store, (trx) => trx.updateTable("tickets").set({ due_at: new Date(Date.now() - 60_000) }).where("id", "=", t.id).execute());

    const all = await list("owner", "?view=all&limit=100");
    const counts = all.counts;
    expect(counts.active).toBe(counts.open + counts.waiting + counts.inspection);
    expect(counts.active + counts.resolved + counts.closed).toBe(all.data.length);
    expect(counts.late).toBe(1);
    expect((await list("owner", "?view=late")).data.map((x: { id: string }) => x.id)).toEqual([t.id]);
    expect((await list("owner", "?view=late")).data[0].late).toBe(true);
    expect((await list("owner", "?view=closed")).data.every((x: { status: string }) => x.status === "closed")).toBe(true);
    expect((await list("owner", `?q=${t.number}&view=all`)).data.map((x: { id: string }) => x.id)).toEqual([t.id]);
    expect((await list("owner", `?q=${t.number.slice(2)}&view=all`)).data.map((x: { id: string }) => x.id)).toEqual([t.id]);
    expect((await list("owner", `?q=${encodeURIComponent(o.number)}&view=all`)).data.map((x: { id: string }) => x.id)).toEqual([t.id]);
    expect((await list("owner", `?orderId=${o.id}&view=all`)).data.map((x: { id: string }) => x.id)).toEqual([t.id]);
    expect((await list("owner", "?type=refused&view=all")).data.map((x: { id: string }) => x.id)).toEqual([t.id]);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { data: Array<{ id: string }>; nextCursor: string | null } = await list("owner", `?view=all&limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...page.data.map((x) => x.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(all.data.map((x: { id: string }) => x.id));
    await http().get("/v1/tickets?cursor=nope").set(as("owner")).expect(422);
  });

  it("ticket events are automation triggers with the ticket's order as context", async () => {
    const c = (await http().get("/v1/catalog").set(as("owner")).expect(200)).body;
    expect(c.triggers).toEqual(expect.arrayContaining([{ event: "ticket.created", context: "order" }, { event: "ticket.status_changed", context: "order" }, { event: "ticket.assigned", context: "order" }]));
  });
});
