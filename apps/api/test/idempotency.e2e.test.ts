import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { FakeVerifier } from "./support/fake-auth.js";

const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
const http = () => request(app.getHttpServer());
const as = (token: string, key?: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", ...(key ? { "Idempotency-Key": key } : {}) });

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "http://localhost", WEB_URL: "http://localhost:3000" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  fake.add("sara", { uid: "fb-sara" });
  fake.add("omar", { uid: "fb-omar" });
});
afterAll(() => app.close());

const storesOf = async (name: string) => (await db.kysely.selectFrom("tenants").select("id").where("name", "=", name).execute()).length;

describe("Idempotency-Key", () => {
  it("a retried POST returns the first response and creates nothing new", async () => {
    const body = { name: "Retry Store", country: "EG" };
    const first = await http().post("/v1/tenants").set(as("sara", "signup-1")).send(body).expect(201);
    const again = await http().post("/v1/tenants").set(as("sara", "signup-1")).send(body).expect(201);
    expect(again.body).toEqual(first.body);
    expect(again.headers["idempotency-replayed"]).toBe("true");
    expect(first.headers["idempotency-replayed"]).toBeUndefined();
    expect(await storesOf("Retry Store")).toBe(1);
  });

  it("concurrent duplicates: exactly one store; the others replay or are told to retry", async () => {
    const body = { name: "Race Store", country: "EG" };
    const results = await Promise.all(Array.from({ length: 5 }, () => http().post("/v1/tenants").set(as("sara", "race-1")).send(body)));
    for (const r of results) expect([201, 409]).toContain(r.status);
    for (const r of results.filter((x) => x.status === 409)) expect(r.body.code).toBe("idempotency_key_in_progress");
    expect(await storesOf("Race Store")).toBe(1);
    const settled = await http().post("/v1/tenants").set(as("sara", "race-1")).send(body).expect(201);
    expect(settled.headers["idempotency-replayed"]).toBe("true");
  });

  it("the same key with a different body is a 409", async () => {
    await http().post("/v1/tenants").set(as("sara", "signup-2")).send({ name: "Store A1", country: "EG" }).expect(201);
    const clash = await http().post("/v1/tenants").set(as("sara", "signup-2")).send({ name: "Store B1", country: "EG" }).expect(409);
    expect(clash.body).toMatchObject({ code: "idempotency_key_reused", title: "Idempotency-Key already used" });
  });

  it("a failed attempt can be retried with the same key", async () => {
    await http().post("/v1/tenants").set(as("sara", "signup-3")).send({ name: "X", country: "US" }).expect(422);
    await http().post("/v1/tenants").set(as("sara", "signup-3")).send({ name: "X", country: "US" }).expect(422);
  });

  it("keys are per caller; invalid keys are rejected; requests without a key are unaffected", async () => {
    await http().post("/v1/tenants").set(as("omar", "signup-1")).send({ name: "Omar Store", country: "EG" }).expect(201);
    expect(await storesOf("Omar Store")).toBe(1);
    expect((await http().post("/v1/tenants").set(as("omar", "bad key with spaces")).send({ name: "Y", country: "EG" }).expect(400)).body.code).toBe("invalid_idempotency_key");
    await http().post("/v1/tenants").set(as("omar")).send({ name: "Plain", country: "EG" }).expect(201);
    await http().post("/v1/tenants").set(as("omar")).send({ name: "Plain", country: "EG" }).expect(201);
    expect(await storesOf("Plain")).toBe(2);
  });

  it("stored responses are readable only by their caller (RLS)", async () => {
    const rows = await db.platform((trx) => trx.selectFrom("idempotency_keys").selectAll().execute());
    expect(rows).toEqual([]); // no app.user_id: nothing visible
  });
});
