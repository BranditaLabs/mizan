import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * A-1: the back office is for Mizan staff only. Merchants get 403 on every platform route, staff
 * need two-step sign-in and the right role, there is always an active super admin, and every call
 * — refusals included — is a line in the staff trail.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let store: string;
const http = () => request(app.getHttpServer());
const as = (token: string, tenant?: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", ...(tenant ? { "X-Tenant-Id": tenant } : {}) });
const ROUTES: Array<[string, string, object?]> = [
  ["get", "/v1/platform/me"], ["get", "/v1/platform/staff"], ["post", "/v1/platform/staff", { email: "x@y.test", role: "support" }],
  ["patch", "/v1/platform/staff/00000000-0000-4000-8000-000000000000", { role: "support" }], ["get", "/v1/platform/audit"],
];
const call = (method: string, path: string, token: string, body?: object) => {
  const r = (http() as unknown as Record<string, (p: string) => request.Test>)[method]!(path).set(as(token));
  return body ? r.send(body) : r;
};

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test", PLATFORM_BOOTSTRAP_EMAILS: "boss@mizan.test, second@mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  fake.add("boss", { uid: "fb-boss", email: "boss@mizan.test", emailVerified: true, secondFactor: "totp" });
  fake.add("second", { uid: "fb-second", email: "second@mizan.test", emailVerified: true }); // no second factor
  fake.add("forged", { uid: "fb-forged", email: "boss2@mizan.test", emailVerified: false, secondFactor: "totp" });
  fake.add("helper", { uid: "fb-helper", email: "helper@mizan.test", emailVerified: true, secondFactor: "phone" });
  fake.add("owner", { uid: "fb-owner-staff", email: "owner@shop.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set(as("owner")).send({ name: "A Shop", country: "EG" }).expect(201)).body.id;
  await http().get("/v1/me").set(as("helper")).expect(200); // signs in once: a Mizan user to add
});
afterAll(() => app.close());

describe("staff identity (A-1)", () => {
  it("merchants get 403 on every platform route, even with their store header", async () => {
    for (const [method, path, body] of ROUTES) {
      const r = await call(method, path, "owner", body).set("X-Tenant-Id", store);
      expect(r.status, `${method} ${path}`).toBe(403);
      expect(r.body.code).toBe("not_staff");
    }
    await http().get("/v1/platform/me").expect(401);
    // An unverified email is never bootstrapped.
    expect((await http().get("/v1/platform/me").set(as("forged")).expect(403)).body.code).toBe("not_staff");
  });

  it("the first super admin comes from the configured emails; staff always need a second factor", async () => {
    expect((await http().get("/v1/platform/me").set(as("boss")).expect(200)).body).toMatchObject({ role: "super_admin", email: "boss@mizan.test" });
    expect((await http().get("/v1/platform/me").set(as("second")).expect(403)).body.code).toBe("mfa_required");
  });

  it("super admins manage the staff; roles narrow what each can do; there is always an active super admin", async () => {
    const helper = (await http().post("/v1/platform/staff").set(as("boss")).send({ email: "HELPER@mizan.test", role: "support" }).expect(201)).body;
    expect(helper).toMatchObject({ email: "helper@mizan.test", role: "support", status: "active" });
    expect((await http().post("/v1/platform/staff").set(as("boss")).send({ email: "helper@mizan.test", role: "finance" }).expect(409)).body.code).toBe("already_staff");
    expect((await http().post("/v1/platform/staff").set(as("boss")).send({ email: "nobody@mizan.test", role: "finance" }).expect(404)).body.code).toBe("user_not_found");
    await http().post("/v1/platform/staff").set(as("boss")).send({ email: "a@b.test", role: "god" }).expect(422);

    expect((await http().get("/v1/platform/me").set(as("helper")).expect(200)).body.role).toBe("support");
    expect((await http().get("/v1/platform/staff").set(as("helper")).expect(403)).body.code).toBe("insufficient_role");
    await http().get("/v1/platform/audit").set(as("helper")).expect(403);

    const list = (await http().get("/v1/platform/staff").set(as("boss")).expect(200)).body.data;
    const boss = list.find((s: { email: string }) => s.email === "boss@mizan.test");
    expect(list.map((s: { role: string }) => s.role).sort()).toEqual(["super_admin", "support"]);
    expect((await http().patch(`/v1/platform/staff/${boss.id}`).set(as("boss")).send({ role: "engineer" }).expect(409)).body.code).toBe("last_super_admin");
    await http().patch(`/v1/platform/staff/${helper.id}`).set(as("boss")).send({ status: "disabled" }).expect(200);
    expect((await http().get("/v1/platform/me").set(as("helper")).expect(403)).body.code).toBe("staff_disabled");
  });

  it("every call is in the staff trail, refusals included; the trail is newest first and pages", async () => {
    const page = (await http().get("/v1/platform/audit?limit=200").set(as("boss")).expect(200)).body;
    const lines = page.data as Array<{ action: string; outcome: string; status: number | null; email: string | null }>;
    expect(lines.some((l) => l.email === "owner@shop.test" && l.outcome === "denied" && l.action === "GET /v1/platform/me")).toBe(true);
    expect(lines.some((l) => l.email === "second@mizan.test" && l.outcome === "denied")).toBe(true);
    expect(lines.some((l) => l.email === "boss@mizan.test" && l.action === "POST /v1/platform/staff" && l.outcome === "ok" && l.status === 201)).toBe(true);
    expect(lines.some((l) => l.action === "POST /v1/platform/staff" && l.outcome === "failed" && l.status === 409)).toBe(true);
    expect(lines.some((l) => l.action === "staff.bootstrapped")).toBe(true);
    expect(lines.some((l) => l.action === "staff.updated")).toBe(true);
    expect(lines.every((l) => !l.action.includes("00000000"))).toBe(true); // routes, never ids
    const ids = page.data.map((l: { id: number }) => l.id);
    expect([...ids].sort((a: number, b: number) => b - a)).toEqual(ids);
    const first = (await http().get("/v1/platform/audit?limit=2").set(as("boss")).expect(200)).body;
    const next = (await http().get(`/v1/platform/audit?limit=2&before=${first.nextBefore}`).set(as("boss")).expect(200)).body;
    expect(next.data[0].id).toBeLessThan(first.data[1].id);
  });
});
