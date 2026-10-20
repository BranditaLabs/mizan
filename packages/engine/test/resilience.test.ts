import { describe, expect, it } from "vitest";
import { IntegrationError } from "../src/core/errors.js";
import { CircuitBreaker } from "../src/resilience/circuit.js";
import { send } from "../src/resilience/http.js";
import { AdaptiveBucket } from "../src/resilience/limiter.js";
import { FakeClock, hang, json, testRuntime } from "./fakes/clock.js";

function server(script: Array<(init: RequestInit) => Promise<Response> | Response>) {
  let i = 0;
  const calls: number[] = [];
  return {
    calls,
    route: (_u: URL, init: RequestInit) => {
      calls.push(i);
      const step = script[Math.min(i, script.length - 1)];
      i++;
      return step(init);
    },
  };
}

describe("resilient HTTP", () => {
  it("retries transient 5xx and network errors, then succeeds", async () => {
    const clock = new FakeClock();
    const s = server([() => json(502, {}), () => { throw new TypeError("ECONNRESET"); }, () => json(200, { ok: true })]);
    const rt = testRuntime(clock, { "api.test": s.route });
    const res = await send(rt, { connector: "t", op: "t.get", method: "GET", url: "https://api.test/x", idempotent: true });
    expect(res.json).toEqual({ ok: true });
    expect(s.calls.length).toBe(3);
  });

  it("waits at least Retry-After on 429", async () => {
    const clock = new FakeClock();
    const start = clock.now();
    const s = server([() => json(429, { message: "slow down" }, { "Retry-After": "7" }), () => json(200, {})]);
    const rt = testRuntime(clock, { "api.test": s.route });
    await send(rt, { connector: "t", op: "t.get", method: "GET", url: "https://api.test/x", idempotent: true });
    expect(clock.now() - start).toBeGreaterThanOrEqual(7_000);
  });

  it("does not retry auth or validation errors", async () => {
    const clock = new FakeClock();
    const s = server([() => json(401, { message: "token revoked" })]);
    const rt = testRuntime(clock, { "api.test": s.route });
    await expect(send(rt, { connector: "t", op: "t.get", method: "GET", url: "https://api.test/x", idempotent: true })).rejects.toMatchObject({ kind: "auth" });
    expect(s.calls.length).toBe(1);
  });

  it("times out hung requests; never blindly re-sends a non-idempotent one", async () => {
    const clock = new FakeClock();
    const s = server([(init) => hang(init), () => json(200, {})]);
    const rt = testRuntime(clock, { "api.test": s.route });
    const err = await send(rt, { connector: "t", op: "t.create", method: "POST", url: "https://api.test/x", body: {}, idempotent: false, timeoutMs: 1_000 }).catch((e) => e);
    expect(err).toBeInstanceOf(IntegrationError);
    expect(err.kind).toBe("timeout");
    expect(s.calls.length).toBe(1); // the caller must verify before retrying
  });

  it("retries a hung idempotent request", async () => {
    const clock = new FakeClock();
    const s = server([(init) => hang(init), () => json(200, { ok: 1 })]);
    const rt = testRuntime(clock, { "api.test": s.route });
    const res = await send(rt, { connector: "t", op: "t.get", method: "GET", url: "https://api.test/x", idempotent: true, timeoutMs: 1_000 });
    expect(res.json).toEqual({ ok: 1 });
  });

  it("opens the circuit after repeated failures, fails fast, then recovers", async () => {
    const clock = new FakeClock();
    const circuit = new CircuitBreaker("t", clock, { failureThreshold: 3, openMs: 10_000 });
    let healthy = false;
    let hits = 0;
    const rt = testRuntime(clock, { "api.test": () => { hits++; return healthy ? json(200, {}) : json(503, {}); } });
    const call = () => send(rt, { connector: "t", op: "t.get", method: "GET", url: "https://api.test/x", idempotent: true, maxAttempts: 1 }, { circuit });
    for (let i = 0; i < 3; i++) await call().catch(() => undefined);
    expect(circuit.status.state).toBe("open");
    const before = hits;
    await expect(call()).rejects.toMatchObject({ kind: "circuit_open" });
    expect(hits).toBe(before); // no request reached the failing provider
    clock.advance(10_000);
    healthy = true;
    await call();
    expect(circuit.status.state).toBe("closed");
  });
});

describe("circuit breaker regression", () => {
  it("closes again when the half-open trial is answered with 429 (found by the 50% chaos run)", async () => {
    const clock = new FakeClock();
    const circuit = new CircuitBreaker("t", clock, { failureThreshold: 2, openMs: 1_000 });
    const answers = [503, 503, 429, 200, 200];
    let i = 0;
    const rt = testRuntime(clock, { "api.test": () => json(answers[Math.min(i++, answers.length - 1)], {}) });
    const call = () => send(rt, { connector: "t", op: "t.get", method: "GET", url: "https://api.test/x", idempotent: true, maxAttempts: 1 }, { circuit });
    await call().catch(() => undefined);
    await call().catch(() => undefined);
    expect(circuit.status.state).toBe("open");
    clock.advance(1_000);
    await expect(call()).rejects.toMatchObject({ kind: "rate_limited" }); // the half-open trial gets a 429
    expect(circuit.status.state).toBe("closed"); // provider answered, so it is up: no stuck trial
    await expect(call()).resolves.toBeTruthy();
  });
});

describe("adaptive rate limiter", () => {
  it("halves its pace on 429 and recovers on success", () => {
    const clock = new FakeClock();
    const b = new AdaptiveBucket(clock, { capacity: 10, refillPerSec: 8 });
    b.onThrottled();
    expect(b.snapshot.refillPerSec).toBe(4);
    for (let i = 0; i < 20; i++) b.onSuccess();
    expect(b.snapshot.refillPerSec).toBe(8);
  });

  it("re-syncs to the provider's reported budget", async () => {
    const clock = new FakeClock();
    const b = new AdaptiveBucket(clock, { capacity: 1000, refillPerSec: 100 });
    b.syncFromServer({ available: 50, capacity: 2000, refillPerSec: 200 });
    expect(b.snapshot).toMatchObject({ tokens: 50, capacity: 2000, refillPerSec: 200 });
    const t0 = clock.now();
    await b.acquire(250); // needs 200 more tokens at 200/s → 1 s
    expect(clock.now() - t0).toBe(1_000);
  });
});
