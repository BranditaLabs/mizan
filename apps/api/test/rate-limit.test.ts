import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { TokenBuckets } from "../src/platform/http/rate-limit.js";
import { FakeVerifier } from "./support/fake-auth.js";

describe("TokenBuckets", () => {
  it("allows a burst, then refills at the per-minute rate", () => {
    let t = 0;
    const b = new TokenBuckets(60, 3, 100, () => t); // 1 token/s, burst 3
    expect([1, 2, 3, 4].map(() => b.take("k").allowed)).toEqual([true, true, true, false]);
    expect(b.take("k")).toMatchObject({ allowed: false, remaining: 0, resetS: 1 });
    t += 1000;
    expect(b.take("k").allowed).toBe(true);
    expect(b.take("k").allowed).toBe(false);
    t += 60_000;
    expect(b.take("k")).toMatchObject({ allowed: true, limit: 3, remaining: 2 });
  });

  it("keeps keys independent and evicts the least recently used past maxKeys", () => {
    const b = new TokenBuckets(60, 1, 2, () => 0);
    expect(b.take("a").allowed).toBe(true);
    expect(b.take("b").allowed).toBe(true);
    expect(b.take("a").allowed).toBe(false);
    b.take("c"); // evicts "b" (least recently used)
    expect(b.size).toBe(2);
    expect(b.take("b").allowed).toBe(true); // fresh bucket
  });
});

describe("rate limits on the API", () => {
  const fake = new FakeVerifier();
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "http://localhost", WEB_URL: "http://localhost:3000", RATE_LIMIT_USER_PER_MIN: "5", RATE_LIMIT_IP_PER_MIN: "12" });
    app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
    await app.init();
    fake.add("sara", { uid: "fb-sara" });
    fake.add("omar", { uid: "fb-omar" });
  });
  afterAll(() => app.close());

  it("limits each user, with RateLimit headers; another user is unaffected", async () => {
    const ip = "10.0.0.1";
    const first = await http().get("/v1/me").set({ Authorization: "Bearer sara", "X-Forwarded-For": ip }).expect(200);
    expect(first.headers["ratelimit-policy"]).toBe('5;w=60;policy="user"');
    expect(first.headers["ratelimit"]).toMatch(/^limit=5, remaining=4, reset=\d+$/);
    for (let i = 0; i < 4; i++) await http().get("/v1/me").set({ Authorization: "Bearer sara", "X-Forwarded-For": ip }).expect(200);
    const limited = await http().get("/v1/me").set({ Authorization: "Bearer sara", "X-Forwarded-For": ip, "Accept-Language": "en" }).expect(429);
    expect(limited.body).toMatchObject({ code: "rate_limited", title: "Too many requests" });
    expect(Number(limited.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    await http().get("/v1/me").set({ Authorization: "Bearer omar", "X-Forwarded-For": "10.0.0.2" }).expect(200);
  });

  it("refuses a flood of bad tokens from one IP before verifying them; probes stay open", async () => {
    const ip = "10.0.0.9";
    let refused = 0;
    for (let i = 0; i < 15; i++) {
      const res = await http().get("/v1/me").set({ Authorization: `Bearer guess-${i}`, "X-Forwarded-For": ip });
      if (res.status === 429) refused++;
      else expect(res.status).toBe(401);
    }
    expect(refused).toBe(3); // 12 per minute per IP
    for (let i = 0; i < 20; i++) await http().get("/health").set("X-Forwarded-For", ip).expect(200);
  });
});
