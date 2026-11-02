import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { engineSyncOptions, storeSyncOf } from "../src/modules/connections/shopify/store-sync.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { FakeVerifier } from "./support/fake-auth.js";

/** E7-7: per-store switches for what Mizan writes back to Shopify as the courier reports. */
const fake = new FakeVerifier();
let app: INestApplication;
let store: string;
let shopify: string;
let bosta: string;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });

beforeAll(async () => {
  app = await createApp(loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" }), { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  fake.add("owner", { uid: "fb-owner-sync", email: "owner@nile.test", emailVerified: true, secondFactor: "phone" });
  fake.add("agent", { uid: "fb-agent-sync", phone: "+201001110000" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Abayas", country: "EG" }).expect(201)).body.id;
  const db = app.get(Database);
  [shopify, bosta] = await db.tenant(store, async (trx) => (await trx.insertInto("connections").values([
    { tenant_id: store, kind: "store", provider: "shopify", external_account: "nile.myshopify.com" },
    { tenant_id: store, kind: "courier", provider: "bosta", external_account: "bosta" },
  ]).returning("id").execute()).map((r) => r.id));
});
afterAll(() => app.close());

describe("store sync switches (E7-7)", () => {
  it("are all on by default, map to the engine's options, and ignore junk in the config", () => {
    expect(storeSyncOf({})).toEqual({ progressEvents: true, markPaidOnDelivery: true, tagReturned: true, tagLost: true });
    expect(storeSyncOf({ sync: { progressEvents: "no", tagLost: false } })).toMatchObject({ progressEvents: true, tagLost: false });
    expect(engineSyncOptions({ progressEvents: false, markPaidOnDelivery: true, tagReturned: true, tagLost: false }))
      .toEqual({ fulfillmentEvents: false, markCodPaidOnDelivery: true, tagOnReturn: "mizan-returned", tagOnLost: null });
  });

  it("owners read and change them per store; audited; only Shopify stores", async () => {
    expect((await http().get(`/v1/connections/${shopify}/sync`).set(as("owner")).expect(200)).body).toEqual({ progressEvents: true, markPaidOnDelivery: true, tagReturned: true, tagLost: true });
    const after = (await http().put(`/v1/connections/${shopify}/sync`).set(as("owner")).send({ progressEvents: false, tagLost: false }).expect(200)).body;
    expect(after).toEqual({ progressEvents: false, markPaidOnDelivery: true, tagReturned: true, tagLost: false });
    expect((await http().get(`/v1/connections/${shopify}/sync`).set(as("owner")).expect(200)).body.progressEvents).toBe(false);
    await http().put(`/v1/connections/${shopify}/sync`).set(as("owner")).send({}).expect(422);
    await http().put(`/v1/connections/${shopify}/sync`).set(as("owner")).send({ colour: "red" }).expect(422);
    await http().get(`/v1/connections/${bosta}/sync`).set(as("owner")).expect(404);
    const log = (await http().get("/v1/audit-log?action=connection.sync_updated").set(as("owner")).expect(200)).body.data;
    expect(log[0]).toMatchObject({ before: { progressEvents: true, tagLost: true }, after: { progressEvents: false, tagLost: false } });
    // The rest of the connection's config is kept.
    const cfg = await app.get(Database).tenant(store, (trx) => trx.selectFrom("connections").select("config").where("id", "=", shopify).executeTakeFirstOrThrow());
    expect((cfg.config as { sync: unknown }).sync).toEqual(after);
  });
});
