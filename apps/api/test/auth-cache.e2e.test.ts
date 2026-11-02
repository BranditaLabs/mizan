import "reflect-metadata";
import { Writable } from "node:stream";
import { Controller, Get, Module, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { Auth } from "../src/platform/auth/decorators.js";
import type { AuthContext } from "../src/platform/auth/auth.types.js";
import { TtlCache } from "../src/platform/cache.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { FakeVerifier } from "./support/fake-auth.js";

describe("TtlCache", () => {
  it("expires entries, keeps the most recently used, deletes by predicate", () => {
    let t = 0;
    const c = new TtlCache<string, number>(100, 2, () => t);
    c.set("a", 1);
    c.set("b", 2);
    expect(c.get("a")).toBe(1); // a is now most recent
    c.set("c", 3); // evicts b
    expect(c.get("b")).toBeUndefined();
    t = 150;
    expect(c.get("a")).toBeUndefined();
    c.set("t1:x", 1);
    c.set("t2:y", 2);
    c.deleteWhere((k) => k.startsWith("t1:"));
    expect([c.get("t1:x"), c.get("t2:y")]).toEqual([undefined, 2]);
    const off = new TtlCache<string, number>(0);
    off.set("a", 1);
    expect(off.get("a")).toBeUndefined();
  });
});

@Controller("probe")
class ProbeController {
  @Get()
  probe(@Auth() auth: AuthContext) {
    return { role: auth.tenant?.role };
  }
}
@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe("auth hot path (H-6)", () => {
  const fake = new FakeVerifier();
  let app: INestApplication;
  let db: Database;
  let store: string;
  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}`, "X-Tenant-Id": store });

  beforeAll(async () => {
    const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "http://localhost", WEB_URL: "http://localhost:3000", AUTH_MEMBERSHIP_CACHE_MS: "300" });
    app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake, modules: [ProbeModule] });
    await app.init();
    db = app.get(Database);
    fake.add("owner", { uid: "fb-owner", name: "Sara" });
    store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Cache Store", country: "EG" }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it("a warm request authenticates without touching the database", async () => {
    await http().get("/v1/probe").set(as("owner")).expect(200);
    const tenant = vi.spyOn(db, "tenant");
    const platform = vi.spyOn(db, "platform");
    for (let i = 0; i < 5; i++) await http().get("/v1/probe").set(as("owner")).expect(200, { role: "owner" });
    expect(tenant).not.toHaveBeenCalled();
    expect(platform).not.toHaveBeenCalled();
    tenant.mockRestore();
    platform.mockRestore();
  });

  it("a member disabled on another instance loses access within the membership TTL", async () => {
    const inv = await http().post("/v1/members/invite").set(as("owner")).send({ email: "agent@cache.test", role: "agent" }).expect(201);
    fake.add("agent", { uid: "fb-agent", email: "agent@cache.test", emailVerified: true });
    await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: "Bearer agent" }).expect(200);
    await http().get("/v1/probe").set(as("agent")).expect(200);
    // Another API instance disables the agent: this instance's cache does not know yet.
    await db.kysely.updateTable("memberships").set({ status: "disabled" }).where("tenant_id", "=", store).where("role", "=", "agent").execute();
    await http().get("/v1/probe").set(as("agent")).expect(200);
    await new Promise((r) => setTimeout(r, 350));
    await http().get("/v1/probe").set(as("agent")).expect(403);
  });

  it("changes made through this instance apply at once", async () => {
    const res = await http().get("/v1/members").set(as("owner")).expect(200);
    const agent = res.body.members.find((m: { role: string }) => m.role === "agent");
    await http().patch(`/v1/members/${agent.userId}`).set(as("owner")).send({ status: "active" }).expect(200);
    await http().get("/v1/probe").set(as("agent")).expect(200);
    await http().patch(`/v1/members/${agent.userId}`).set(as("owner")).send({ status: "disabled" }).expect(200);
    await http().get("/v1/probe").set(as("agent")).expect(403);
  });

  it("a profile change in the token reaches the users table despite the cache", async () => {
    fake.add("owner", { uid: "fb-owner", name: "Sara Adel" });
    const me = await http().get("/v1/me").set({ Authorization: "Bearer owner" }).expect(200);
    expect(me.body.user.displayName).toBe("Sara Adel");
  });
});
