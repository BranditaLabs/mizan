import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { MetricsService } from "../src/platform/metrics/metrics.service.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * A-4: system health for super admins and engineers. Its job, event and pool numbers are the ones
 * /metrics reports; stores with the most trouble come first; dead letters from any store can be
 * replayed, and the store sees that in its audit log. No payloads leave the store.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let a: string;
let b: string;
const deadA = crypto.randomUUID();
const http = () => request(app.getHttpServer());
const as = (token: string, tenant?: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", ...(tenant ? { "X-Tenant-Id": tenant } : {}) });
const later = Date.now() + 3_600_000;

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test", PLATFORM_BOOTSTRAP_EMAILS: "boss@mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  fake.add("boss", { uid: "fb-boss-a4", email: "boss@mizan.test", emailVerified: true, secondFactor: "totp" });
  fake.add("eng", { uid: "fb-eng-a4", email: "eng@mizan.test", emailVerified: true, secondFactor: "totp" });
  fake.add("help", { uid: "fb-help-a4", email: "help@mizan.test", emailVerified: true, secondFactor: "totp" });
  fake.add("owner", { uid: "fb-owner-a4", email: "owner@nile.test", emailVerified: true, secondFactor: "phone" });
  fake.add("owner2", { uid: "fb-owner2-a4", email: "owner@delta.test", emailVerified: true, secondFactor: "phone" });
  a = (await http().post("/v1/tenants").set(as("owner")).send({ name: "Nile Abayas", country: "EG" }).expect(201)).body.id;
  b = (await http().post("/v1/tenants").set(as("owner2")).send({ name: "Delta Perfumes", country: "EG" }).expect(201)).body.id;
  for (const t of ["eng", "help"]) await http().get("/v1/me").set(as(t)).expect(200);
  await http().get("/v1/platform/me").set(as("boss")).expect(200);
  await http().post("/v1/platform/staff").set(as("boss")).send({ email: "eng@mizan.test", role: "engineer" }).expect(201);
  await http().post("/v1/platform/staff").set(as("boss")).send({ email: "help@mizan.test", role: "support" }).expect(201);

  const db = app.get(Database);
  const job = (t: string, status: string, extra: Record<string, unknown> = {}) => ({
    id: crypto.randomUUID(), tenant_id: t, kind: "bosta.ship", connection: "bosta", payload: JSON.stringify({ phone: "+201001234821" }),
    idempotency_key: `a4:${crypto.randomUUID()}`, status, next_attempt_at: later, created_at: 1, updated_at: Date.now(), ...extra,
  });
  await db.tenant(a, (trx) => trx.insertInto("mz_outbox").values([
    job(a, "dead", { id: deadA, last_error: "Bosta said 400 for +201001234821", attempts: 8 }), job(a, "dead"), job(a, "pending"),
  ]).execute());
  await db.tenant(b, (trx) => trx.insertInto("mz_outbox").values([job(b, "pending"), job(b, "pending"), job(b, "dead", { kind: "shopify.pollOrders", connection: "shopify" })]).execute());
  await db.tenant(b, (trx) => trx.insertInto("domain_events").values({ tenant_id: b, type: "order.created", entity_type: "order", entity_id: crypto.randomUUID(), dead_at: new Date(), last_error: "boom" }).execute());
});
afterAll(() => app.close());

const gauge = (text: string, name: string, label?: string) => {
  const line = text.split("\n").find((l) => l.startsWith(label ? `${name}{${label}}` : `${name} `));
  return line ? Number(line.split(" ").at(-1)) : undefined;
};

describe("system health (A-4)", () => {
  it("is for super admins and engineers only", async () => {
    expect((await http().get("/v1/platform/health").set(as("help")).expect(403)).body.code).toBe("insufficient_role");
    expect((await http().get("/v1/platform/health").set(as("owner", a)).expect(403)).body.code).toBe("not_staff");
    await http().get("/v1/platform/health").set(as("eng")).expect(200);
  });

  it("shows the same queue and event numbers as /metrics, and the stores in most trouble first", async () => {
    const h = (await http().get("/v1/platform/health").set(as("eng")).expect(200)).body;
    const text = await app.get(MetricsService).registry.metrics();
    expect(h.outbox.dead).toBe(gauge(text, "mizan_outbox_jobs", 'status="dead"'));
    expect(h.outbox.pending).toBe(gauge(text, "mizan_outbox_jobs", 'status="pending"'));
    expect(h.outbox.running).toBe(gauge(text, "mizan_outbox_jobs", 'status="running"'));
    expect(h.events.dead).toBe(gauge(text, "mizan_domain_events", 'state="dead"'));
    expect(h.circuits.map((c: { provider: string; open: number }) => [c.provider, c.open]))
      .toEqual([["shopify", gauge(text, "mizan_engine_circuits_open", 'provider="shopify"')], ["bosta", gauge(text, "mizan_engine_circuits_open", 'provider="bosta"')]]);
    expect(h.outbox).toMatchObject({ dead: 3, pending: 3 });
    expect(h.deadEvents).toEqual([{ type: "order.created", count: 1 }]);
    expect(h.stores.map((s: { storeName: string; dead: number; pending: number }) => [s.storeName, s.dead, s.pending])).toEqual([["Nile Abayas", 2, 1], ["Delta Perfumes", 1, 2]]);
    expect(h.process.uptimeSeconds).toBeGreaterThan(0);
    expect(Array.isArray(h.drift)).toBe(true);
  });

  it("lists dead letters across stores without payloads or phone numbers, and replays one in its store", async () => {
    const all = (await http().get("/v1/platform/health/dead-letters").set(as("eng")).expect(200)).body.data;
    expect(all).toHaveLength(3);
    expect(JSON.stringify(all)).not.toMatch(/1001234821|payload/);
    expect((await http().get(`/v1/platform/health/dead-letters?storeId=${b}`).set(as("eng")).expect(200)).body.data.map((d: { kind: string }) => d.kind)).toEqual(["shopify.pollOrders"]);
    expect((await http().get("/v1/platform/health/dead-letters?kind=bosta.ship").set(as("eng")).expect(200)).body.data.every((d: { storeId: string }) => d.storeId === a)).toBe(true);

    expect((await http().post(`/v1/platform/health/dead-letters/${deadA}/replay`).set(as("eng")).expect(200)).body).toEqual({ replayed: true, storeId: a });
    expect((await http().post(`/v1/platform/health/dead-letters/${deadA}/replay`).set(as("eng")).expect(404)).body.code).toBe("job_not_found");
    await http().post(`/v1/platform/health/dead-letters/${crypto.randomUUID()}/replay`).set(as("eng")).expect(404);
    const log = (await http().get("/v1/audit-log?action=integration.job_replayed").set(as("owner", a)).expect(200)).body.data;
    expect(log[0]).toMatchObject({ actor: { type: "mizan_staff" }, entity: { type: "engine_job", id: deadA } });
    expect((await http().get("/v1/audit-log?action=integration.job_replayed").set(as("owner2", b)).expect(200)).body.data).toEqual([]);
  });
});
