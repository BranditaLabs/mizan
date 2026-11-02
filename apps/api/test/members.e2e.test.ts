import "reflect-metadata";
import { Writable } from "node:stream";
import { Controller, Get, Module, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { Roles } from "../src/platform/auth/decorators.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { FakeVerifier } from "./support/fake-auth.js";

/** Stand-ins for module routes: one any member can use, one for ops management. */
@Controller("probe")
class ProbeController {
  @Get("queue")
  @Roles("agent", "ops_manager", "owner", "admin")
  queue() {
    return { ok: true };
  }

  @Get("ops")
  @Roles("ops_manager", "owner", "admin")
  ops() {
    return { ok: true };
  }
}
@Module({ controllers: [ProbeController] })
class ProbeModule {}

const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
const http = () => request(app.getHttpServer());
const as = (token: string, tenant?: string) => ({
  Authorization: `Bearer ${token}`, "Accept-Language": "en", ...(tenant ? { "X-Tenant-Id": tenant } : {}),
});
const userId = async (uid: string) => (await db.kysely.selectFrom("users").select("id").where("firebase_uid", "=", uid).executeTakeFirstOrThrow()).id;

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "http://localhost", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake, modules: [ProbeModule] });
  await app.init();
  db = app.get(Database);
  fake.add("owner", { uid: "fb-owner", email: "owner@nile.test", emailVerified: true });
  store = (await http().post("/v1/tenants").set(as("owner")).send({ name: "Nile Abayas", country: "EG" }).expect(201)).body.id;
});
afterAll(() => app.close());

/** Invite by email or phone, then sign in as that person and accept. Returns their token. */
async function join(token: string, role: string, contact: { email?: string; phone?: string }) {
  const inv = await http().post("/v1/members/invite").set(as("owner", store)).send({ role, ...contact }).expect(201);
  fake.add(token, { uid: `fb-${token}`, ...(contact.email ? { email: contact.email, emailVerified: true } : { phone: contact.phone }) });
  await http().post(`/v1/invitations/${inv.body.id}/accept`).set(as(token)).expect(200);
  return token;
}

describe("invitations", () => {
  it("an invited agent signs in, accepts, and reaches only agent routes", async () => {
    const inv = await http().post("/v1/members/invite").set(as("owner", store)).send({ phone: "010 0123 4821", role: "agent" }).expect(201);
    expect(inv.body).toMatchObject({ phone: "+201001234821", email: null, role: "agent", status: "pending", acceptUrl: `https://app.mizan.test/invitations/${inv.body.id}` });

    // The agent signs in with phone OTP (Firebase): the invitation shows up in /me.
    fake.add("agent", { uid: "fb-agent", phone: "+201001234821" });
    const me = await http().get("/v1/me").set(as("agent")).expect(200);
    expect(me.body.memberships).toEqual([]);
    expect(me.body.invitations).toEqual([{ id: inv.body.id, tenantId: store, tenantName: "Nile Abayas", role: "agent", expiresAt: inv.body.expiresAt }]);

    // Before accepting: not a member.
    expect((await http().get("/v1/probe/queue").set(as("agent", store)).expect(403)).body.code).toBe("not_a_member");

    await http().post(`/v1/invitations/${inv.body.id}/accept`).set(as("agent")).expect(200, { tenantId: store, role: "agent" });

    await http().get("/v1/probe/queue").set(as("agent", store)).expect(200);
    expect((await http().get("/v1/probe/ops").set(as("agent", store)).expect(403)).body.code).toBe("insufficient_role");
    expect((await http().get("/v1/members").set(as("agent", store)).expect(403)).body.code).toBe("insufficient_role");
    expect((await http().post("/v1/members/invite").set(as("agent", store)).send({ email: "x@y.test", role: "agent" }).expect(403)).body.code).toBe("insufficient_role");

    const after = await http().get("/v1/me").set(as("agent")).expect(200);
    expect(after.body.invitations).toEqual([]);
    expect(after.body.memberships).toEqual([expect.objectContaining({ tenantId: store, role: "agent", status: "active" })]);

    // Accepting twice is a 404, not a second membership.
    expect((await http().post(`/v1/invitations/${inv.body.id}/accept`).set(as("agent")).expect(404)).body.code).toBe("invitation_not_found");
  });

  it("only the invited, verified identity can accept", async () => {
    const inv = await http().post("/v1/members/invite").set(as("owner", store)).send({ email: "Mona@Example.com", role: "finance" }).expect(201);
    expect(inv.body.email).toBe("mona@example.com");
    fake.add("mallory", { uid: "fb-mallory", email: "mallory@example.com", emailVerified: true });
    fake.add("mona-unverified", { uid: "fb-mona-u", email: "mona@example.com", emailVerified: false });
    for (const token of ["mallory", "mona-unverified"]) {
      expect((await http().post(`/v1/invitations/${inv.body.id}/accept`).set(as(token)).expect(404)).body.code).toBe("invitation_not_found");
      expect((await http().get("/v1/me").set(as(token)).expect(200)).body.invitations).toEqual([]);
    }
    fake.add("mona", { uid: "fb-mona", email: "MONA@example.com", emailVerified: true });
    await http().post(`/v1/invitations/${inv.body.id}/accept`).set(as("mona")).expect(200, { tenantId: store, role: "finance" });
  });

  it("re-inviting refreshes the pending invitation; members cannot be invited again", async () => {
    const a = await http().post("/v1/members/invite").set(as("owner", store)).send({ email: "kareem@example.com", role: "agent" }).expect(201);
    const b = await http().post("/v1/members/invite").set(as("owner", store)).send({ email: "kareem@example.com", role: "warehouse" }).expect(201);
    expect(b.body).toMatchObject({ id: a.body.id, role: "warehouse" });
    expect((await http().post("/v1/members/invite").set(as("owner", store)).send({ phone: "+201001234821", role: "agent" }).expect(409)).body.code).toBe("already_member");
  });

  it("revoked and expired invitations cannot be accepted", async () => {
    const r = await http().post("/v1/members/invite").set(as("owner", store)).send({ email: "late@example.com", role: "agent" }).expect(201);
    await http().delete(`/v1/invitations/${r.body.id}`).set(as("owner", store)).expect(204);
    fake.add("late", { uid: "fb-late", email: "late@example.com", emailVerified: true });
    await http().post(`/v1/invitations/${r.body.id}/accept`).set(as("late")).expect(404);
    await http().delete(`/v1/invitations/${r.body.id}`).set(as("owner", store)).expect(404);

    const e = await http().post("/v1/members/invite").set(as("owner", store)).send({ email: "late@example.com", role: "agent" }).expect(201);
    await db.tenant(store, (trx) => trx.updateTable("invitations").set({ expires_at: new Date(Date.now() - 1000) }).where("id", "=", e.body.id).execute());
    await http().post(`/v1/invitations/${e.body.id}/accept`).set(as("late")).expect(404);
  });

  it("validates the invite body", async () => {
    const both = await http().post("/v1/members/invite").set(as("owner", store)).send({ email: "a@b.test", phone: "01001234821", role: "agent" }).expect(422);
    expect(both.body.code).toBe("validation_failed");
    const phone = await http().post("/v1/members/invite").set(as("owner", store)).send({ phone: "12345", role: "agent" }).expect(422);
    expect(phone.body.errors).toEqual([{ path: "phone", code: "invalid_phone" }]);
    await http().post("/v1/members/invite").set(as("owner", store)).send({ email: "a@b.test", role: "cashier" }).expect(422);
  });

  it("only owners invite owners", async () => {
    await join("admin1", "admin", { email: "admin1@example.com" });
    expect((await http().post("/v1/members/invite").set(as("admin1", store)).send({ email: "boss@example.com", role: "owner" }).expect(403)).body.code).toBe("insufficient_role");
    await http().post("/v1/members/invite").set(as("admin1", store)).send({ email: "helper@example.com", role: "agent" }).expect(201);
  });
});

describe("member management", () => {
  it("lists members and pending invitations for owners and admins", async () => {
    const res = await http().get("/v1/members").set(as("owner", store)).expect(200);
    expect(res.body.members.map((m: { role: string }) => m.role)).toEqual(expect.arrayContaining(["owner", "agent", "finance", "admin"]));
    expect(res.body.invitations.every((i: { status: string }) => i.status === "pending")).toBe(true);
  });

  it("changes a role and disables a member; a disabled member is locked out at once", async () => {
    await join("packer", "warehouse", { email: "packer@example.com" });
    const id = await userId("fb-packer");
    const promoted = await http().patch(`/v1/members/${id}`).set(as("owner", store)).send({ role: "ops_manager" }).expect(200);
    expect(promoted.body).toMatchObject({ userId: id, role: "ops_manager", status: "active", email: "packer@example.com" });
    await http().get("/v1/probe/ops").set(as("packer", store)).expect(200);

    await http().patch(`/v1/members/${id}`).set(as("owner", store)).send({ status: "disabled" }).expect(200);
    expect((await http().get("/v1/probe/queue").set(as("packer", store)).expect(403)).body.code).toBe("not_a_member");

    await http().patch(`/v1/members/${id}`).set(as("owner", store)).send({ status: "active" }).expect(200);
    await http().get("/v1/probe/queue").set(as("packer", store)).expect(200);
  });

  it("removes a member", async () => {
    await join("temp", "agent", { email: "temp@example.com" });
    const id = await userId("fb-temp");
    await http().delete(`/v1/members/${id}`).set(as("owner", store)).expect(204);
    await http().get("/v1/probe/queue").set(as("temp", store)).expect(403);
    expect((await http().delete(`/v1/members/${id}`).set(as("owner", store)).expect(404)).body.code).toBe("member_not_found");
  });

  it("guards against lock-out: not yourself, owners only by owners, never the last owner", async () => {
    const ownerId = await userId("fb-owner");
    const adminId = await userId("fb-admin1");
    expect((await http().patch(`/v1/members/${ownerId}`).set(as("owner", store)).send({ role: "admin" }).expect(422)).body.code).toBe("cannot_change_self");
    expect((await http().delete(`/v1/members/${ownerId}`).set(as("owner", store)).expect(422)).body.code).toBe("cannot_change_self");
    expect((await http().patch(`/v1/members/${ownerId}`).set(as("admin1", store)).send({ status: "disabled" }).expect(403)).body.code).toBe("insufficient_role");
    expect((await http().patch(`/v1/members/${adminId}`).set(as("admin1", store)).send({ role: "agent" }).expect(422)).body.code).toBe("cannot_change_self");

    // Promote the admin to owner, then the first owner can be demoted; the remaining owner cannot.
    await http().patch(`/v1/members/${adminId}`).set(as("owner", store)).send({ role: "owner" }).expect(200);
    await http().patch(`/v1/members/${ownerId}`).set(as("admin1", store)).send({ role: "admin" }).expect(200);
    const last = await http().patch(`/v1/members/${adminId}`).set(as("admin1", store)).send({ role: "admin" }).expect(422);
    expect(last.body.code).toBe("cannot_change_self");
    expect((await http().patch(`/v1/members/${adminId}`).set(as("owner", store)).send({ role: "admin" }).expect(403)).body.code).toBe("insufficient_role");
  });

  it("validates the update body and ids", async () => {
    const id = await userId("fb-agent");
    await http().patch(`/v1/members/${id}`).set(as("admin1", store)).send({}).expect(422);
    await http().patch(`/v1/members/${id}`).set(as("admin1", store)).send({ status: "invited" }).expect(422);
    expect((await http().patch("/v1/members/not-a-uuid").set(as("admin1", store)).send({ role: "agent" }).expect(404)).body.code).toBe("member_not_found");
  });

  it("members of another store are invisible", async () => {
    fake.add("rival", { uid: "fb-rival" });
    const other = (await http().post("/v1/tenants").set(as("rival")).send({ name: "Rival Store", country: "EG" }).expect(201)).body.id;
    const agentId = await userId("fb-agent");
    expect((await http().patch(`/v1/members/${agentId}`).set(as("rival", other)).send({ role: "admin" }).expect(404)).body.code).toBe("member_not_found");
    const list = await http().get("/v1/members").set(as("rival", other)).expect(200);
    expect(list.body.members).toHaveLength(1);
  });
});
