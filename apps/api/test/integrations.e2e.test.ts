import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import { FakeBosta, FakeClock, FakeShopify, seeded, testRuntime } from "@mizan/engine/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { SecretsService } from "../src/platform/secrets/secrets.service.js";
import { NotConnectedError } from "../src/integrations/connection-resolver.js";
import { EngineRegistry, type RuntimeFactory } from "../src/integrations/engine-registry.js";
import { EngineJobRunner } from "../src/integrations/engine-runner.js";
import type { AppConfig } from "../src/platform/config.js";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const NONE = "cccccccc-0000-4000-8000-000000000003";

// Fake credential, assembled at runtime so secret scanners do not flag the fixture.
const FAKE_WEBHOOK_TOKEN = ["whsec", "bosta", "0123456789"].join("-");

/** Per-tenant fake providers on a virtual clock (sleeps and backoffs take no real time). */
const fakes = new Map<string, { clock: FakeClock; shop: FakeShopify; bosta: FakeBosta }>();
for (const t of [A, B]) {
  const clock = new FakeClock();
  fakes.set(t, { clock, shop: new FakeShopify(clock, seeded(1)), bosta: new FakeBosta(clock, seeded(2)) });
}
const runtime: RuntimeFactory = (tenantId) => {
  const f = fakes.get(tenantId)!;
  return testRuntime(f.clock, { [f.shop.host]: f.shop.handler, [f.bosta.host]: f.bosta.handler }, seeded(3));
};

let app: INestApplication;
let db: Database;
let registry: EngineRegistry;
let runner: EngineJobRunner;
const builds: string[] = [];

async function connect(tenantId: string, opts: { bosta?: boolean; shopifySecret?: string } = {}) {
  const f = fakes.get(tenantId);
  const secrets = app.get(SecretsService);
  await db.tenant(tenantId, async (trx) => {
    const by = { actor: { type: "system" as const } };
    const shopRef = await secrets.create(trx, tenantId, opts.shopifySecret ?? JSON.stringify({ accessToken: "shpat_fake_token" }), by);
    await trx.insertInto("connections").values({ tenant_id: tenantId, kind: "store", provider: "shopify", external_account: f?.shop.host ?? "x.myshopify.com", secret_ref: shopRef }).execute();
    if (opts.bosta !== false && f) {
      const bostaRef = await secrets.create(trx, tenantId, JSON.stringify({ apiKey: f.bosta.apiKey, webhookToken: FAKE_WEBHOOK_TOKEN }), by);
      await trx.insertInto("connections").values({ tenant_id: tenantId, kind: "courier", provider: "bosta", external_account: "bosta-business-1", secret_ref: bostaRef }).execute();
    }
  });
}

/** Cycle the platform runner until nothing more happens (each tenant's own engine claims with its virtual clock). */
async function runUntilQuiet(rounds = 60) {
  for (let i = 0; i < rounds; i++) {
    const started = await runner.cycle();
    await runner.idle();
    if (started === 0) return;
    // Let each tenant's virtual time reach its next retry.
    for (const { clock } of fakes.values()) clock.advance(60_000);
  }
}

beforeAll(async () => {
  const shopSecret = fakes.get(A)!.shop.secret;
  const config = loadConfig({
    NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "http://localhost:3000",
    SHOPIFY_API_SECRET: shopSecret, BOSTA_BASE_URL: fakes.get(A)!.bosta.baseUrl,
  });
  const counting: RuntimeFactory = (t, c) => { builds.push(t); return runtime(t, c); };
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), engineRuntime: counting });
  await app.init();
  db = app.get(Database);
  registry = app.get(EngineRegistry);
  runner = app.get(EngineJobRunner);
  await db.kysely.insertInto("tenants").values([{ id: A, name: "A", slug: "a" }, { id: B, name: "B", slug: "b" }, { id: NONE, name: "N", slug: "n" }]).execute();
  await connect(A);
  await connect(B);
});
afterAll(() => app.close());

describe("connection resolver and engine registry", () => {
  it("builds one engine per tenant from its own connections and decrypted credentials, once", async () => {
    const [a1, a2, b] = await Promise.all([registry.get(A), registry.get(A), registry.get(B)]);
    expect(a1).toBe(a2);
    expect(builds.filter((t) => t === A)).toHaveLength(1);
    expect(a1.engine.shopify.creds.accessToken).toBe("shpat_fake_token");
    expect(a1.connections.shopify.connectionId).not.toBe(b.connections.shopify.connectionId);
    expect(a1.engine.shopify).not.toBe(b.engine.shopify); // separate connectors → separate circuits and buckets
    expect(String(a1.connections.shopify.accessToken)).toBe("[secret]");
  });

  it("rebuilds after invalidate()", async () => {
    const before = await registry.get(B);
    registry.invalidate(B);
    expect(await registry.get(B)).not.toBe(before);
  });

  it("a tenant without a store connection, or with unreadable credentials, is NotConnected", async () => {
    await expect(registry.get(NONE)).rejects.toBeInstanceOf(NotConnectedError);
    const broken = "dddddddd-0000-4000-8000-000000000004";
    await db.kysely.insertInto("tenants").values({ id: broken, name: "D", slug: "d" }).execute();
    await connect(broken, { bosta: false, shopifySecret: JSON.stringify({ token: "wrong-shape" }) });
    await expect(registry.get(broken)).rejects.toMatchObject({ code: "store_not_connected", detail: "the shopify credentials are incomplete" });
  });
});

describe("two tenants, two Shopify stores", () => {
  it("sync independently: one store throttling every call does not hold back the other", async () => {
    const a = fakes.get(A)!;
    const b = fakes.get(B)!;
    for (let i = 0; i < 500; i++) a.shop.faults.push({ fault: "throttle" }); // store A: 429 / THROTTLED on every call
    const oa = a.shop.addOrder({ tags: ["mizan-confirmed"] });
    const ob = b.shop.addOrder({ tags: ["mizan-confirmed"] });

    for (const [t, f, o] of [[A, a, oa], [B, b, ob]] as const) {
      const wh = f.shop.webhook("orders/create", o);
      const res = await (await registry.get(t)).engine.handleShopifyWebhook(wh.headers, wh.body);
      expect(res.status).toBe(200);
    }
    await runUntilQuiet();

    // B shipped and fulfilled exactly once.
    expect(b.bosta.deliveries.size).toBe(1);
    expect(b.shop.orders.get(ob.id)!.fulfillments).toHaveLength(1);
    const bEngine = (await registry.get(B)).engine;
    expect(bEngine.shopify.health().circuit.state).toBe("closed");

    // A is still being throttled: nothing shipped, its work is retrying or parked, never lost.
    expect(a.bosta.deliveries.size).toBe(0);
    const aStore = (await registry.get(A)).store;
    const aJobs = [...(await aStore.jobs({ status: "pending" })), ...(await aStore.jobs({ status: "dead" }))];
    expect(aJobs.map((j) => j.kind)).toContain("shopify.ingestOrder");
    expect(aJobs.every((j) => j.attempts >= 1)).toBe(true);

    // Recovery: A's store stops throttling; its jobs finish without touching B.
    a.shop.faults.length = 0;
    for (const j of await aStore.jobs({ status: "dead" })) await aStore.replay(j.id, a.clock.now());
    await runUntilQuiet();
    expect(a.bosta.deliveries.size).toBe(1);
    expect(b.bosta.deliveries.size).toBe(1);
  });
});

describe("learned data (E2-4)", () => {
  it("is kept on the connection: survives a new engine, and stays with its own tenant", async () => {
    const learnedOf = async (tenantId: string, provider: string) => {
      const row = await db.tenant(tenantId, (trx) => trx.selectFrom("connections").select("learned").where("provider", "=", provider).executeTakeFirstOrThrow());
      return (typeof row.learned === "string" ? JSON.parse(row.learned) : row.learned) as { cities?: Record<string, string>; codes?: Record<string, unknown> };
    };
    // B shipped a parcel in the flow above: the status codes it learned are on B's Bosta connection.
    expect(Object.keys((await learnedOf(B, "bosta")).codes ?? {}).length).toBeGreaterThan(0);

    await (await registry.get(A)).engine.resolveCity("Kafr Atlantis", "c-giza");
    expect((await learnedOf(A, "bosta")).cities).toMatchObject({ "kafr atlantis": "c-giza" });
    expect((await learnedOf(B, "bosta")).cities ?? {}).not.toHaveProperty("kafr atlantis");

    registry.invalidate(A);
    const rebuilt = await registry.get(A);
    expect(rebuilt.engine.bosta.exportLearned().cities).toMatchObject({ "kafr atlantis": "c-giza" });
  });
});

describe("EngineJobRunner scheduling", () => {
  it("never waits for a stuck tenant: other tenants keep getting ticks", async () => {
    let releaseA!: () => void;
    const aStuck = new Promise<void>((r) => { releaseA = r; });
    const ticks = { [A]: 0, [B]: 0 } as Record<string, number>;
    const stub = {
      get: async (t: string) => ({ engine: { worker: { tick: async () => { ticks[t]!++; if (t === A) await aStuck; return 0; } } } }),
    } as unknown as EngineRegistry;
    const r = new EngineJobRunner(db, stub, { NODE_ENV: "test" } as AppConfig);
    // Due jobs for both tenants (as the engines would have enqueued them).
    for (const t of [A, B]) {
      await db.tenant(t, (trx) => trx.insertInto("mz_outbox").values({
        id: crypto.randomUUID(), tenant_id: t, kind: "shopify.pollOrders", connection: "shopify", payload: "{}",
        idempotency_key: `stuck-test:${t}`, status: "pending", next_attempt_at: 1, created_at: 1, updated_at: 1,
      }).execute());
    }
    const now = 2;
    expect(await r.dueTenants(now)).toEqual(expect.arrayContaining([A, B]));
    await r.cycle(now);
    await new Promise((x) => setTimeout(x, 10));
    expect(r.isTicking(A)).toBe(true);
    await r.cycle(now);
    await new Promise((x) => setTimeout(x, 10));
    await r.cycle(now);
    await new Promise((x) => setTimeout(x, 10));
    expect(ticks[A]).toBe(1); // A's single tick is still stuck; never doubled up
    expect(ticks[B]).toBe(3); // B ticked on every cycle meanwhile
    releaseA();
    await r.idle();
    expect(r.isTicking(A)).toBe(false);
    await db.kysely.deleteFrom("mz_outbox").where("idempotency_key", "like", "stuck-test:%").execute();
  });
});
