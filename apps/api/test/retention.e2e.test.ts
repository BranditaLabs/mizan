import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { RetentionService } from "../src/platform/maintenance/retention.service.js";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const DAY = 86_400_000;
const NOW = Date.parse("2026-10-20T12:00:00Z");

let app: INestApplication;
let db: Database;

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "http://localhost", WEB_URL: "http://localhost:3000" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }) });
  await app.init();
  db = app.get(Database);
  const k = db.kysely;
  await k.insertInto("tenants").values([{ id: A, name: "A", slug: "a" }, { id: B, name: "B", slug: "b" }]).execute();
  let n = 0;
  const job = (tenant: string, status: string, ageDays: number) => ({
    id: crypto.randomUUID(), tenant_id: tenant, kind: "k", connection: "shopify", payload: "{}", idempotency_key: `job-${n++}`,
    status, next_attempt_at: NOW, created_at: NOW - ageDays * DAY, updated_at: NOW - ageDays * DAY,
  });
  await k.insertInto("mz_outbox").values([
    job(A, "done", 8), job(B, "done", 9), job(A, "done", 8), job(A, "done", 2), // 3 old done, 1 recent
    job(A, "pending", 30), job(A, "running", 30), job(B, "dead", 30), // never pruned
  ]).execute();
  await k.insertInto("mz_inbound_events").values([
    { tenant_id: A, key: "old-1", received_at: NOW - 15 * DAY }, { tenant_id: B, key: "old-2", received_at: NOW - 20 * DAY },
    { tenant_id: A, key: "new-1", received_at: NOW - DAY },
  ]).execute();
  const ev = (dispatchedDaysAgo: number | null, dead = false) => ({
    id: crypto.randomUUID(), tenant_id: A, type: "order.created", entity_type: "order", entity_id: A,
    occurred_at: new Date(NOW - 60 * DAY), dispatched_at: dispatchedDaysAgo === null ? null : new Date(NOW - dispatchedDaysAgo * DAY),
    dead_at: dead ? new Date(NOW - 40 * DAY) : null,
  });
  const oldEvent = ev(31);
  await k.insertInto("domain_events").values([oldEvent, ev(5), ev(null), ev(null, true)]).execute();
  await k.insertInto("event_deliveries").values({ consumer: "c", event_id: oldEvent.id, tenant_id: A }).execute();
  const user = (await k.insertInto("users").values({ firebase_uid: "u1" }).returning("id").executeTakeFirstOrThrow()).id;
  await k.insertInto("idempotency_keys").values([
    { actor_id: user, key: "expired", request_hash: "h", status: "done", expires_at: new Date(NOW - 1000) },
    { actor_id: user, key: "valid", request_hash: "h", status: "done", expires_at: new Date(NOW + 3600_000) },
  ]).execute();
});
afterAll(() => app.close());

describe("RetentionService", () => {
  it("prunes finished and expired rows across tenants, in batches, and never live or dead work", async () => {
    const result = await app.get(RetentionService).runOnce(NOW, 1, 50); // batch of 1: proves the loop
    expect(result).toEqual({ doneJobs: 3, webhookKeys: 2, dispatchedEvents: 1, idempotencyKeys: 1 });

    const jobs = await db.kysely.selectFrom("mz_outbox").select(["status", "updated_at"]).orderBy("status").execute();
    expect(jobs.map((j) => j.status)).toEqual(["dead", "done", "pending", "running"]);
    expect((await db.kysely.selectFrom("mz_inbound_events").select("key").execute()).map((r) => r.key)).toEqual(["new-1"]);
    const events = await db.kysely.selectFrom("domain_events").select(["dispatched_at", "dead_at"]).execute();
    expect(events).toHaveLength(3); // recent dispatched, pending, dead
    expect(await db.kysely.selectFrom("event_deliveries").selectAll().execute()).toEqual([]); // cascaded
    expect((await db.kysely.selectFrom("idempotency_keys").select("key").execute()).map((r) => r.key)).toEqual(["valid"]);

    expect(await app.get(RetentionService).runOnce(NOW)).toEqual({ doneJobs: 0, webhookKeys: 0, dispatchedEvents: 0, idempotencyKeys: 0 });
  });
});
