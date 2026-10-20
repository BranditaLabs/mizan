import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { AuditService } from "../src/platform/audit/audit.service.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { FakeVerifier } from "./support/fake-auth.js";

const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
const http = () => request(app.getHttpServer());
const as = (token: string, tenant?: string) => ({
  Authorization: `Bearer ${token}`, "X-Forwarded-For": "197.34.12.9", ...(tenant ? { "X-Tenant-Id": tenant } : {}),
});

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "http://localhost", WEB_URL: "http://localhost:3000" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  fake.add("owner", { uid: "fb-owner", name: "Sara" });
  fake.add("agent", { uid: "fb-agent", email: "agent@example.com", emailVerified: true });
  store = (await http().post("/v1/tenants").set(as("owner")).send({ name: "Audit Store", country: "EG" }).expect(201)).body.id;
});
afterAll(() => app.close());

describe("audit trail", () => {
  it("records team actions with actor, IP, before/after — and no contact details", async () => {
    const inv = await http().post("/v1/members/invite").set(as("owner", store)).send({ email: "agent@example.com", role: "agent" }).expect(201);
    await http().post(`/v1/invitations/${inv.body.id}/accept`).set(as("agent")).expect(200);
    const agentId = (await http().get("/v1/me").set(as("agent")).expect(200)).body.user.id;
    await http().patch(`/v1/members/${agentId}`).set(as("owner", store)).send({ role: "ops_manager" }).expect(200);
    await http().delete(`/v1/members/${agentId}`).set(as("owner", store)).expect(204);

    const res = await http().get("/v1/audit-log").set(as("owner", store)).expect(200);
    expect(res.body.data.map((e: { action: string }) => e.action)).toEqual([
      "member.removed", "member.updated", "member.joined", "member.invited", "tenant.created",
    ]);
    const updated = res.body.data[1];
    expect(updated).toMatchObject({
      actor: { type: "user", displayName: "Sara" },
      entity: { type: "member", id: agentId },
      before: { role: "agent", status: "active" },
      after: { role: "ops_manager", status: "active" },
      ip: "197.34.12.9",
    });
    expect(JSON.stringify(res.body)).not.toContain("agent@example.com");
  });

  it("revoking an invitation is audited", async () => {
    const inv = await http().post("/v1/members/invite").set(as("owner", store)).send({ phone: "01001234821", role: "warehouse" }).expect(201);
    await http().delete(`/v1/invitations/${inv.body.id}`).set(as("owner", store)).expect(204);
    const res = await http().get("/v1/audit-log?action=member.invitation_revoked").set(as("owner", store)).expect(200);
    expect(res.body.data).toEqual([expect.objectContaining({ action: "member.invitation_revoked", before: { role: "warehouse" } })]);
  });

  it("no change without its entry: a rolled-back change leaves no audit row", async () => {
    const audit = app.get(AuditService);
    await expect(db.tenant(store, async (trx) => {
      await audit.record(trx, { action: "export.created", tenantId: store, actor: { type: "system" } });
      throw new Error("export failed");
    })).rejects.toThrow("export failed");
    const res = await http().get("/v1/audit-log?action=export.created").set(as("owner", store)).expect(200);
    expect(res.body.data).toEqual([]);
  });

  it("redacts personal data that slips into before/after", async () => {
    const audit = app.get(AuditService);
    await db.tenant(store, (trx) => audit.record(trx, {
      action: "customer.pii_viewed", tenantId: store, actor: { type: "user", id: "00000000-0000-4000-8000-000000000000" },
      entity: { type: "customer", id: "c1" }, after: { phone: "01001234821", note: "called 01001234821", fields: ["phone"] },
    }));
    const res = await http().get("/v1/audit-log?action=customer.").set(as("owner", store)).expect(200);
    expect(res.body.data[0].after).toEqual({ phone: "[redacted]", note: "called 010•••4821", fields: ["phone"] });
  });

  it("pages with an opaque cursor and filters by action prefix", async () => {
    const page1 = await http().get("/v1/audit-log?limit=2").set(as("owner", store)).expect(200);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.nextCursor).toMatch(/^\d+$/);
    const page2 = await http().get(`/v1/audit-log?limit=2&cursor=${page1.body.nextCursor}`).set(as("owner", store)).expect(200);
    expect(Number(page2.body.data[0].id)).toBeLessThan(Number(page1.body.data[1].id));
    const members = await http().get("/v1/audit-log?action=member.").set(as("owner", store)).expect(200);
    expect(members.body.data.every((e: { action: string }) => e.action.startsWith("member."))).toBe(true);
    await http().get("/v1/audit-log?limit=500").set(as("owner", store)).expect(422);
  });

  it("only owners and admins read it, and only for their store", async () => {
    fake.add("other-owner", { uid: "fb-other" });
    const other = (await http().post("/v1/tenants").set(as("other-owner")).send({ name: "Other", country: "EG" }).expect(201)).body.id;
    const res = await http().get("/v1/audit-log").set(as("other-owner", other)).expect(200);
    expect(res.body.data.map((e: { action: string }) => e.action)).toEqual(["tenant.created"]);
    const inv = await http().post("/v1/members/invite").set(as("owner", store)).send({ email: "fin@example.com", role: "finance" }).expect(201);
    fake.add("fin", { uid: "fb-fin", email: "fin@example.com", emailVerified: true });
    await http().post(`/v1/invitations/${inv.body.id}/accept`).set(as("fin")).expect(200);
    expect((await http().get("/v1/audit-log").set(as("fin", store)).expect(403)).body.code).toBe("insufficient_role");
  });
});
