import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * A-2: stores in the back office. Staff find stores and see their health; super admins suspend and
 * reactivate, finance changes plans, anyone on the staff keeps internal notes. Every change shows in
 * the store's own audit log as Mizan staff, and a suspended store's members are refused at once.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let shop: string;
let other: string;
const http = () => request(app.getHttpServer());
const as = (token: string, tenant?: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", ...(tenant ? { "X-Tenant-Id": tenant } : {}) });

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test", PLATFORM_BOOTSTRAP_EMAILS: "boss@mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  fake.add("boss", { uid: "fb-boss-a2", email: "boss@mizan.test", emailVerified: true, secondFactor: "totp" });
  fake.add("money", { uid: "fb-money-a2", email: "money@mizan.test", emailVerified: true, secondFactor: "totp" });
  fake.add("help", { uid: "fb-help-a2", email: "help@mizan.test", emailVerified: true, secondFactor: "phone" });
  fake.add("owner", { uid: "fb-owner-a2", email: "owner@nile.test", emailVerified: true, secondFactor: "phone" });
  fake.add("owner2", { uid: "fb-owner2-a2", email: "owner@delta.test", emailVerified: true, secondFactor: "phone" });
  shop = (await http().post("/v1/tenants").set(as("owner")).send({ name: "Nile Abayas", country: "EG" }).expect(201)).body.id;
  other = (await http().post("/v1/tenants").set(as("owner2")).send({ name: "Delta Perfumes", country: "SA" }).expect(201)).body.id;
  for (const t of ["money", "help"]) await http().get("/v1/me").set(as(t)).expect(200);
  await http().get("/v1/platform/me").set(as("boss")).expect(200);
  await http().post("/v1/platform/staff").set(as("boss")).send({ email: "money@mizan.test", role: "finance" }).expect(201);
  await http().post("/v1/platform/staff").set(as("boss")).send({ email: "help@mizan.test", role: "support" }).expect(201);
});
afterAll(() => app.close());

describe("back-office stores (A-2)", () => {
  it("merchants cannot reach it; every staff member can search and filter stores", async () => {
    expect((await http().get("/v1/platform/stores").set(as("owner", shop)).expect(403)).body.code).toBe("not_staff");
    const all = (await http().get("/v1/platform/stores").set(as("help")).expect(200)).body;
    expect(all.total).toBe(2);
    expect(all.data[0]).toMatchObject({ name: "Delta Perfumes", plan: "free", members: 1, connections: { total: 0, needsAttention: 0 }, lastMonth: null }); // newest first
    expect((await http().get("/v1/platform/stores?q=nile").set(as("help")).expect(200)).body.data.map((s: { id: string }) => s.id)).toEqual([shop]);
    expect((await http().get(`/v1/platform/stores?q=${shop}`).set(as("help")).expect(200)).body.total).toBe(1);
    expect((await http().get("/v1/platform/stores?country=SA").set(as("help")).expect(200)).body.data.map((s: { id: string }) => s.id)).toEqual([other]);
    expect((await http().get("/v1/platform/stores?q=%25").set(as("help")).expect(200)).body.total).toBe(0); // wildcards are literal
    const page = (await http().get("/v1/platform/stores?limit=1").set(as("help")).expect(200)).body;
    expect(page).toMatchObject({ total: 2, nextOffset: 1 });
    expect((await http().get("/v1/platform/stores?limit=1&offset=1").set(as("help")).expect(200)).body.nextOffset).toBeNull();
    const today = new Date().toISOString().slice(0, 10);
    expect((await http().get(`/v1/platform/stores?createdFrom=${today}&createdTo=${today}&sort=orders`).set(as("help")).expect(200)).body.total).toBe(2);
    await http().get("/v1/platform/stores?plan=gold").set(as("help")).expect(422);
  });

  it("a store's detail shows its team, integrations, jobs and usage", async () => {
    const d = (await http().get(`/v1/platform/stores/${shop}`).set(as("help")).expect(200)).body;
    expect(d).toMatchObject({ id: shop, name: "Nile Abayas", currency: "EGP", status: "active", outbox: { pending: 0, running: 0, dead: 0, oldestPendingAt: null }, deadLetters: [], usage: [], notes: [] });
    expect(d.team).toEqual([expect.objectContaining({ email: "owner@nile.test", role: "owner", status: "active" })]);
    await http().get("/v1/platform/stores/00000000-0000-4000-8000-000000000000").set(as("help")).expect(404);
    await http().get("/v1/platform/stores/nope").set(as("help")).expect(400);
  });

  it("only a super admin suspends; the store's members are refused at once and see who did it", async () => {
    expect((await http().post(`/v1/platform/stores/${shop}/suspend`).set(as("help")).send({ reason: "unpaid invoice" }).expect(403)).body.code).toBe("insufficient_role");
    expect((await http().post(`/v1/platform/stores/${shop}/suspend`).set(as("money")).send({ reason: "unpaid invoice" }).expect(403)).body.code).toBe("insufficient_role");
    await http().post(`/v1/platform/stores/${shop}/suspend`).set(as("boss")).send({}).expect(422); // a reason is required

    await http().get("/v1/audit-log").set(as("owner", shop)).expect(200); // membership cached while active
    expect((await http().post(`/v1/platform/stores/${shop}/suspend`).set(as("boss")).send({ reason: "unpaid invoice" }).expect(200)).body).toMatchObject({ id: shop, status: "suspended" });
    expect((await http().get("/v1/audit-log").set(as("owner", shop)).expect(403)).body.code).toBe("tenant_inactive");
    expect((await http().post(`/v1/platform/stores/${shop}/suspend`).set(as("boss")).send({ reason: "again" }).expect(409)).body.code).toBe("already_suspended");
    await http().get(`/v1/audit-log`).set(as("owner2", other)).expect(200); // other stores carry on

    expect((await http().post(`/v1/platform/stores/${other}/reactivate`).set(as("boss")).send({}).expect(409)).body.code).toBe("not_suspended");
    expect((await http().post(`/v1/platform/stores/${shop}/reactivate`).set(as("boss")).send({ reason: "paid" }).expect(200)).body.status).toBe("active");
    const log = (await http().get("/v1/audit-log?action=store.").set(as("owner", shop)).expect(200)).body.data;
    expect(log.map((e: { action: string }) => e.action)).toEqual(["store.reactivated", "store.suspended"]);
    expect(log[1]).toMatchObject({ actor: { type: "mizan_staff", displayName: null }, entity: { type: "store", id: shop }, before: { status: "active" }, after: { status: "suspended", reason: "unpaid invoice" } });
    expect((await http().get("/v1/audit-log?action=store.").set(as("owner2", other)).expect(200)).body.data).toEqual([]);
  });

  it("finance and super admins change the plan; the same plan changes nothing", async () => {
    await http().put(`/v1/platform/stores/${shop}/plan`).set(as("help")).send({ plan: "growth" }).expect(403);
    expect((await http().put(`/v1/platform/stores/${shop}/plan`).set(as("money")).send({ plan: "growth", reason: "annual deal" }).expect(200)).body.plan).toBe("growth");
    await http().put(`/v1/platform/stores/${shop}/plan`).set(as("money")).send({ plan: "growth" }).expect(200);
    const log = (await http().get("/v1/audit-log?action=store.plan_changed").set(as("owner", shop)).expect(200)).body.data;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ before: { plan: "free" }, after: { plan: "growth", reason: "annual deal" } });
    expect((await http().get("/v1/usage").set(as("owner", shop)).expect(200)).body.plan).toBe("growth"); // limits follow
    expect((await http().get("/v1/platform/stores?plan=growth").set(as("help")).expect(200)).body.data.map((s: { id: string }) => s.id)).toEqual([shop]);
  });

  it("anyone on the staff keeps internal notes the store never sees; every call is in the staff trail", async () => {
    const note = (await http().post(`/v1/platform/stores/${shop}/notes`).set(as("help")).send({ body: "Owner prefers WhatsApp calls after 2pm" }).expect(201)).body;
    expect(note).toMatchObject({ body: "Owner prefers WhatsApp calls after 2pm", by: "help@mizan.test" });
    await http().post(`/v1/platform/stores/${shop}/notes`).set(as("help")).send({ body: "x".repeat(2001) }).expect(422);
    await http().post("/v1/platform/stores/00000000-0000-4000-8000-000000000000/notes").set(as("help")).send({ body: "hi" }).expect(404);
    expect((await http().get(`/v1/platform/stores/${shop}`).set(as("boss")).expect(200)).body.notes.map((n: { body: string }) => n.body)).toEqual(["Owner prefers WhatsApp calls after 2pm"]);
    expect(JSON.stringify((await http().get("/v1/audit-log").set(as("owner", shop)).expect(200)).body)).not.toContain("WhatsApp calls after");

    const trail = (await http().get("/v1/platform/audit?limit=200").set(as("boss")).expect(200)).body.data;
    const suspend = trail.filter((l: { action: string; storeId: string | null }) => l.action === "POST /v1/platform/stores/:storeId/suspend" && l.storeId === shop);
    expect(suspend.map((l: { outcome: string; status: number }) => `${l.outcome}:${l.status}`).sort()).toEqual(["denied:403", "denied:403", "failed:409", "failed:422", "ok:200"]);
  });
});
