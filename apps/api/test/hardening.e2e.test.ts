import "reflect-metadata";
import { Writable } from "node:stream";
import { Body, Controller, Module, Post, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { Public } from "../src/platform/auth/decorators.js";
import { loadConfig } from "../src/platform/config.js";

@Public()
@Controller("echo")
class EchoController {
  @Post()
  echo(@Body() body: unknown) {
    return { body, padding: "x".repeat(4096) };
  }
}
@Module({ controllers: [EchoController] })
class EchoModule {}

let app: INestApplication;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  const config = loadConfig({
    NODE_ENV: "production", PUBLIC_URL: "https://api.mizan.app", WEB_URL: "https://app.mizan.app", ADMIN_URL: "https://admin.mizan.app",
    DATABASE_URL: "postgres://unused/mizan", FIREBASE_PROJECT_ID: "mizan-prod", MAX_BODY_BYTES: "2048",
    KMS_KEY_NAME: "projects/p/locations/me-central1/keyRings/r/cryptoKeys/k", LINK_SIGNING_KEY: Buffer.alloc(32, 3).toString("base64"),
  });
  // Production config, but tests run on PGlite and a local key.
  app = await createApp({ ...config, DATABASE_URL: undefined, KMS_KEY_NAME: undefined, SECRETS_DEV_KEY: Buffer.alloc(32, 1).toString("base64") }, {
    logDestination: new Writable({ write: (_c, _e, d) => d() }), modules: [EchoModule],
  });
  await app.init();
});
afterAll(() => app.close());

describe("HTTP hardening", () => {
  it("sends security headers for a JSON API", async () => {
    const res = await http().get("/health").expect(200);
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["strict-transport-security"]).toContain("max-age=63072000");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("allows only the web and admin apps cross-origin", async () => {
    for (const origin of ["https://app.mizan.app", "https://admin.mizan.app"]) {
      const pre = await http().options("/v1/me").set("Origin", origin).set("Access-Control-Request-Method", "GET")
        .set("Access-Control-Request-Headers", "authorization,x-tenant-id,idempotency-key").expect(204);
      expect(pre.headers["access-control-allow-origin"]).toBe(origin);
      expect(pre.headers["access-control-allow-headers"]).toMatch(/X-Tenant-Id/i);
      expect(pre.headers["access-control-allow-credentials"]).toBeUndefined();
    }
    const evil = await http().options("/v1/me").set("Origin", "https://evil.example").set("Access-Control-Request-Method", "GET");
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
    const res = await http().get("/health").set("Origin", "https://app.mizan.app").expect(200);
    expect(res.headers["access-control-expose-headers"]).toMatch(/X-Request-Id/);
  });

  it("caps the body size and rejects malformed JSON as problem+json", async () => {
    const big = await http().post("/v1/echo").set("Content-Type", "application/json").send(JSON.stringify({ x: "y".repeat(4000) })).expect(413);
    expect(big.headers["content-type"]).toMatch(/problem\+json/);
    expect(big.body).toMatchObject({ code: "payload_too_large", status: 413 });
    const bad = await http().post("/v1/echo").set("Content-Type", "application/json").send("{not json").expect(400);
    expect(bad.body).toMatchObject({ code: "bad_request" });
    await http().post("/v1/echo").send({ ok: true }).expect(201);
  });

  it("compresses large responses", async () => {
    const res = await http().post("/v1/echo").set("Accept-Encoding", "gzip").send({ a: 1 }).expect(201);
    expect(res.headers["content-encoding"]).toBe("gzip");
    const small = await http().get("/health").set("Accept-Encoding", "gzip").expect(200);
    expect(small.headers["content-encoding"]).toBeUndefined();
  });
});
