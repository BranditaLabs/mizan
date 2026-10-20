import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import { SHOPIFY_WEBHOOK_TOPICS } from "@mizan/engine";
import { FakeClock, FakeShopify, seeded, testRuntime } from "@mizan/engine/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig, SHOPIFY_DEFAULT_SCOPES } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { ConnectionResolver } from "../src/integrations/connection-resolver.js";
import { EngineJobRunner } from "../src/integrations/engine-runner.js";
import { EventDispatcher } from "../src/platform/events/dispatcher.js";
import { FakeVerifier } from "./support/fake-auth.js";

const clock = new FakeClock();
const shop = new FakeShopify(clock, seeded(1));
const shop2 = new FakeShopify(clock, seeded(2), "second-store.myshopify.com");
const shop3 = new FakeShopify(clock, seeded(3), "third-store.myshopify.com");
const SCOPES = SHOPIFY_DEFAULT_SCOPES.split(",");
const fake = new FakeVerifier();

let app: INestApplication;
let db: Database;
const stores: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const as = (user: string) => ({ Authorization: `Bearer ${user}`, "X-Tenant-Id": stores[user]!, "Accept-Language": "en" });
const qs = (q: Record<string, string>) => new URLSearchParams(q).toString();
const web = (location: string) => {
  const u = new URL(location);
  expect(`${u.origin}${u.pathname}`).toBe("http://localhost:3000/integrations/shopify/connect");
  return Object.fromEntries(u.searchParams);
};

/** Owner starts in Mizan, approves on Shopify, Shopify calls back: returns the web redirect's params. */
async function installFlow(user: string, s: FakeShopify, scopes = SCOPES) {
  const begin = await http().get(`/v1/connections/shopify/install?shop=${s.host}`).set(as(user)).expect(200);
  const state = new URL(begin.body.authorizeUrl).searchParams.get("state")!;
  const cb = await http().get(`/v1/connections/shopify/callback?${qs(s.authorize(state, scopes, Date.now()))}`).expect(302);
  expect(cb.headers["referrer-policy"]).toBe("no-referrer");
  return web(cb.headers.location!);
}

beforeAll(async () => {
  const config = loadConfig({
    NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "http://localhost:3000",
    SHOPIFY_API_KEY: shop.clientId, SHOPIFY_API_SECRET: shop.secret,
  });
  app = await createApp(config, {
    logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake,
    engineRuntime: () => testRuntime(clock, { [shop.host]: shop.handler, [shop2.host]: shop2.handler, [shop3.host]: shop3.handler }, seeded(4)),
  });
  await app.init();
  db = app.get(Database);
  for (const [user, name] of [["sara", "Sara Store"], ["omar", "Omar Store"], ["layla", "Layla Store"]] as const) {
    fake.add(user, { uid: `fb-${user}` });
    stores[user] = (await http().post("/v1/tenants").set({ Authorization: `Bearer ${user}` }).send({ name, country: "EG" }).expect(201)).body.id;
  }
});
afterAll(() => app.close());

describe("Shopify install from inside Mizan", () => {
  it("authorize URL → callback → claim creates an active connection with the token sealed", async () => {
    const begin = await http().get(`/v1/connections/shopify/install?shop=Fake-Store.myshopify.com`).set(as("sara")).expect(200);
    const url = new URL(begin.body.authorizeUrl);
    expect(url.host).toBe(shop.host);
    expect(url.searchParams.get("client_id")).toBe(shop.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe("https://api.mizan.test/v1/connections/shopify/callback");
    expect(url.searchParams.get("scope")).toBe(SHOPIFY_DEFAULT_SCOPES);

    const q = shop.authorize(url.searchParams.get("state")!, SCOPES, Date.now());
    const cb = await http().get(`/v1/connections/shopify/callback?${qs(q)}`).expect(302);
    const { install, shop: shopParam } = web(cb.headers.location!);
    expect(shopParam).toBe(shop.host);
    const token = shop.tokens.at(-1)!;

    // The pending install holds the token sealed, never in clear.
    const pending = await db.worker((trx) => trx.selectFrom("shopify_installs").selectAll().execute());
    expect(pending).toHaveLength(1);
    expect(Buffer.concat([pending[0]!.ciphertext, pending[0]!.wrapped_key]).includes(Buffer.from(token))).toBe(false);

    const claim = await http().post("/v1/connections/shopify/claim").set(as("sara")).send({ install }).expect(201);
    expect(claim.body).toMatchObject({ reconnected: false, connection: { provider: "shopify", account: shop.host, status: "active" } });

    const resolved = await app.get(ConnectionResolver).resolve(stores.sara!);
    expect(resolved.shopify.accessToken.reveal()).toBe(token);
    expect(resolved.shopify.shop).toBe(shop.host);
    const audit = await http().get("/v1/audit-log").set(as("sara")).expect(200);
    expect(JSON.stringify(audit.body)).toContain("connection.connected");
    expect(JSON.stringify(audit.body)).not.toContain(token);
    const events = await db.tenant(stores.sara!, (trx) => trx.selectFrom("domain_events").select("type").where("type", "=", "connection.connected").execute());
    expect(events).toHaveLength(1);

    // One-time: the claim and the callback cannot be replayed.
    await http().post("/v1/connections/shopify/claim").set(as("sara")).send({ install }).expect(404);
    const replay = await http().get(`/v1/connections/shopify/callback?${qs(q)}`).expect(302);
    expect(web(replay.headers.location!)).toEqual({ error: "install_failed" });
  });

  it("reinstalling the same store rotates the token on the same connection", async () => {
    const before = await app.get(ConnectionResolver).resolve(stores.sara!);
    const { install } = await installFlow("sara", shop);
    const res = await http().post("/v1/connections/shopify/claim").set(as("sara")).send({ install }).expect(201);
    expect(res.body).toMatchObject({ reconnected: true, connection: { id: before.shopify.connectionId } });
    expect((await app.get(ConnectionResolver).resolve(stores.sara!)).shopify.accessToken.reveal()).toBe(shop.tokens.at(-1));
  });

  it("each connect registers the store's webhooks through the outbox (E3-2)", async () => {
    const runner = app.get(EngineJobRunner);
    for (let i = 0; i < 5; i++) {
      await app.get(EventDispatcher).runOnce();
      await runner.cycle();
      await runner.idle();
      clock.advance(60_000);
    }
    const { shopify } = await app.get(ConnectionResolver).resolve(stores.sara!);
    const subs = [...shop.webhooks.values()];
    expect(subs.map((w) => w.topic).sort()).toEqual([...SHOPIFY_WEBHOOK_TOPICS].sort());
    expect(new Set(subs.map((w) => w.uri))).toEqual(new Set([`https://api.mizan.test/webhooks/shopify/${shopify.connectionId}`]));
    const jobs = await db.tenant(stores.sara!, (trx) => trx.selectFrom("mz_outbox").select(["kind", "status"]).where("kind", "=", "shopify.syncWebhooks").execute());
    expect(jobs).toEqual([{ kind: "shopify.syncWebhooks", status: "done" }, { kind: "shopify.syncWebhooks", status: "done" }]); // install + reinstall
  });

  it("only owners and admins can connect a store", async () => {
    const inv = await http().post("/v1/members/invite").set(as("sara")).send({ email: "agent@sara.test", role: "agent" }).expect(201);
    fake.add("agent", { uid: "fb-agent", email: "agent@sara.test", emailVerified: true });
    await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: "Bearer agent" }).expect(200);
    const agent = { Authorization: "Bearer agent", "X-Tenant-Id": stores.sara! };
    await http().get(`/v1/connections/shopify/install?shop=${shop.host}`).set(agent).expect(403);
    await http().post("/v1/connections/shopify/claim").set(agent).send({ install: "a".repeat(43) }).expect(403);
  });
});

describe("attacks and failures", () => {
  it("an install started by one account cannot be claimed by another (login CSRF)", async () => {
    // Omar starts an install for a store and lures Layla, its real owner, through Shopify's approval page.
    const { install } = await installFlow("omar", shop3);
    const stolen = await http().post("/v1/connections/shopify/claim").set(as("layla")).send({ install }).expect(403);
    expect(stolen.body.code).toBe("install_not_yours");
  });

  it("rejects forged callbacks before talking to Shopify", async () => {
    const issued = shop.tokens.length;
    const begin = await http().get(`/v1/connections/shopify/install?shop=${shop2.host}`).set(as("omar")).expect(200);
    const state = new URL(begin.body.authorizeUrl).searchParams.get("state")!;
    const q = shop2.authorize(state, SCOPES, Date.now());
    const cases: Array<[Record<string, string>, string]> = [
      [{ ...q, hmac: "0".repeat(64) }, "invalid_signature"],
      [{ ...q, shop: "evil.com" }, "invalid_signature"],
      [shop.authorize(state, SCOPES, Date.now()), "invalid_state"], // state issued for another shop
      [shop2.authorize(`${state}x`, SCOPES, Date.now()), "invalid_state"],
      [shop2.authorize(state, SCOPES, Date.now() - 2 * 3600_000), "invalid_signature"], // stale link
    ];
    for (const [query, error] of cases) {
      const res = await http().get(`/v1/connections/shopify/callback?${qs(query)}`).expect(302);
      expect(web(res.headers.location!)).toEqual({ error });
    }
    expect(shop.tokens.length).toBe(issued);
    await http().get("/v1/connections/shopify/install?shop=evil.com").set(as("omar")).expect(422);
  });

  it("a grant without the required scopes, or Shopify being down, is not stored", async () => {
    const few = await installFlow("omar", shop2, ["read_orders"]);
    expect(few).toEqual({ error: "scopes_missing" });
    shop2.faults.push({ op: "oauthAccessToken", fault: "500" });
    expect(await installFlow("omar", shop2)).toEqual({ error: "shopify_unavailable" });
  });

  it("a store connected to another account, a second store, and an expired link are refused", async () => {
    const taken = await installFlow("layla", shop);
    expect((await http().post("/v1/connections/shopify/claim").set(as("layla")).send({ install: taken.install }).expect(409)).body.code).toBe("shop_connected_elsewhere");

    const second = await installFlow("sara", shop2);
    expect((await http().post("/v1/connections/shopify/claim").set(as("sara")).send({ install: second.install }).expect(409)).body.code).toBe("store_limit_reached");

    const late = await installFlow("layla", shop3);
    await db.worker((trx) => trx.updateTable("shopify_installs").set({ expires_at: new Date(Date.now() - 1000) }).where("shop", "=", shop3.host).execute());
    expect((await http().post("/v1/connections/shopify/claim").set(as("layla")).send({ install: late.install }).expect(410)).body.code).toBe("install_expired");
  });
});

describe("install from the Shopify App Store", () => {
  it("goes straight to OAuth; the merchant claims the install after signing in", async () => {
    const entry = await http().get(`/v1/connections/shopify/entry?${qs(shop2.launch(Date.now()))}`).expect(302);
    const authorize = new URL(entry.headers.location!);
    expect(`${authorize.origin}${authorize.pathname}`).toBe(`https://${shop2.host}/admin/oauth/authorize`);
    const cb = await http().get(`/v1/connections/shopify/callback?${qs(shop2.authorize(authorize.searchParams.get("state")!, SCOPES, Date.now()))}`).expect(302);
    const { install } = web(cb.headers.location!);
    const res = await http().post("/v1/connections/shopify/claim").set(as("omar")).send({ install }).expect(201);
    expect(res.body.connection.account).toBe(shop2.host);

    const forged = await http().get(`/v1/connections/shopify/entry?${qs({ ...shop2.launch(Date.now()), shop: shop3.host })}`).expect(302);
    expect(web(forged.headers.location!)).toEqual({ error: "invalid_signature" });
  });
});
