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
import { DEFAULT_CONFIRMATION } from "../src/modules/confirmation/confirmation.settings.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E6-3: the team's call queue. Orders the cascade hands to the team wait in one queue; "next"
 * claims the oldest for the caller (theirs first), two callers never get the same customer, a
 * call nobody answered comes back at the retry time, and an answered order leaves the queue.
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
async function placeOrder(): Promise<string> {
  n++;
  const r = await http().post("/v1/orders").set(as("owner")).send({
    source: "phone", customer: { name: "Mona Adel", phone: `0100${String(1000000 + n)}` }, address: { line1: "12 Abbas El Akkad St", city: "Nasr City" },
    lines: [{ title: "Abaya", quantity: 1, unitPrice: "1150" }], payment: { mode: "cod" },
  }).expect(201);
  await drain();
  return r.body.id;
}
const next = async (who: string) => (await http().post("/v1/confirmation/queue/next").set(as(who)).expect(200)).body.order as { id: string; number: string; attempts: number } | null;
const queue = async (who: string) => (await http().get("/v1/confirmation/queue").set(as(who)).expect(200)).body;

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null); // no channels: every order goes to the team's calls
  fake.add("owner", { uid: "fb-owner-queue", email: "owner@queue.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Calls", country: "EG" }).expect(201)).body.id;
  await db.tenant(store, async (trx) => {
    const t = await trx.selectFrom("tenants").select("settings").where("id", "=", store).executeTakeFirstOrThrow();
    await trx.updateTable("tenants").set({ settings: JSON.stringify({
      ...(t.settings as object), orders: { duplicateWindowHours: 0 },
      confirmation: { ...DEFAULT_CONFIRMATION, callingHours: { start: "00:00", end: "23:59" }, teamCalls: { attempts: 3, retryMinutes: 30 } },
    }) }).where("id", "=", store).execute();
  });
  const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone: "01201116666", role: "agent" }).expect(201);
  fake.add("agent", { uid: "fb-agent-queue", phone: inv.body.phone });
  await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: "Bearer agent" }).expect(200);
  agentId = (await http().get("/v1/me").set({ Authorization: "Bearer agent" }).expect(200)).body.user.id;
});
afterAll(() => app.close());

describe("the team's call queue (E6-3)", () => {
  it("next claims the oldest order for the caller; two callers never get the same one; theirs first", async () => {
    expect(await next("agent")).toBeNull();
    const [a, b, c] = [await placeOrder(), await placeOrder(), await placeOrder()];
    expect(await queue("owner")).toMatchObject({ waiting: 3, mine: 0, later: 0 });

    const first = await next("agent");
    expect(first).toMatchObject({ id: a, attempts: 0 });
    const assigned = await db.tenant(store, (trx) => trx.selectFrom("orders").select("assigned_to").where("id", "=", a).executeTakeFirstOrThrow());
    expect(assigned.assigned_to).toBe(agentId);
    expect(await next("agent")).toMatchObject({ id: a }); // still mine: the same order until it is answered
    expect(await queue("agent")).toMatchObject({ waiting: 3, mine: 1 });
    expect(await queue("owner")).toMatchObject({ waiting: 2 }); // the agent's order is not the owner's to call

    const [x, y] = await Promise.all([next("owner"), next("owner")]);
    expect([x?.id, y?.id].sort()).toEqual([b, b].sort()); // the owner's own claim comes back, never the agent's
    expect(c).toBeTruthy();
  });

  it("no answer → back at the retry time; answered → gone; the agent's order list shows what they claimed", async () => {
    const mine = (await next("agent"))!;
    const na = await http().post(`/v1/orders/${mine.id}/confirmation/no-answer`).set(as("agent")).expect(200);
    expect(na.body).toMatchObject({ attempts: 1, max: 3, unreachable: false });
    expect(await queue("agent")).toMatchObject({ later: 1 });
    const following = (await next("agent"))!;
    expect(following.id).not.toBe(mine.id); // the retry is not due yet: the next unassigned order
    await http().post(`/v1/orders/${following.id}/confirmation`).set(as("agent")).send({ answer: "confirm", byCall: true }).expect(200);
    expect((await db.tenant(store, (trx) => trx.selectFrom("orders").select("status").where("id", "=", following.id).executeTakeFirstOrThrow())).status).toBe("confirmed");

    // The retry comes due: it is the agent's again, first.
    await db.tenant(store, (trx) => trx.updateTable("confirmation_runs").set({ call_after: new Date(Date.now() - 1000) }).where("order_id", "=", mine.id).execute());
    expect(await next("agent")).toMatchObject({ id: mine.id, attempts: 1 });
    const list = (await http().get("/v1/orders?confirmation=needs_call").set(as("agent")).expect(200)).body;
    expect(list.data.map((o: { id: string }) => o.id)).toContain(mine.id);
  });
});
