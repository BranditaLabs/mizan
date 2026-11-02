import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import { sql } from "kysely";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * A-3: Mizan support reaches a store's data only through a grant with a reason and an expiry,
 * read-only unless a super admin opened it for writing. The store sees it (banner, audit log) and
 * can end it; access ends at expiry on the very next request.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let shop: string;
const http = () => request(app.getHttpServer());
const as = (token: string, tenant?: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", ...(tenant ? { "X-Tenant-Id": tenant } : {}) });

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test", PLATFORM_BOOTSTRAP_EMAILS: "boss@mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  fake.add("boss", { uid: "fb-boss-a3", email: "boss@mizan.test", emailVerified: true, secondFactor: "totp" });
  fake.add("help", { uid: "fb-help-a3", email: "help@mizan.test", emailVerified: true, secondFactor: "phone" });
  fake.add("help-nomfa", { uid: "fb-help-a3", email: "help@mizan.test", emailVerified: true });
  fake.add("money", { uid: "fb-money-a3", email: "money@mizan.test", emailVerified: true, secondFactor: "totp" });
  fake.add("owner", { uid: "fb-owner-a3", email: "owner@nile.test", emailVerified: true, secondFactor: "phone" });
  shop = (await http().post("/v1/tenants").set(as("owner")).send({ name: "Nile Abayas", country: "EG" }).expect(201)).body.id;
  for (const t of ["help", "money"]) await http().get("/v1/me").set(as(t)).expect(200);
  await http().get("/v1/platform/me").set(as("boss")).expect(200);
  await http().post("/v1/platform/staff").set(as("boss")).send({ email: "help@mizan.test", role: "support" }).expect(201);
  await http().post("/v1/platform/staff").set(as("boss")).send({ email: "money@mizan.test", role: "finance" }).expect(201);
});
afterAll(() => app.close());

describe("support access (A-3)", () => {
  it("staff without a grant are strangers to the store", async () => {
    expect((await http().get("/v1/orders").set(as("help", shop)).expect(403)).body.code).toBe("not_a_member");
    expect((await http().post(`/v1/platform/stores/${shop}/access`).set(as("money")).send({ reason: "check invoices" }).expect(403)).body.code).toBe("insufficient_role");
    expect((await http().post(`/v1/platform/stores/${shop}/access`).set(as("help")).send({ reason: "courier sync stuck", mode: "write" }).expect(403)).body.code).toBe("insufficient_role");
    await http().post(`/v1/platform/stores/${shop}/access`).set(as("help")).send({ reason: "x" }).expect(422);
    await http().post(`/v1/platform/stores/${shop}/access`).set(as("help")).send({ reason: "courier sync stuck", minutes: 481 }).expect(422);
  });

  it("read access: the store's screens, never its writes, team or customer exports; the store sees who is in", async () => {
    const g = (await http().post(`/v1/platform/stores/${shop}/access`).set(as("help")).send({ reason: "courier sync stuck", minutes: 30 }).expect(201)).body;
    expect(g).toMatchObject({ storeId: shop, storeName: "Nile Abayas", mode: "read", reason: "courier sync stuck" });
    expect(Date.parse(g.expiresAt) - Date.parse(g.startedAt)).toBe(30 * 60_000);
    expect((await http().post(`/v1/platform/stores/${shop}/access`).set(as("help")).send({ reason: "again please" }).expect(409)).body.code).toBe("access_open");

    await http().get("/v1/orders").set(as("help", shop)).expect(200);
    expect((await http().get("/v1/orders").set(as("help-nomfa", shop)).expect(403)).body.code).toBe("not_a_member"); // a second factor, always
    expect((await http().post("/v1/tickets").set(as("help", shop)).send({ type: "complaint", description: "test" }).expect(403)).body.code).toBe("support_read_only");
    expect((await http().get("/v1/privacy-requests/00000000-0000-4000-8000-000000000000/export").set(as("help", shop)).expect(403)).body.code).toBe("support_not_allowed");
    expect((await http().get("/v1/platform/access").set(as("help")).expect(200)).body.data.map((x: { id: string }) => x.id)).toEqual([g.id]);

    const banner = (await http().get("/v1/support-access").set(as("owner", shop)).expect(200)).body.data;
    expect(banner).toEqual([{ id: g.id, mode: "read", reason: "courier sync stuck", startedAt: g.startedAt, expiresAt: g.expiresAt }]);
    const log = (await http().get("/v1/audit-log?action=support.").set(as("owner", shop)).expect(200)).body.data;
    expect(log[0]).toMatchObject({ action: "support.access_started", actor: { type: "mizan_staff" }, after: { mode: "read", reason: "courier sync stuck" } });

    const trail = (await http().get("/v1/platform/audit?limit=200").set(as("boss")).expect(200)).body.data;
    expect(trail.find((l: { action: string; storeId: string }) => l.action === "GET /v1/orders" && l.storeId === shop)).toMatchObject({ outcome: "ok", target: { type: "support_access", id: g.id } });
  });

  it("the store ends it early and access stops at once", async () => {
    const [g] = (await http().get("/v1/support-access").set(as("owner", shop)).expect(200)).body.data;
    expect((await http().post(`/v1/support-access/${g.id}/end`).set(as("help", shop)).expect(403)).body.code).toBe("support_not_allowed");
    expect((await http().post(`/v1/support-access/${g.id}/end`).set(as("owner", shop)).expect(200)).body).toEqual({ ended: 1 });
    expect((await http().post(`/v1/support-access/${g.id}/end`).set(as("owner", shop)).expect(200)).body).toEqual({ ended: 0 });
    expect((await http().get("/v1/orders").set(as("help", shop)).expect(403)).body.code).toBe("not_a_member");
    expect((await http().get("/v1/support-access").set(as("owner", shop)).expect(200)).body.data).toEqual([]);
    const log = (await http().get("/v1/audit-log?action=support.access_ended").set(as("owner", shop)).expect(200)).body.data;
    expect(log[0]).toMatchObject({ actor: { type: "user" }, after: { by: "store" } });
  });

  it("write access needs a super admin; it ends at its expiry; staff can end it themselves", async () => {
    const g = (await http().post(`/v1/platform/stores/${shop}/access`).set(as("boss")).send({ reason: "fix a stuck refund", mode: "write", minutes: 5 }).expect(201)).body;
    expect((await http().post("/v1/tickets").set(as("boss", shop)).send({ type: "complaint", description: "test" })).body.code).not.toBe("support_read_only");
    expect((await http().post("/v1/members/invite").set(as("boss", shop)).send({ email: "new@nile.test", role: "agent" }).expect(403)).body.code).toBe("support_not_allowed");
    // Time passes: the grant's window moves into the past.
    await sql`UPDATE support_access SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 second' WHERE id = ${g.id}`.execute(app.get(Database).kysely);
    expect((await http().get("/v1/orders").set(as("boss", shop)).expect(403)).body.code).toBe("not_a_member");
    expect((await http().get("/v1/support-access").set(as("owner", shop)).expect(200)).body.data).toEqual([]);
    await http().post(`/v1/platform/stores/${shop}/access/end`).set(as("boss")).expect(404);

    await http().post(`/v1/platform/stores/${shop}/access`).set(as("help")).send({ reason: "follow-up check" }).expect(201);
    expect((await http().post(`/v1/platform/stores/${shop}/access/end`).set(as("help")).expect(200)).body).toEqual({ ended: 1 });
    await http().get("/v1/orders").set(as("help", shop)).expect(403);
  });

  it("a disabled staff member loses support access at once", async () => {
    await http().post(`/v1/platform/stores/${shop}/access`).set(as("help")).send({ reason: "one more look" }).expect(201);
    await http().get("/v1/orders").set(as("help", shop)).expect(200);
    const help = (await http().get("/v1/platform/staff").set(as("boss")).expect(200)).body.data.find((s: { email: string }) => s.email === "help@mizan.test");
    await http().patch(`/v1/platform/staff/${help.id}`).set(as("boss")).send({ status: "disabled" }).expect(200);
    await http().get("/v1/orders").set(as("help", shop)).expect(403);
  });
});
