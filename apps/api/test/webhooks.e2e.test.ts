import "reflect-metadata";
import { createHmac } from "node:crypto";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import { FakeBosta, FakeClock, FakeShopify, seeded, testRuntime } from "@mizan/engine/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { SecretsService } from "../src/platform/secrets/secrets.service.js";
import { EngineJobRunner } from "../src/integrations/engine-runner.js";
import { WebhookRouter } from "../src/integrations/webhook-router.js";
import { ConnectionLifecycle } from "../src/integrations/connection-lifecycle.js";
import { EngineRegistry } from "../src/integrations/engine-registry.js";

const T = "aaaaaaaa-0000-4000-8000-000000000001";
const FAKE_WEBHOOK_TOKEN = ["whsec", "bosta", "hooks", "0123456789"].join("-");
const clock = new FakeClock();
const shop = new FakeShopify(clock, seeded(1));
const bosta = new FakeBosta(clock, seeded(2));

let app: INestApplication;
let db: Database;
const conn: Record<string, string> = {};
const http = () => request(app.getHttpServer());

const send = (path: string, wh: { headers: Record<string, string>; body: string }) =>
  http().post(path).set(wh.headers).set("Content-Type", "application/json").send(wh.body);

beforeAll(async () => {
  const config = loadConfig({ ENGINE_AUTO_SHIP_TAG: "mizan-confirmed", NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "http://localhost:3000", SHOPIFY_API_SECRET: shop.secret, BOSTA_BASE_URL: bosta.baseUrl, MAX_BODY_BYTES: "1024" });
  app = await createApp(config, {
    logDestination: new Writable({ write: (_c, _e, d) => d() }),
    engineRuntime: () => testRuntime(clock, { [shop.host]: shop.handler, [bosta.host]: bosta.handler }, seeded(3)),
  });
  await app.init();
  db = app.get(Database);
  await db.kysely.insertInto("tenants").values({ id: T, name: "Nile", slug: "nile" }).execute();
  const secrets = app.get(SecretsService);
  await db.tenant(T, async (trx) => {
    const by = { actor: { type: "system" as const } };
    const s = await secrets.create(trx, T, JSON.stringify({ accessToken: "shpat_fake_token" }), by);
    const b = await secrets.create(trx, T, JSON.stringify({ apiKey: bosta.apiKey, webhookToken: FAKE_WEBHOOK_TOKEN }), by);
    conn.shopify = (await trx.insertInto("connections").values({ tenant_id: T, kind: "store", provider: "shopify", external_account: shop.host, secret_ref: s }).returning("id").executeTakeFirstOrThrow()).id;
    conn.bosta = (await trx.insertInto("connections").values({ tenant_id: T, kind: "courier", provider: "bosta", external_account: "bosta-1", secret_ref: b }).returning("id").executeTakeFirstOrThrow()).id;
    conn.old = (await trx.insertInto("connections").values({ tenant_id: T, kind: "store", provider: "shopify", external_account: "old.myshopify.com", status: "disconnected" }).returning("id").executeTakeFirstOrThrow()).id;
  });
});
afterAll(() => app.close());

describe("webhook ingress", () => {
  it("Shopify: verified, acknowledged, deduplicated, then processed into an order", async () => {
    const o = shop.addOrder({ tags: ["mizan-confirmed"] });
    const wh = shop.webhook("orders/create", o);
    const first = await send(`/webhooks/shopify/${conn.shopify}`, wh).expect(200);
    expect(first.body).toEqual({ accepted: true });
    expect((await send(`/webhooks/shopify/${conn.shopify}`, wh).expect(200)).body).toEqual({ duplicate: true });

    const runner = app.get(EngineJobRunner);
    for (let i = 0; i < 10; i++) { await runner.cycle(); await runner.idle(); clock.advance(60_000); }
    const orders = await db.tenant(T, (trx) => trx.selectFrom("orders").select(["external_id", "connection_id"]).execute());
    expect(orders).toEqual([{ external_id: o.id, connection_id: conn.shopify }]);
    expect(bosta.deliveries.size).toBe(1); // auto-shipped: the Bosta webhook URL is per connection
  });

  it("rejects a bad signature; bodies larger than the API limit are still accepted (own cap)", async () => {
    const o = shop.addOrder({ name: "#BIG", tags: [] });
    const wh = shop.webhook("orders/updated", o);
    expect((await send(`/webhooks/shopify/${conn.shopify}`, { ...wh, headers: { ...wh.headers, "X-Shopify-Hmac-SHA256": "forged" } })).status).toBe(401);
    // A large but valid payload (real order webhooks carry the whole order), signed like Shopify does.
    const big = JSON.stringify({ ...JSON.parse(wh.body), note: "x".repeat(4000) });
    const hmac = createHmac("sha256", shop.secret).update(big).digest("base64");
    expect(big.length).toBeGreaterThan(1024); // MAX_BODY_BYTES is 1 KiB in this test
    const ok = await send(`/webhooks/shopify/${conn.shopify}`, { headers: { ...wh.headers, "X-Shopify-Hmac-SHA256": hmac, "X-Shopify-Event-Id": "evt-big-1" }, body: big }).expect(200);
    expect(ok.body).toEqual({ accepted: true });
  });

  it("Bosta: token checked; a status update is accepted", async () => {
    const [tn] = [...bosta.deliveries.keys()];
    const body = JSON.stringify({ trackingNumber: tn, state: { code: 24, value: "In transit" }, timestamp: Date.now() });
    const ok = await http().post(`/webhooks/bosta/${conn.bosta}?token=${FAKE_WEBHOOK_TOKEN}`).set("Content-Type", "application/json").send(body).expect(200);
    expect(ok.body).toEqual({ accepted: true });
    await http().post(`/webhooks/bosta/${conn.bosta}?token=wrong`).set("Content-Type", "application/json").send(body).expect(401);
  });

  it("unknown or mismatched connections are 404; disconnected ones are acknowledged and ignored", async () => {
    const wh = shop.webhook("orders/create", shop.addOrder());
    await send(`/webhooks/shopify/${crypto.randomUUID()}`, wh).expect(404);
    await send("/webhooks/shopify/not-a-uuid", wh).expect(404);
    await send(`/webhooks/shopify/${conn.bosta}`, wh).expect(404);
    expect((await send(`/webhooks/shopify/${conn.old}`, wh).expect(200)).body).toEqual({ ignored: "disconnected" });
    await http().post(`/v1/webhooks/shopify/${conn.shopify}`).send("{}").expect(404); // not under /v1
  });

  it("routes from cache: no database lookup per webhook once warm", async () => {
    const router = app.get(WebhookRouter);
    const r1 = await router.route(conn.shopify!);
    await db.kysely.updateTable("connections").set({ provider: "changed" }).where("id", "=", conn.shopify!).execute();
    expect(await router.route(conn.shopify!)).toEqual(r1); // cached
    router.forget(conn.shopify!);
    expect((await router.route(conn.shopify!))!.provider).toBe("changed");
    await db.kysely.updateTable("connections").set({ provider: "shopify" }).where("id", "=", conn.shopify!).execute();
    router.forget(conn.shopify!);
  });

  it("W3/W4: a reconnect in another process during a burst loses nothing (no cached 'no route')", async () => {
    const router = app.get(WebhookRouter);
    const status = (s: "active" | "disconnected") => db.kysely.updateTable("connections").set({ status: s }).where("id", "=", conn.shopify!).execute();
    await status("disconnected");
    router.forget(conn.shopify!); // this process saw the disconnect
    const answers: unknown[] = [];
    for (let i = 0; i < 6; i++) {
      if (i === 3) await status("active"); // reconnected by another API process: nobody told this one
      const wh = shop.webhook("orders/create", shop.addOrder({ tags: [] }));
      answers.push((await send(`/webhooks/shopify/${conn.shopify}`, wh).expect(200)).body);
    }
    expect(answers).toEqual([
      { ignored: "disconnected" }, { ignored: "disconnected" }, { ignored: "disconnected" },
      { accepted: true }, { accepted: true }, { accepted: true },
    ]);
    // A connection that does not exist yet, then does: the first answer is not remembered either.
    const id = crypto.randomUUID();
    const wh = shop.webhook("orders/create", shop.addOrder({ tags: [] }));
    await send(`/webhooks/shopify/${id}`, wh).expect(404);
    await db.tenant(T, (trx) => trx.insertInto("connections").values({ id, tenant_id: T, kind: "store", provider: "shopify", external_account: "new.myshopify.com", status: "disconnected" }).execute());
    expect((await send(`/webhooks/shopify/${id}`, wh).expect(200)).body).toEqual({ ignored: "disconnected" });
    await db.tenant(T, (trx) => trx.deleteFrom("connections").where("id", "=", id).execute());
  });

  it("FX-3a: a Bosta token replaced by another process (a reconnect) is taken at once, not after the engine cache expires", async () => {
    const registry = app.get(EngineRegistry);
    const [tn] = [...bosta.deliveries.keys()];
    const body = (n: number) => JSON.stringify({ trackingNumber: tn, state: { code: 24, value: "In transit" }, timestamp: Date.now() + n });
    const hook = (token: string, n: number) => http().post(`/webhooks/bosta/${conn.bosta}?token=${token}`).set("Content-Type", "application/json").send(body(n));
    await hook(FAKE_WEBHOOK_TOKEN, 1).expect(200); // this process has an engine with the old token
    for (const e of registry.all()) e.builtAt -= 60_000; // built a minute ago, well inside its 10-minute life
    // Another API process reconnects Bosta: a new credential with a new webhook token. Nobody tells this process.
    const fresh = ["whsec", "bosta", "reconnected", "0123456789"].join("-");
    await db.tenant(T, async (trx) => {
      const ref = await app.get(SecretsService).create(trx, T, JSON.stringify({ apiKey: bosta.apiKey, webhookToken: fresh }), { actor: { type: "system" as const } });
      await trx.updateTable("connections").set({ secret_ref: ref }).where("id", "=", conn.bosta!).execute();
    });
    expect((await hook(fresh, 2).expect(200)).body).toEqual({ accepted: true }); // rejected by the cached engine, accepted by one built now
    const rebuilt = registry.cached(T);
    expect(Date.now() - rebuilt!.builtAt).toBeLessThan(5_000);
    await hook(FAKE_WEBHOOK_TOKEN, 3).expect(401); // the old token is refused
    await hook("forged", 4).expect(401);
    expect(registry.cached(T)).toBe(rebuilt); // a run of bad tokens does not rebuild the engines again (throttled)
  });

  // Last in the file: it disconnects the store.
  it("app/uninstalled: when the disconnect fails after the mark, Shopify's retry (a duplicate) still disconnects", async () => {
    const lifecycle = app.get(ConnectionLifecycle);
    const spy = vi.spyOn(lifecycle, "providerRevoked").mockRejectedValueOnce(new Error("lock timeout"));
    const wh = shop.uninstall();
    await send(`/webhooks/shopify/${conn.shopify}`, wh).expect(500); // Shopify retries a 5xx
    const still = await db.tenant(T, (trx) => trx.selectFrom("connections").select("status").where("id", "=", conn.shopify!).executeTakeFirstOrThrow());
    expect(still.status).not.toBe("disconnected");
    // The retry: same event id, already marked, so the engine answers "duplicate"; the uninstall still runs.
    expect((await send(`/webhooks/shopify/${conn.shopify}`, wh).expect(200)).body).toEqual({ duplicate: true });
    expect(spy).toHaveBeenCalledTimes(2);
    const row = await db.tenant(T, (trx) => trx.selectFrom("connections").select(["status", "status_reason", "secret_ref"]).where("id", "=", conn.shopify!).executeTakeFirstOrThrow());
    expect(row).toEqual({ status: "disconnected", status_reason: "app_uninstalled", secret_ref: null });
    spy.mockRestore();
  });
});
