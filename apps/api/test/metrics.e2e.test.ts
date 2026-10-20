import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { FakeVerifier } from "./support/fake-auth.js";

const TOKEN = "metrics-token-0123456789abcdef";
const T = "aaaaaaaa-0000-4000-8000-000000000001";
const fake = new FakeVerifier();
let app: INestApplication;
const http = () => request(app.getHttpServer());
const scrape = async () => (await http().get("/metrics").set("Authorization", `Bearer ${TOKEN}`).expect(200)).text;

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "http://localhost", WEB_URL: "http://localhost:3000", METRICS_TOKEN: TOKEN });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  fake.add("owner", { uid: "fb-owner" });
});
afterAll(() => app.close());

describe("GET /metrics", () => {
  it("requires the metrics token", async () => {
    await http().get("/metrics").expect(401);
    await http().get("/metrics").set("Authorization", "Bearer wrong-token-0123456789abcdef").expect(401);
    expect(await scrape()).toContain("mizan_http_request_duration_seconds");
  });

  it("labels HTTP latency by route template, never by raw path or id", async () => {
    const store = (await http().post("/v1/tenants").set("Authorization", "Bearer owner").send({ name: "Metrics Store", country: "EG" }).expect(201)).body.id;
    await http().patch(`/v1/members/${crypto.randomUUID()}`).set({ Authorization: "Bearer owner", "X-Tenant-Id": store }).send({ role: "agent" });
    await http().get("/no/such/route").expect(404);
    const text = await scrape();
    expect(text).toMatch(/mizan_http_request_duration_seconds_count\{method="POST",route="\/v1\/tenants",status="2xx"\} 1/);
    expect(text).toMatch(/route="\/v1\/members\/:userId",status="4xx"/);
    expect(text).toMatch(/route="unmatched",status="4xx"/);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/); // no ids in any label
  });

  it("reports engine queue and event dispatch state", async () => {
    const db = app.get(Database);
    await db.kysely.insertInto("tenants").values({ id: T, name: "Q", slug: "q" }).execute();
    const job = (status: string, i: number) => ({
      id: crypto.randomUUID(), tenant_id: T, kind: "k", connection: "shopify", payload: "{}", idempotency_key: `m-${i}`,
      status, next_attempt_at: Date.now() - 120_000, created_at: 1, updated_at: 1,
    });
    await db.kysely.insertInto("mz_outbox").values([job("pending", 1), job("pending", 2), job("dead", 3)]).execute();
    const text = await scrape();
    expect(text).toMatch(/mizan_outbox_jobs\{status="pending"\} 2/);
    expect(text).toMatch(/mizan_outbox_jobs\{status="dead"\} 1/);
    const age = Number(/^mizan_outbox_oldest_due_seconds (\S+)$/m.exec(text)![1]);
    expect(age).toBeGreaterThanOrEqual(119);
    expect(text).toMatch(/mizan_domain_events\{state="pending"\} \d+/);
    expect(text).toMatch(/mizan_engine_circuits_open\{provider="shopify"\} 0/);
    expect(text).toContain("mizan_process_cpu_seconds_total");
  });
});

describe("label hygiene and the worker endpoint", () => {
  it("does not mint a series per unknown webhook path", async () => {
    for (const p of ["evil-1", "evil-2"]) await http().post(`/webhooks/${p}/x`).send("{}");
    const text = await scrape();
    expect(text).not.toContain("evil");
    expect(text).toMatch(/mizan_webhooks_total\{provider="other",status="404"\} 2/);
  });

  it("the worker serves /health openly and /metrics behind the same token", async () => {
    const { startWorkerServer } = await import("../src/platform/metrics/worker-server.js");
    const { MetricsService } = await import("../src/platform/metrics/metrics.service.js");
    const server = await startWorkerServer(0, app.get(MetricsService), TOKEN);
    try {
      await request(server).get("/health").expect(200, { status: "ok", role: "worker" });
      await request(server).get("/metrics").expect(401);
      const ok = await request(server).get("/metrics").set("Authorization", `Bearer ${TOKEN}`).expect(200);
      expect(ok.text).toContain("mizan_outbox_jobs");
      await request(server).get("/v1/me").expect(404);
    } finally {
      server.close();
    }
  });
});
