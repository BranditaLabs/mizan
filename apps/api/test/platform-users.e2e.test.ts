import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * A-5: staff find Mizan users and see their stores; super admins stop and allow sign-in. A
 * disabled person is refused on every request at once, and each of their stores sees it.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let shop: string;
let agentId: string;
const http = () => request(app.getHttpServer());
const as = (token: string, tenant?: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", ...(tenant ? { "X-Tenant-Id": tenant } : {}) });

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test", PLATFORM_BOOTSTRAP_EMAILS: "boss@mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  fake.add("boss", { uid: "fb-boss-a5", email: "boss@mizan.test", emailVerified: true, secondFactor: "totp" });
  fake.add("help", { uid: "fb-help-a5", email: "help@mizan.test", emailVerified: true, secondFactor: "totp" });
  fake.add("money", { uid: "fb-money-a5", email: "money@mizan.test", emailVerified: true, secondFactor: "totp" });
  fake.add("owner", { uid: "fb-owner-a5", email: "owner@nile.test", emailVerified: true, secondFactor: "phone", name: "Mona Adel" });
  fake.add("agent", { uid: "fb-agent-a5", phone: "+201001234567", name: "Karim" });
  shop = (await http().post("/v1/tenants").set(as("owner")).send({ name: "Nile Abayas", country: "EG" }).expect(201)).body.id;
  for (const t of ["help", "money", "agent"]) await http().get("/v1/me").set(as(t)).expect(200);
  await http().get("/v1/platform/me").set(as("boss")).expect(200);
  await http().post("/v1/platform/staff").set(as("boss")).send({ email: "help@mizan.test", role: "support" }).expect(201);
  await http().post("/v1/platform/staff").set(as("boss")).send({ email: "money@mizan.test", role: "finance" }).expect(201);
});
afterAll(() => app.close());

describe("users in the back office (A-5)", () => {
  it("support finds people by email, phone, name or id; finance cannot", async () => {
    await http().get("/v1/platform/users").set(as("money")).expect(403);
    const byEmail = (await http().get("/v1/platform/users?q=NILE.test").set(as("help")).expect(200)).body;
    expect(byEmail.total).toBe(1);
    expect(byEmail.data[0]).toMatchObject({ email: "owner@nile.test", name: "Mona Adel", stores: 1, staffRole: null, disabled: null });
    const byPhone = (await http().get("/v1/platform/users?q=01001234567").set(as("help")).expect(200)).body.data;
    expect(byPhone.map((u: { phone: string }) => u.phone)).toEqual(["+201001234567"]);
    agentId = byPhone[0].id;
    expect((await http().get(`/v1/platform/users?q=${agentId}`).set(as("help")).expect(200)).body.total).toBe(1);
    expect((await http().get("/v1/platform/users?q=help@").set(as("help")).expect(200)).body.data[0].staffRole).toBe("support");
    expect((await http().get("/v1/platform/users?limit=2").set(as("help")).expect(200)).body).toMatchObject({ total: 5, nextOffset: 2 });
  });

  it("a person's detail lists their stores", async () => {
    const owner = (await http().get("/v1/platform/users?q=owner@nile").set(as("help")).expect(200)).body.data[0];
    const d = (await http().get(`/v1/platform/users/${owner.id}`).set(as("help")).expect(200)).body;
    expect(d.memberships).toEqual([expect.objectContaining({ storeId: shop, storeName: "Nile Abayas", role: "owner", status: "active" })]);
    await http().get(`/v1/platform/users/${crypto.randomUUID()}`).set(as("help")).expect(404);
  });

  it("a super admin disables sign-in: refused at once, the person's stores see it; enabling lets them back", async () => {
    // The agent joins the store first, so the store has something to see.
    const invite = (await http().post("/v1/members/invite").set(as("owner", shop)).send({ phone: "+201001234567", role: "agent" }).expect(201)).body;
    await http().post(`/v1/invitations/${invite.id}/accept`).set(as("agent")).expect((r) => expect([200, 201]).toContain(r.status));
    await http().get("/v1/me").set(as("agent")).expect(200);

    await http().post(`/v1/platform/users/${agentId}/disable`).set(as("help")).send({ reason: "account compromised" }).expect(403);
    await http().post(`/v1/platform/users/${agentId}/disable`).set(as("boss")).send({}).expect(422);
    const d = (await http().post(`/v1/platform/users/${agentId}/disable`).set(as("boss")).send({ reason: "account compromised" }).expect(200)).body;
    expect(d.disabled).toMatchObject({ reason: "account compromised" });
    expect((await http().get("/v1/me").set(as("agent")).expect(403)).body.code).toBe("user_disabled");
    expect((await http().get("/v1/orders").set(as("agent", shop)).expect(403)).body.code).toBe("user_disabled");
    await http().post(`/v1/platform/users/${agentId}/disable`).set(as("boss")).send({ reason: "again" }).expect(200); // unchanged
    expect((await http().get("/v1/platform/users?disabled=true").set(as("help")).expect(200)).body.data.map((u: { id: string }) => u.id)).toEqual([agentId]);

    const log = (await http().get("/v1/audit-log?action=user.").set(as("owner", shop)).expect(200)).body.data;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "user.sign_in_disabled", actor: { type: "mizan_staff" }, entity: { type: "user", id: agentId }, after: { reason: "account compromised" } });

    expect((await http().post(`/v1/platform/users/${agentId}/enable`).set(as("boss")).expect(200)).body.disabled).toBeNull();
    await http().get("/v1/me").set(as("agent")).expect(200);
    expect((await http().get("/v1/audit-log?action=user.").set(as("owner", shop)).expect(200)).body.data.map((e: { action: string }) => e.action)).toEqual(["user.sign_in_enabled", "user.sign_in_disabled"]);
  });

  it("staff must lose their staff access before their sign-in; nobody disables themselves", async () => {
    const help = (await http().get("/v1/platform/users?q=help@mizan").set(as("boss")).expect(200)).body.data[0];
    expect((await http().post(`/v1/platform/users/${help.id}/disable`).set(as("boss")).send({ reason: "left Mizan" }).expect(409)).body.code).toBe("user_is_staff");
    const boss = (await http().get("/v1/platform/users?q=boss@mizan").set(as("boss")).expect(200)).body.data[0];
    expect((await http().post(`/v1/platform/users/${boss.id}/disable`).set(as("boss")).send({ reason: "testing" }).expect(409)).body.code).toBe("not_yourself");
    const staffId = (await http().get("/v1/platform/staff").set(as("boss")).expect(200)).body.data.find((s: { email: string }) => s.email === "help@mizan.test").id;
    await http().patch(`/v1/platform/staff/${staffId}`).set(as("boss")).send({ status: "disabled" }).expect(200);
    await http().post(`/v1/platform/users/${help.id}/disable`).set(as("boss")).send({ reason: "left Mizan" }).expect(200);
    expect((await http().get("/v1/platform/me").set(as("help")).expect(403)).body.code).toBe("user_disabled");
  });
});
