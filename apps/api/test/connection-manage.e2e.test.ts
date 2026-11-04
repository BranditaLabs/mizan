import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { FakeVerifier } from "./support/fake-auth.js";

/** U7: the team names a store, and disconnects one (typing its address); history stays. */
const fake = new FakeVerifier();
let app: INestApplication;
let store: string;
let shopify: string;
let second: string;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });

beforeAll(async () => {
  app = await createApp(loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" }), { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  fake.add("owner", { uid: "fb-owner-manage", email: "owner@manage.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Two Stores", country: "EG" }).expect(201)).body.id;
  [shopify, second] = await app.get(Database).tenant(store, async (trx) => (await trx.insertInto("connections").values([
    { tenant_id: store, kind: "store", provider: "shopify", external_account: "nile-main.myshopify.com" },
    { tenant_id: store, kind: "store", provider: "shopify", external_account: "nile-outlet.myshopify.com" },
  ]).returning("id").execute()).map((r) => r.id));
});
afterAll(() => app.close());

describe("managing connections (U7)", () => {
  it("renames a store (audited), clears the name, validates it", async () => {
    const renamed = (await http().patch(`/v1/connections/${shopify}`).set(as("owner")).send({ displayName: "  Main store  " }).expect(200)).body;
    expect(renamed).toMatchObject({ id: shopify, displayName: "Main store", account: "nile-main.myshopify.com" });
    expect((await http().get("/v1/connections").set(as("owner")).expect(200)).body.data.find((c: { id: string }) => c.id === shopify).displayName).toBe("Main store");
    await http().patch(`/v1/connections/${shopify}`).set(as("owner")).send({ displayName: "x".repeat(61) }).expect(422);
    await http().patch(`/v1/connections/${shopify}`).set(as("owner")).send({}).expect(422);
    await http().patch("/v1/connections/3f2b1c4d-0a1b-4c2d-8e9f-0123456789ab").set(as("owner")).send({ displayName: "x" }).expect(404);
    const log = (await http().get("/v1/audit-log?action=connection.renamed").set(as("owner")).expect(200)).body.data;
    expect(log[0]).toMatchObject({ before: { displayName: null }, after: { displayName: "Main store" } });
  });

  it("onboarding lists every store, not only the first", async () => {
    const o = (await http().get("/v1/onboarding").set(as("owner")).expect(200)).body;
    expect(o.steps.store.stores.map((s: { connectionId: string }) => s.connectionId).sort()).toEqual([shopify, second].sort());
  });

  it("disconnects only when the address is typed; history stays; twice is a conflict", async () => {
    const wrong = await http().post(`/v1/connections/${second}/disconnect`).set(as("owner")).send({ confirm: "nile-main.myshopify.com" }).expect(422);
    expect(wrong.body.code).toBe("validation_failed");
    const done = (await http().post(`/v1/connections/${second}/disconnect`).set(as("owner")).send({ confirm: "NILE-OUTLET.myshopify.com " }).expect(200)).body;
    expect(done).toMatchObject({ id: second, status: "disconnected", reason: "by_team" });
    await http().post(`/v1/connections/${second}/disconnect`).set(as("owner")).send({ confirm: "nile-outlet.myshopify.com" }).expect(409);
    const log = (await http().get("/v1/audit-log?action=connection.disconnected").set(as("owner")).expect(200)).body.data;
    expect(log[0]).toMatchObject({ after: { status: "disconnected", reason: "by_team" } });
    const o = (await http().get("/v1/onboarding").set(as("owner")).expect(200)).body;
    expect(o.steps.store.stores.map((s: { connectionId: string }) => s.connectionId)).toEqual([shopify]);
  });
});
