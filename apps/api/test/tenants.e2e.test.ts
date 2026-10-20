import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { MAX_OWNED_TENANTS, slugify } from "../src/modules/tenants/tenants.service.js";
import { FakeVerifier } from "./support/fake-auth.js";

const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
const http = () => request(app.getHttpServer());
const as = (token: string, tenant?: string) => ({
  Authorization: `Bearer ${token}`, "Accept-Language": "en", ...(tenant ? { "X-Tenant-Id": tenant } : {}),
});

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "http://localhost", WEB_URL: "http://localhost:3000" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  fake.add("sara", { uid: "fb-sara", email: "sara@example.com" });
  fake.add("omar", { uid: "fb-omar" });
});
afterAll(() => app.close());

describe("POST /v1/tenants", () => {
  it("creates an Egyptian store: EGP, Africa/Cairo, ar-EG, owner membership, default warehouse", async () => {
    const res = await http().post("/v1/tenants").set(as("sara")).send({ name: "Nile Abayas", country: "EG" }).expect(201);
    expect(res.body).toMatchObject({
      name: "Nile Abayas", slug: "nile-abayas", country: "EG", baseCurrency: "EGP", timezone: "Africa/Cairo", locale: "ar-EG",
      plan: "free", status: "active", role: "owner", settings: { weekStartsOn: 6, phoneCountry: "EG" },
    });
    const id = res.body.id as string;

    const me = await http().get("/v1/me").set(as("sara")).expect(200);
    expect(me.body.memberships).toEqual([expect.objectContaining({ tenantId: id, role: "owner", status: "active" })]);

    const warehouses = await db.tenant(id, (trx) => trx.selectFrom("warehouses").select(["name", "is_default"]).execute());
    expect(warehouses).toEqual([{ name: "المخزن الرئيسي", is_default: true }]);

    const current = await http().get("/v1/tenant").set(as("sara", id)).expect(200);
    expect(current.body).toMatchObject({ id, slug: "nile-abayas", role: "owner" });
  });

  it("uses the country's defaults for KSA, Kuwait (3-decimal currency) and an English dashboard", async () => {
    const sa = await http().post("/v1/tenants").set(as("sara")).send({ name: "Gulf Oud", country: "SA" }).expect(201);
    expect(sa.body).toMatchObject({ baseCurrency: "SAR", timezone: "Asia/Riyadh", locale: "ar-SA", settings: { weekStartsOn: 0, phoneCountry: "SA" } });
    const kw = await http().post("/v1/tenants").set(as("sara")).send({ name: "Kuwait Kicks", country: "KW", language: "en" }).expect(201);
    expect(kw.body).toMatchObject({ baseCurrency: "KWD", timezone: "Asia/Kuwait", locale: "en-KW", settings: { weekStartsOn: 0 } });
    expect(kw.body.settings.phoneCountry).toBeUndefined();
    const wh = await db.tenant(kw.body.id, (trx) => trx.selectFrom("warehouses").select("name").execute());
    expect(wh).toEqual([{ name: "Main warehouse" }]);
  });

  it("derives a unique slug: same name twice, Arabic-only names, reserved words", async () => {
    const a = await http().post("/v1/tenants").set(as("omar")).send({ name: "Nile Abayas", country: "EG" }).expect(201);
    expect(a.body.slug).toMatch(/^nile-abayas-[a-f0-9]{6}$/);
    const ar = await http().post("/v1/tenants").set(as("omar")).send({ name: "عبايات النيل", country: "EG" }).expect(201);
    expect(ar.body.slug).toMatch(/^store-[a-f0-9]{6}$/);
    const reserved = await http().post("/v1/tenants").set(as("omar")).send({ name: "Admin", country: "EG" }).expect(201);
    expect(reserved.body.slug).not.toBe("admin");
  });

  it("409 slug_taken when a chosen slug is taken or reserved", async () => {
    await http().post("/v1/tenants").set(as("omar")).send({ name: "Mine", country: "EG", slug: "omar-store" }).expect(201);
    const taken = await http().post("/v1/tenants").set(as("sara")).send({ name: "Also mine", country: "EG", slug: "omar-store" }).expect(409);
    expect(taken.body).toMatchObject({ code: "slug_taken", title: "Store address taken" });
    expect((await http().post("/v1/tenants").set(as("sara")).send({ name: "X store", country: "EG", slug: "api" }).expect(409)).body.code).toBe("slug_taken");
  });

  it("422 for an unsupported country, a short name, a bad slug or unknown fields", async () => {
    const bad = await http().post("/v1/tenants").set(as("sara")).send({ name: "A", country: "US", slug: "Bad Slug", plan: "scale" }).expect(422);
    expect(bad.body.errors.map((e: { path: string }) => e.path).sort()).toEqual(["", "country", "name", "slug"]);
  });

  it("needs a signed-in user but no X-Tenant-Id", async () => {
    await http().post("/v1/tenants").send({ name: "Anon", country: "EG" }).expect(401);
  });

  it("caps the stores one account can own", async () => {
    fake.add("collector", { uid: "fb-collector" });
    for (let i = 0; i < MAX_OWNED_TENANTS; i++) {
      await http().post("/v1/tenants").set(as("collector")).send({ name: `Shop ${i}`, country: "EG" }).expect(201);
    }
    const res = await http().post("/v1/tenants").set(as("collector")).send({ name: "One more", country: "EG" }).expect(422);
    expect(res.body.code).toBe("tenant_limit_reached");
  });

  it("another user cannot open the new store", async () => {
    const res = await http().post("/v1/tenants").set(as("sara")).send({ name: "Private Store", country: "EG" }).expect(201);
    expect((await http().get("/v1/tenant").set(as("omar", res.body.id)).expect(403)).body.code).toBe("not_a_member");
  });
});

describe("slugify", () => {
  it.each([
    ["Nile Abayas & Co.", "nile-abayas-co"],
    ["  Café Crème  ", "cafe-creme"],
    ["عبايات النيل", ""],
    ["a".repeat(60), "a".repeat(40)],
    ["x-".repeat(30), "x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x".slice(0, 39)],
  ])("%j → %j", (name, slug) => expect(slugify(name)).toBe(slug));
});
