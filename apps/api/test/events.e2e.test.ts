import "reflect-metadata";
import { Writable } from "node:stream";
import { Injectable, Module, type INestApplication } from "@nestjs/common";
import type { Transaction } from "kysely";
import { sql } from "kysely";
import type { DB } from "@mizan/db";
import type { DomainEvent } from "@mizan/shared";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { EventConsumer, type EventHandler } from "../src/platform/events/consumer.js";
import { backoffMs, DISPATCH, EventDispatcher } from "../src/platform/events/dispatcher.js";
import { EventsService } from "../src/platform/events/events.service.js";
import { FakeVerifier } from "./support/fake-auth.js";

/** Records every delivery and writes a row in the same transaction (its "effect"). */
@Injectable()
@EventConsumer({ name: "test.ledger", events: ["tenant.created", "member.*"] })
class Ledger implements EventHandler {
  calls: string[] = [];
  /** Throw after writing the effect this many more times (simulates a crash mid-consumer). */
  failNext = 0;

  async handle(event: DomainEvent, trx: Transaction<DB>): Promise<void> {
    this.calls.push(event.id);
    await trx.insertInto("warehouses").values({ tenant_id: event.tenantId, name: `effect:${event.id}` }).execute();
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("ledger crashed for customer 01001234821");
    }
  }
}

/** A second consumer on the same events, to prove consumers are isolated from each other. */
@Injectable()
@EventConsumer({ name: "test.flaky", events: ["member.invited"] })
class Flaky implements EventHandler {
  calls = 0;
  alwaysFail = false;
  async handle(): Promise<void> {
    this.calls++;
    if (this.alwaysFail) throw new Error("downstream unavailable");
  }
}

@Module({ providers: [Ledger, Flaky] })
class ConsumersModule {}

const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let dispatcher: EventDispatcher;
let ledger: Ledger;
let flaky: Flaky;
const http = () => request(app.getHttpServer());
const as = (token: string, tenant?: string) => ({ Authorization: `Bearer ${token}`, ...(tenant ? { "X-Tenant-Id": tenant } : {}) });

const effects = async (tenantId: string, eventId: string) =>
  (await db.tenant(tenantId, (trx) => trx.selectFrom("warehouses").select("id").where("name", "=", `effect:${eventId}`).execute())).length;
const event = (id: string) => db.kysely.selectFrom("domain_events").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
/** Pretend time passed: expire leases and backoffs. */
const timePasses = () => sql`UPDATE domain_events SET locked_until = now() - interval '1 second', next_attempt_at = now() - interval '1 second' WHERE dispatched_at IS NULL`.execute(db.kysely);
const drain = async () => { while ((await dispatcher.runOnce()).claimed > 0) { /* until empty */ } };

let owners = 0;
/** A new store (and owner, to stay under the per-account store cap); returns its tenant.created event. */
async function newStore(name: string): Promise<{ tenantId: string; eventId: string }> {
  const owner = fake.add(`owner-${++owners}`, { uid: `fb-owner-${owners}` });
  const res = await http().post("/v1/tenants").set(as(owner)).send({ name, country: "EG" }).expect(201);
  fake.add("owner", { uid: `fb-owner-${owners}` });
  const ev = await db.kysely.selectFrom("domain_events").select("id").where("tenant_id", "=", res.body.id).where("type", "=", "tenant.created").executeTakeFirstOrThrow();
  return { tenantId: res.body.id, eventId: ev.id };
}

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "http://localhost", WEB_URL: "http://localhost:3000" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake, modules: [ConsumersModule] });
  await app.init();
  db = app.get(Database);
  dispatcher = app.get(EventDispatcher);
  ledger = app.get(Ledger);
  flaky = app.get(Flaky);
  fake.add("owner", { uid: "fb-owner" });
});
afterAll(() => app.close());
beforeEach(async () => {
  await drain();
  ledger.calls = [];
  ledger.failNext = 0;
  flaky.calls = 0;
  flaky.alwaysFail = false;
});

describe("outbox writer", () => {
  it("the event commits with the state change, not before, and only for its tenant", async () => {
    const { tenantId, eventId } = await newStore("Outbox Store");
    expect(await event(eventId)).toMatchObject({ type: "tenant.created", entity_type: "tenant", entity_id: tenantId, dispatched_at: null, attempts: 0 });

    const events = app.get(EventsService);
    await expect(db.tenant(tenantId, async (trx) => {
      await events.emit(trx, { type: "order.created", tenantId, entity: { type: "order", id: tenantId } });
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    expect(await db.kysely.selectFrom("domain_events").select("id").where("type", "=", "order.created").execute()).toEqual([]);

    const { tenantId: other } = await newStore("Other Store");
    await expect(db.tenant(tenantId, (trx) => events.emit(trx, { type: "order.created", tenantId: other, entity: { type: "order", id: other } })))
      .rejects.toThrow(/row-level security/);
  });

  it("team changes emit events carrying ids and facts, not personal data", async () => {
    const { tenantId } = await newStore("Team Store");
    await http().post("/v1/members/invite").set(as("owner", tenantId)).send({ phone: "01001234821", role: "agent" }).expect(201);
    const rows = await db.kysely.selectFrom("domain_events").select(["type", "data", "actor"]).where("tenant_id", "=", tenantId).orderBy("occurred_at").execute();
    expect(rows.map((r) => r.type)).toEqual(["tenant.created", "member.invited"]);
    expect(rows[1]!.data).toEqual({ role: "agent", channel: "phone", refreshed: false });
    expect(JSON.stringify(rows)).not.toMatch(/1001234821|@/);
  });
});

describe("dispatcher", () => {
  it("delivers events committed while no dispatcher was running (crash between commit and dispatch), once", async () => {
    const { tenantId, eventId } = await newStore("Crash Store A");
    expect(ledger.calls).toEqual([]); // nothing dispatched yet: the "crash"
    await drain();
    await drain();
    expect(ledger.calls).toEqual([eventId]);
    expect(await effects(tenantId, eventId)).toBe(1);
    expect((await event(eventId)).dispatched_at).toBeInstanceOf(Date);
  });

  it("a crash after the consumer committed but before the event was marked done does not deliver twice", async () => {
    const { tenantId, eventId } = await newStore("Crash Store B");
    const [claimed] = await dispatcher.claim(10);
    expect(claimed!.event.id).toBe(eventId);
    expect(await dispatcher.process(claimed!.event)).toBeUndefined(); // consumer committed…
    // …and the worker dies here: no finish(). The lease is still held:
    expect(await dispatcher.claim(10)).toEqual([]);
    await timePasses(); // lease expires
    await drain();
    expect(ledger.calls).toEqual([eventId]);
    expect(await effects(tenantId, eventId)).toBe(1);
    expect((await event(eventId)).dispatched_at).toBeInstanceOf(Date);
  });

  it("a crash inside the consumer rolls back its effect and retries later with backoff", async () => {
    ledger.failNext = 1;
    const { tenantId, eventId } = await newStore("Crash Store C");
    const first = await dispatcher.runOnce();
    expect(first).toMatchObject({ claimed: 1, failed: 1 });
    const failed = await event(eventId);
    expect(failed).toMatchObject({ attempts: 1, dispatched_at: null, locked_until: null });
    expect(failed.next_attempt_at.getTime()).toBeGreaterThanOrEqual(Date.now() - 1000);
    expect(failed.last_error).toContain("010•••4821"); // scrubbed
    expect(failed.last_error).not.toContain("01001234821");
    expect(await effects(tenantId, eventId)).toBe(0); // rolled back with the failure

    await timePasses();
    await drain();
    expect(ledger.calls).toEqual([eventId, eventId]);
    expect(await effects(tenantId, eventId)).toBe(1);
    expect(await event(eventId)).toMatchObject({ attempts: 2, last_error: null });
  });

  it("a failing consumer does not re-run the ones that succeeded", async () => {
    const { tenantId } = await newStore("Partial Store");
    await drain();
    flaky.alwaysFail = true;
    const inv = await http().post("/v1/members/invite").set(as("owner", tenantId)).send({ email: "a@b.test", role: "agent" }).expect(201);
    const ev = await db.kysely.selectFrom("domain_events").select("id").where("entity_id", "=", inv.body.id).executeTakeFirstOrThrow();
    ledger.calls = [];
    await dispatcher.runOnce();
    flaky.alwaysFail = false;
    await timePasses();
    await drain();
    expect(ledger.calls).toEqual([ev.id]);
    expect(flaky.calls).toBe(2);
    expect((await event(ev.id)).dispatched_at).toBeInstanceOf(Date);
  });

  it("an event that keeps failing is dead-lettered after max attempts", async () => {
    const { tenantId } = await newStore("Dead Store");
    await drain();
    flaky.alwaysFail = true;
    const inv = await http().post("/v1/members/invite").set(as("owner", tenantId)).send({ email: "c@d.test", role: "agent" }).expect(201);
    const ev = await db.kysely.selectFrom("domain_events").select("id").where("entity_id", "=", inv.body.id).executeTakeFirstOrThrow();
    for (let i = 0; i < DISPATCH.maxAttempts; i++) {
      await dispatcher.runOnce();
      await timePasses();
    }
    const dead = await event(ev.id);
    expect(dead.attempts).toBe(DISPATCH.maxAttempts);
    expect(dead.dead_at).toBeInstanceOf(Date);
    expect(dead.last_error).toBe("test.flaky: downstream unavailable");
    expect(await dispatcher.claim(10)).toEqual([]);
  });

  it("concurrent dispatch cycles never deliver an event twice", async () => {
    const stores = await Promise.all(["P1", "P2", "P3", "P4", "P5"].map((n) => newStore(`Parallel ${n}`)));
    ledger.calls = [];
    await Promise.all([dispatcher.runOnce(2), dispatcher.runOnce(2), dispatcher.runOnce(2), dispatcher.runOnce(2)]);
    await drain();
    expect([...ledger.calls].sort()).toEqual(stores.map((s) => s.eventId).sort());
    for (const s of stores) expect(await effects(s.tenantId, s.eventId)).toBe(1);
  });

  it("the start/stop loop delivers new events", async () => {
    const { eventId } = await newStore("Loop Store");
    dispatcher.start();
    for (let i = 0; i < 50 && !ledger.calls.includes(eventId); i++) await new Promise((r) => setTimeout(r, 20));
    await dispatcher.stop();
    expect(ledger.calls).toContain(eventId);
  });

  it("knows its consumers", () => {
    expect(dispatcher.consumerNames()).toEqual(expect.arrayContaining(["test.ledger", "test.flaky"]));
  });
});

describe("backoffMs", () => {
  it("grows exponentially with full jitter and caps at an hour", () => {
    expect(backoffMs(1, () => 0.999)).toBe(1998);
    expect(backoffMs(5, () => 0.5)).toBe(16_000);
    expect(backoffMs(30, () => 0.999)).toBe(3_596_400);
    expect(backoffMs(3, () => 0)).toBe(0);
  });
});
