import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * A-9: company sign-in. Staff route a store's verified domain to its identity provider; the
 * sign-in screen looks a work email up; a token from that provider counts only for that domain,
 * and its provider owns the second factor.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let shop: string;
let other: string;
const http = () => request(app.getHttpServer());
const as = (token: string, tenant?: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", ...(tenant ? { "X-Tenant-Id": tenant } : {}) });
const lookup = (email: string) => http().post("/v1/public/sso").send({ email });

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test", PLATFORM_BOOTSTRAP_EMAILS: "boss@mizan.test", AUTH_REQUIRE_MFA: "true" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  fake.add("boss", { uid: "fb-boss-a9", email: "boss@mizan.test", emailVerified: true, secondFactor: "totp" });
  fake.add("help", { uid: "fb-help-a9", email: "help@mizan.test", emailVerified: true, secondFactor: "phone" });
  fake.add("owner", { uid: "fb-owner-a9", email: "owner@acme.test", emailVerified: true, secondFactor: "phone" });
  fake.add("owner2", { uid: "fb-owner2-a9", email: "owner@delta.test", emailVerified: true, secondFactor: "phone" });
  fake.add("sara", { uid: "fb-sara-a9", email: "Sara@Acme.TEST", emailVerified: true, signInProvider: "saml.acme" });
  fake.add("forged", { uid: "fb-forged-a9", email: "omar@delta.test", emailVerified: true, signInProvider: "saml.acme" });
  fake.add("wrongIdp", { uid: "fb-wrong-a9", email: "nour@acme.test", emailVerified: true, signInProvider: "oidc.elsewhere" });
  fake.add("noMfa", { uid: "fb-nomfa-a9", email: "plain@acme.test", emailVerified: true, signInProvider: "password" });
  shop = (await http().post("/v1/tenants").set(as("owner")).send({ name: "Acme Abayas", country: "EG" }).expect(201)).body.id;
  other = (await http().post("/v1/tenants").set(as("owner2")).send({ name: "Delta Perfumes", country: "SA" }).expect(201)).body.id;
  await http().get("/v1/me").set(as("help")).expect(200);
  await http().get("/v1/platform/me").set(as("boss")).expect(200);
  await http().post("/v1/platform/staff").set(as("boss")).send({ email: "help@mizan.test", role: "support" }).expect(201);
});
afterAll(() => app.close());

describe("company sign-in (A-9)", () => {
  it("answers the same 404 for any email without company sign-in", async () => {
    expect((await lookup("sara@acme.test").expect(404)).body.code).toBe("sso_not_configured");
    expect((await lookup("someone@gmail.com").expect(404)).body.code).toBe("sso_not_configured");
    await lookup("not-an-email").expect(422);
  });

  it("only a super admin routes a domain; public mailboxes and another store's domain are refused", async () => {
    expect((await http().get(`/v1/platform/stores/${shop}/sso`).set(as("help")).expect(200)).body).toEqual({ data: [] });
    expect((await http().put(`/v1/platform/stores/${shop}/sso/acme.test`).set(as("help")).send({ providerId: "saml.acme", reason: "DNS TXT checked" }).expect(403)).body.code).toBe("insufficient_role");
    expect((await http().put(`/v1/platform/stores/${shop}/sso/acme.test`).set(as("owner", shop)).send({ providerId: "saml.acme", reason: "mine" }).expect(403)).body.code).toBe("not_staff");
    expect((await http().put(`/v1/platform/stores/${shop}/sso/gmail.com`).set(as("boss")).send({ providerId: "saml.acme", reason: "DNS TXT checked" }).expect(422)).body.code).toBe("public_email_domain");
    await http().put(`/v1/platform/stores/${shop}/sso/acme.test`).set(as("boss")).send({ providerId: "SAML acme", reason: "DNS TXT checked" }).expect(422);
    await http().put(`/v1/platform/stores/${shop}/sso/acme.test`).set(as("boss")).send({ providerId: "saml.acme" }).expect(422); // how it was verified is required

    const set = (await http().put(`/v1/platform/stores/${shop}/sso/ACME.test`).set(as("boss")).send({ providerId: "saml.acme", reason: "DNS TXT checked with the owner" }).expect(200)).body;
    expect(set).toMatchObject({ domain: "acme.test", providerId: "saml.acme", enabled: true });
    expect((await http().put(`/v1/platform/stores/${other}/sso/acme.test`).set(as("boss")).send({ providerId: "saml.delta", reason: "asked" }).expect(409)).body.code).toBe("domain_taken");
    await http().put(`/v1/platform/stores/00000000-0000-4000-8000-000000000000/sso/x.test`).set(as("boss")).send({ providerId: "saml.x", reason: "asked" }).expect(404);

    expect((await lookup("Sara@ACME.test").expect(200)).body).toEqual({ providerId: "saml.acme" });
    expect((await http().get(`/v1/platform/stores/${shop}/sso`).set(as("help")).expect(200)).body.data).toEqual([expect.objectContaining({ domain: "acme.test", providerId: "saml.acme" })]);
  });

  it("a company token counts only for its own domain, and its provider owns the second factor", async () => {
    expect((await http().get("/v1/me").set(as("sara")).expect(200)).body.user.email).toBe("Sara@Acme.TEST");
    expect((await http().get("/v1/me").set(as("forged")).expect(401)).body.code).toBe("sso_domain_mismatch");
    expect((await http().get("/v1/me").set(as("wrongIdp")).expect(401)).body.code).toBe("sso_domain_mismatch");

    const own = (await http().post("/v1/tenants").set(as("sara")).send({ name: "Sara's Store", country: "EG" }).expect(201)).body.id;
    await http().get("/v1/audit-log").set(as("sara", own)).expect(200); // owner without a Firebase second factor: SSO owns it
    const plain = (await http().post("/v1/tenants").set(as("noMfa")).send({ name: "Plain", country: "EG" }).expect(201)).body.id;
    expect((await http().get("/v1/audit-log").set(as("noMfa", plain)).expect(403)).body.code).toBe("mfa_required");
  });

  it("disabling or removing stops company sign-in at once, and the store sees each change", async () => {
    await http().put(`/v1/platform/stores/${shop}/sso/acme.test`).set(as("boss")).send({ providerId: "saml.acme", enabled: false, reason: "IdP certificate expired" }).expect(200);
    await lookup("sara@acme.test").expect(404);
    expect((await http().get("/v1/me").set(as("sara")).expect(401)).body.code).toBe("sso_domain_mismatch");

    await http().put(`/v1/platform/stores/${shop}/sso/acme.test`).set(as("boss")).send({ providerId: "saml.acme", reason: "new certificate" }).expect(200);
    await http().get("/v1/me").set(as("sara")).expect(200);

    await http().delete(`/v1/platform/stores/${shop}/sso/acme.test`).set(as("help")).send({}).expect(403);
    await http().delete(`/v1/platform/stores/${shop}/sso/acme.test`).set(as("boss")).send({ reason: "moved to passwords" }).expect(204);
    await http().delete(`/v1/platform/stores/${shop}/sso/acme.test`).set(as("boss")).send({}).expect(404);
    await lookup("sara@acme.test").expect(404);

    const log = (await http().get("/v1/audit-log?action=store.").set(as("owner", shop)).expect(200)).body.data.filter((e: { action: string }) => e.action.startsWith("store.sso"));
    expect(log.map((e: { action: string }) => e.action)).toEqual(["store.sso_removed", "store.sso_set", "store.sso_set", "store.sso_set"]);
    expect(log[3]).toMatchObject({ actor: expect.objectContaining({ type: "mizan_staff" }), after: { providerId: "saml.acme", enabled: true, reason: "DNS TXT checked with the owner" } });
  });
});
