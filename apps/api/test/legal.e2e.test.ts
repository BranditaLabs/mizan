import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import { LEGAL_VERSIONS, type LegalStatus } from "@mizan/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * L1-3: the terms of service and the DPA, accepted per store and version. The pages read the
 * public status; the owner accepts at sign-up or later; the team sees whether the owner must.
 */
const fake = new FakeVerifier();
const quiet = new Writable({ write: (_c, _e, d) => d() });
const CURRENT = { terms: LEGAL_VERSIONS.terms, dpa: LEGAL_VERSIONS.dpa };

async function boot(legalStatus?: LegalStatus) {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "http://localhost", WEB_URL: "http://localhost:3000" });
  const app = await createApp(config, { logDestination: quiet, tokenVerifier: fake, ...(legalStatus ? { legalStatus } : {}) });
  await app.init();
  return app;
}
const as = (token: string, tenant?: string) => ({
  Authorization: `Bearer ${token}`, "Accept-Language": "en", ...(tenant ? { "X-Tenant-Id": tenant } : {}),
});

beforeAll(() => {
  fake.add("sara", { uid: "fb-sara", email: "sara@example.com", name: "Sara Hassan" });
  fake.add("omar", { uid: "fb-omar", email: "omar@example.com" });
  fake.add("mona", { uid: "fb-mona", email: "mona@example.com" });
});

describe("while the documents are drafts", () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => { app = await boot(); });
  afterAll(() => app.close());

  it("GET /v1/public/legal needs no sign-in and says draft", async () => {
    const res = await http().get("/v1/public/legal").expect(200);
    expect(res.body).toEqual({
      status: "draft",
      documents: [{ key: "terms", version: LEGAL_VERSIONS.terms }, { key: "privacy", version: LEGAL_VERSIONS.privacy }, { key: "dpa", version: LEGAL_VERSIONS.dpa }],
    });
  });

  it("409 for a stale acceptLegal at sign-up while drafts too", async () => {
    const res = await http().post("/v1/tenants").set(as("mona")).send({ name: "Stale Draft", country: "EG", acceptLegal: { ...CURRENT, dpa: "0.0" } }).expect(409);
    expect(res.body.code).toBe("legal_version_changed");
  });

  it("never asks a store to accept a draft", async () => {
    const store = (await http().post("/v1/tenants").set(as("sara")).send({ name: "Draft Store", country: "EG" }).expect(201)).body.id as string;
    const legal = await http().get("/v1/tenant/legal").set(as("sara", store)).expect(200);
    expect(legal.body).toMatchObject({ status: "draft", needsAcceptance: false });
    expect(legal.body.documents.map((d: { acceptedAt: string | null }) => d.acceptedAt)).toEqual([null, null]);
  });
});

describe("once published", () => {
  let app: INestApplication;
  let db: Database;
  let store: string;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => {
    app = await boot("published");
    db = app.get(Database);
  });
  afterAll(() => app.close());

  it("records the owner's acceptance with the new store", async () => {
    const res = await http().post("/v1/tenants").set(as("sara")).send({ name: "Nile Abayas", country: "EG", language: "en", acceptLegal: CURRENT }).expect(201);
    store = res.body.id as string;
    const legal = await http().get("/v1/tenant/legal").set(as("sara", store)).expect(200);
    expect(legal.body).toMatchObject({ status: "published", needsAcceptance: false });
    expect(legal.body.documents).toEqual([
      { document: "terms", version: LEGAL_VERSIONS.terms, acceptedAt: expect.any(String), acceptedBy: { name: "Sara Hassan" } },
      { document: "dpa", version: LEGAL_VERSIONS.dpa, acceptedAt: expect.any(String), acceptedBy: { name: "Sara Hassan" } },
    ]);
    const rows = await db.tenant(store, (trx) => trx.selectFrom("legal_acceptances").select(["document", "language"]).orderBy("document").execute());
    expect(rows).toEqual([{ document: "dpa", language: "en" }, { document: "terms", language: "en" }]);
    const audit = await db.tenant(store, (trx) => trx.selectFrom("audit_log").select("action").where("action", "=", "tenant.legal_accepted").execute());
    expect(audit).toHaveLength(1);
  });

  it("409 legal_version_changed for a stale version at sign-up, and creates nothing", async () => {
    const before = await http().get("/v1/me").set(as("omar")).expect(200);
    const res = await http().post("/v1/tenants").set(as("omar")).send({ name: "Old Terms", country: "EG", acceptLegal: { ...CURRENT, terms: "0.0" } }).expect(409);
    expect(res.body).toMatchObject({ code: "legal_version_changed", title: "The terms were updated" });
    const after = await http().get("/v1/me").set(as("omar")).expect(200);
    expect(after.body.memberships).toEqual(before.body.memberships);
  });

  it("a store created without accepting needs the owner to accept; the owner accepts, twice is fine", async () => {
    const other = (await http().post("/v1/tenants").set(as("omar")).send({ name: "Gulf Oud", country: "SA" }).expect(201)).body.id as string;
    expect((await http().get("/v1/tenant/legal").set(as("omar", other)).expect(200)).body.needsAcceptance).toBe(true);

    const stale = await http().post("/v1/tenant/legal/accept").set(as("omar", other)).send({ terms: LEGAL_VERSIONS.terms, dpa: "9.9" }).expect(409);
    expect(stale.body.code).toBe("legal_version_changed");

    const ok = await http().post("/v1/tenant/legal/accept").set(as("omar", other)).send({ ...CURRENT, language: "ar" }).expect(200);
    expect(ok.body.needsAcceptance).toBe(false);
    await http().post("/v1/tenant/legal/accept").set(as("omar", other)).send(CURRENT).expect(200);
    const rows = await db.tenant(other, (trx) => trx.selectFrom("legal_acceptances").select(["document", "language"]).execute());
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.language === "ar")).toBe(true); // the first acceptance stays
    const audit = await db.tenant(other, (trx) => trx.selectFrom("audit_log").select("action").where("action", "=", "tenant.legal_accepted").execute());
    expect(audit).toHaveLength(1); // the second accept recorded nothing, so it is not audited either

    // Another store sees only its own acceptances (RLS).
    expect(await db.tenant(store, (trx) => trx.selectFrom("legal_acceptances").select("tenant_id").execute()))
      .toEqual([{ tenant_id: store }, { tenant_id: store }]);
  });

  it("only the owner accepts; any member reads", async () => {
    const mona = (await db.kysely.insertInto("users").values({ firebase_uid: "fb-mona", email: "mona@example.com" }).returning("id").executeTakeFirstOrThrow()).id;
    await db.kysely.insertInto("memberships").values({ tenant_id: store, user_id: mona, role: "admin", status: "active" }).execute();
    expect((await http().get("/v1/tenant/legal").set(as("mona", store)).expect(200)).body.needsAcceptance).toBe(false);
    const res = await http().post("/v1/tenant/legal/accept").set(as("mona", store)).send(CURRENT).expect(403);
    expect(res.body.code).toBe("insufficient_role");
  });

  it("422 for a malformed version or unknown fields", async () => {
    await http().post("/v1/tenant/legal/accept").set(as("sara", store)).send({ terms: "latest", dpa: LEGAL_VERSIONS.dpa }).expect(422);
    await http().post("/v1/tenant/legal/accept").set(as("sara", store)).send({ ...CURRENT, privacy: "0.1" }).expect(422);
  });
});
