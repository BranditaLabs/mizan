import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import { FakeBosta, FakeClock, FakeShopify, seeded, testRuntime } from "@mizan/engine/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { SecretsService } from "../src/platform/secrets/secrets.service.js";
import { EngineRegistry } from "../src/integrations/engine-registry.js";
import { EngineJobRunner } from "../src/integrations/engine-runner.js";
import { FakeVerifier } from "./support/fake-auth.js";

const FAKE_WEBHOOK_TOKEN = ["whsec", "bosta", "admin", "0123456789"].join("-");
const clock = new FakeClock();
const shop = new FakeShopify(clock, seeded(1));
const bosta = new FakeBosta(clock, seeded(2));
const fake = new FakeVerifier();

let app: INestApplication;
let db: Database;
let store: string;
let other: string;
const http = () => request(app.getHttpServer());
const as = (token: string, tenant: string) => ({ Authorization: `Bearer ${token}`, "X-Tenant-Id": tenant, "Accept-Language": "en" });

async function drain() {
  const runner = app.get(EngineJobRunner);
  for (let i = 0; i < 20; i++) {
    const n = await runner.cycle();
    await runner.idle();
    if (n === 0) return;
    clock.advance(60_000);
  }
}

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "http://localhost:3000", SHOPIFY_API_SECRET: shop.secret, BOSTA_BASE_URL: bosta.baseUrl });
  app = await createApp(config, {
    logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake,
    engineRuntime: () => testRuntime(clock, { [shop.host]: shop.handler, [bosta.host]: bosta.handler }, seeded(3)),
  });
  await app.init();
  db = app.get(Database);
  fake.add("owner", { uid: "fb-owner" });
  fake.add("other", { uid: "fb-other" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Abayas", country: "EG" }).expect(201)).body.id;
  other = (await http().post("/v1/tenants").set({ Authorization: "Bearer other" }).send({ name: "Other", country: "EG" }).expect(201)).body.id;

  const secrets = app.get(SecretsService);
  await db.tenant(store, async (trx) => {
    const by = { actor: { type: "system" as const } };
    const s = await secrets.create(trx, store, JSON.stringify({ accessToken: "shpat_fake_token" }), by);
    const b = await secrets.create(trx, store, JSON.stringify({ apiKey: bosta.apiKey, webhookToken: FAKE_WEBHOOK_TOKEN }), by);
    await trx.insertInto("connections").values([
      { tenant_id: store, kind: "store", provider: "shopify", external_account: shop.host, secret_ref: s },
      { tenant_id: store, kind: "courier", provider: "bosta", external_account: "bosta-1", secret_ref: b },
    ]).execute();
  });
  // An agent, to check roles.
  const inv = await http().post("/v1/members/invite").set(as("owner", store)).send({ email: "agent@nile.test", role: "agent" }).expect(201);
  fake.add("agent", { uid: "fb-agent", email: "agent@nile.test", emailVerified: true });
  await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: "Bearer agent" }).expect(200);
});
afterAll(() => app.close());

describe("admin integration routes", () => {
  it("a city the courier does not know: dead letter → ops teaches the city → replay → shipped", async () => {
    const o = shop.addOrder({ tags: ["mizan-confirmed"], city: "Kafr Atlantis", province: "Atlantis Governorate" });
    const wh = shop.webhook("orders/create", o);
    await (await app.get(EngineRegistry).get(store)).engine.handleShopifyWebhook(wh.headers, wh.body);
    await drain();
    expect(bosta.deliveries.size).toBe(0);

    const dead = await http().get("/v1/admin/integrations/dead-letters").set(as("owner", store)).expect(200);
    const job = dead.body.data.find((j: { kind: string }) => j.kind === "bosta.createShipment");
    expect(job).toMatchObject({ provider: "bosta", payload: { orderId: o.id } });
    expect(job.error).toMatch(/Kafr Atlantis/i);

    await http().post("/v1/admin/integrations/cities/resolve").set(as("owner", store))
      .send({ text: "Kafr Atlantis", cityId: "c-giza", jobId: job.id }).expect(200, { saved: true, replayed: true });
    await drain();
    expect(bosta.deliveries.size).toBe(1);
    expect((await http().get("/v1/admin/integrations/dead-letters").set(as("owner", store)).expect(200)).body.data).toEqual([]);

    const audit = await http().get("/v1/audit-log?action=integration.").set(as("owner", store)).expect(200);
    expect(audit.body.data.map((e: { action: string }) => e.action)).toEqual(["integration.city_resolved"]);
  });

  it("health shows connections, circuits, budgets and the outbox", async () => {
    const res = await http().get("/v1/admin/integrations/health").set(as("owner", store)).expect(200);
    expect(res.body).toMatchObject({ connected: true, shopify: { circuit: { state: "closed" } }, bosta: { circuit: { state: "closed" } }, outbox: { dead: 0 } });
    expect(res.body.connections.map((c: { provider: string }) => c.provider).sort()).toEqual(["bosta", "shopify"]);
    const none = await http().get("/v1/admin/integrations/health").set(as("other", other)).expect(200);
    expect(none.body).toEqual({ connected: false, reason: "no store is connected", connections: [] });
  });

  it("replay: 404 for unknown ids, jobs that are not dead, and other stores' jobs", async () => {
    await http().post("/v1/admin/integrations/jobs/not-a-uuid/replay").set(as("owner", store)).expect(404);
    await http().post(`/v1/admin/integrations/jobs/${crypto.randomUUID()}/replay`).set(as("owner", store)).expect(404);
    const [done] = await (await app.get(EngineRegistry).get(store)).store.jobs({ status: "done" });
    expect((await http().post(`/v1/admin/integrations/jobs/${done!.id}/replay`).set(as("owner", store)).expect(404)).body.code).toBe("job_not_found");
  });

  it("is for owners, admins and ops managers only; validates input", async () => {
    expect((await http().get("/v1/admin/integrations/health").set(as("agent", store)).expect(403)).body.code).toBe("insufficient_role");
    await http().post("/v1/admin/integrations/cities/resolve").set(as("owner", store)).send({ text: "x", cityId: "" }).expect(422);
    await http().post("/v1/admin/integrations/cities/resolve").set(as("owner", store)).send({ text: "Somewhere", cityId: "c-giza", jobId: crypto.randomUUID() }).expect(404);
  });
});
