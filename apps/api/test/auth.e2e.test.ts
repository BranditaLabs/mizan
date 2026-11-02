import "reflect-metadata";
import { Writable } from "node:stream";
import { Controller, Get, Module, type INestApplication } from "@nestjs/common";
import { MEMBER_ROLES, type MemberRole } from "@mizan/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { Auth, Roles } from "../src/platform/auth/decorators.js";
import type { AuthContext } from "../src/platform/auth/auth.types.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { FakeVerifier } from "./support/fake-auth.js";

@Controller("probe")
class ProbeController {
  @Get("any-member")
  anyMember(@Auth() auth: AuthContext) {
    return { tenant: auth.tenant, userId: auth.user.id };
  }

  @Get("admins")
  @Roles("owner", "admin")
  admins() {
    return { ok: true };
  }

  @Get("finance")
  @Roles("owner", "finance")
  finance() {
    return { ok: true };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

const STORE = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER = "bbbbbbbb-0000-4000-8000-000000000002";
const SUSPENDED = "cccccccc-0000-4000-8000-000000000003";

const fake = new FakeVerifier();
const quiet = new Writable({ write: (_c, _e, done) => done() });

async function boot(env: Record<string, string> = {}) {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "http://localhost", WEB_URL: "http://localhost:3000", ...env });
  const app = await createApp(config, { logDestination: quiet, tokenVerifier: fake, modules: [ProbeModule] });
  await app.init();
  return app;
}

let app: INestApplication;
let db: Database;
const userIds = new Map<string, string>();
const http = () => request(app.getHttpServer());
const as = (token: string, tenant?: string) => {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "Accept-Language": "en" };
  if (tenant) headers["X-Tenant-Id"] = tenant;
  return headers;
};

/** Create a user (as the API would on first sign-in) and a membership. */
async function member(token: string, tenant: string, role: MemberRole, status: "active" | "invited" | "disabled" = "active") {
  const uid = `fb-${token}`;
  fake.add(token, { uid, email: `${token}@example.com` });
  let id = userIds.get(uid);
  if (!id) {
    id = (await db.kysely.insertInto("users").values({ firebase_uid: uid }).returning("id").executeTakeFirstOrThrow()).id;
    userIds.set(uid, id);
  }
  await db.kysely.insertInto("memberships").values({ tenant_id: tenant, user_id: id, role, status }).execute();
  return token;
}

beforeAll(async () => {
  app = await boot();
  db = app.get(Database);
  await db.kysely.insertInto("tenants").values([
    { id: STORE, name: "Nile Abayas", slug: "nile" },
    { id: OTHER, name: "Gulf Perfumes", slug: "gulf", country: "SA", base_currency: "SAR", timezone: "Asia/Riyadh", locale: "ar-SA" },
    { id: SUSPENDED, name: "Old Shop", slug: "old", status: "suspended" },
  ]).execute();
  for (const role of MEMBER_ROLES) await member(role, STORE, role);
});
afterAll(() => app.close());

describe("sign-in", () => {
  it("401 without a bearer token", async () => {
    const res = await http().get("/v1/probe/any-member").set("Accept-Language", "en").expect(401);
    expect(res.body).toMatchObject({ code: "unauthorized", title: "Sign-in required" });
  });

  it("401 token_invalid for an unknown token (Arabic title by default)", async () => {
    const res = await http().get("/v1/probe/any-member").set("Authorization", "Bearer forged").expect(401);
    expect(res.body).toMatchObject({ code: "token_invalid", title: "تسجيل الدخول مش صالح" });
  });

  it("public routes stay public", async () => {
    await http().get("/health").expect(200);
  });
});

describe("tenant membership", () => {
  it("400 when X-Tenant-Id is missing or not a UUID", async () => {
    expect((await http().get("/v1/probe/any-member").set(as("owner")).expect(400)).body.code).toBe("tenant_header_required");
    expect((await http().get("/v1/probe/any-member").set(as("owner", "1 OR 1=1")).expect(400)).body.code).toBe("invalid_tenant_id");
  });

  it("an active member gets the tenant and role on the request", async () => {
    const res = await http().get("/v1/probe/any-member").set(as("agent", STORE)).expect(200);
    expect(res.body).toEqual({ tenant: { id: STORE, role: "agent" }, userId: userIds.get("fb-agent") });
  });

  it("the same 403 for another store, an unknown store, invited and disabled members", async () => {
    await member("invitee", STORE, "agent", "invited");
    await member("leaver", STORE, "agent", "disabled");
    const unknown = "dddddddd-0000-4000-8000-000000000004";
    for (const [token, tenant] of [["owner", OTHER], ["owner", unknown], ["invitee", STORE], ["leaver", STORE]] as const) {
      const res = await http().get("/v1/probe/any-member").set(as(token, tenant)).expect(403);
      expect(res.body.code).toBe("not_a_member");
    }
  });

  it("403 tenant_inactive for a suspended store", async () => {
    await member("old-owner", SUSPENDED, "owner");
    expect((await http().get("/v1/probe/any-member").set(as("old-owner", SUSPENDED)).expect(403)).body.code).toBe("tenant_inactive");
  });
});

describe("@Roles for every role", () => {
  it.each(MEMBER_ROLES)("%s", async (role) => {
    await http().get("/v1/probe/any-member").set(as(role, STORE)).expect(200);
    const admins = await http().get("/v1/probe/admins").set(as(role, STORE));
    expect(admins.status).toBe(role === "owner" || role === "admin" ? 200 : 403);
    const finance = await http().get("/v1/probe/finance").set(as(role, STORE));
    expect(finance.status).toBe(role === "owner" || role === "finance" ? 200 : 403);
    if (finance.status === 403) expect(finance.body).toMatchObject({ code: "insufficient_role", title: "Your role cannot do this" });
  });
});

describe("GET /v1/me", () => {
  it("creates the user on first sign-in, once, even under concurrent requests", async () => {
    fake.add("newcomer", { uid: "fb-newcomer", email: "new@example.com", phone: "+201001234821", name: "Mona", emailVerified: true });
    const results = await Promise.all(Array.from({ length: 5 }, () => http().get("/v1/me").set(as("newcomer"))));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const rows = await db.kysely.selectFrom("users").select(["id", "email", "phone_e164", "display_name"]).where("firebase_uid", "=", "fb-newcomer").execute();
    expect(rows).toHaveLength(1);
    expect(results[0]!.body).toEqual({
      user: { id: rows[0]!.id, firebaseUid: "fb-newcomer", email: "new@example.com", phone: "+201001234821", displayName: "Mona",
        language: "ar", emailVerified: true, mfa: false },
      memberships: [],
      invitations: [],
    });
  });

  it("follows profile changes from Firebase", async () => {
    fake.add("newcomer", { uid: "fb-newcomer", email: "mona@example.com", phone: "+201001234821", name: "Mona A." });
    const res = await http().get("/v1/me").set(as("newcomer")).expect(200);
    expect(res.body.user).toMatchObject({ email: "mona@example.com", displayName: "Mona A." });
  });

  it("lists only the caller's memberships, across stores, without X-Tenant-Id", async () => {
    await member("finance", OTHER, "owner");
    const res = await http().get("/v1/me").set(as("finance")).expect(200);
    expect(res.body.memberships).toEqual([
      { tenantId: OTHER, tenantName: "Gulf Perfumes", tenantSlug: "gulf", tenantStatus: "active", country: "SA", baseCurrency: "SAR",
        locale: "ar-SA", timezone: "Asia/Riyadh", role: "owner", status: "active" },
      { tenantId: STORE, tenantName: "Nile Abayas", tenantSlug: "nile", tenantStatus: "active", country: "EG", baseCurrency: "EGP",
        locale: "ar-EG", timezone: "Africa/Cairo", role: "finance", status: "active" },
    ]);
  });
});

describe("two-step verification", () => {
  it("owners and admins need a second factor when AUTH_REQUIRE_MFA is on; other roles do not", async () => {
    const strict = await boot({ AUTH_REQUIRE_MFA: "true" });
    const sdb = strict.get(Database);
    const t = "eeeeeeee-0000-4000-8000-000000000005";
    await sdb.kysely.insertInto("tenants").values({ id: t, name: "MFA Store", slug: "mfa" }).execute();
    const add = async (token: string, role: MemberRole, secondFactor?: string) => {
      fake.add(token, { uid: `fb-${token}`, ...(secondFactor ? { secondFactor } : {}) });
      const u = await sdb.kysely.insertInto("users").values({ firebase_uid: `fb-${token}` }).returning("id").executeTakeFirstOrThrow();
      await sdb.kysely.insertInto("memberships").values({ tenant_id: t, user_id: u.id, role }).execute();
    };
    await add("mfa-owner-no2fa", "owner");
    await add("mfa-owner-totp", "owner", "totp");
    await add("mfa-agent", "agent");
    const h = request(strict.getHttpServer());
    expect((await h.get("/v1/probe/any-member").set(as("mfa-owner-no2fa", t)).expect(403)).body.code).toBe("mfa_required");
    await h.get("/v1/probe/any-member").set(as("mfa-owner-totp", t)).expect(200);
    await h.get("/v1/probe/any-member").set(as("mfa-agent", t)).expect(200);
    await strict.close();
  });
});
