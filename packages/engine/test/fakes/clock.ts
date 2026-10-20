import type { Clock, Runtime } from "../../src/core/runtime.js";
import { silentLogger } from "../../src/core/runtime.js";

/**
 * Virtual clock: sleeping advances time instantly (after the current
 * microtasks settle), so a 30-minute backoff takes microseconds. A sleep that
 * is aborted before it fires (e.g. a request timeout guard after the request
 * finished) does not move time at all.
 */
export class FakeClock implements Clock {
  t = Date.parse("2026-10-20T08:00:00Z");
  now() {
    return this.t;
  }
  async sleep(ms: number, signal?: AbortSignal) {
    if (signal?.aborted) throw signal.reason;
    const target = this.t + ms;
    await new Promise<void>((r) => setImmediate(r));
    if (signal?.aborted) throw signal.reason;
    if (target > this.t) this.t = target;
  }
  advance(ms: number) {
    this.t += ms;
  }
}

/** Deterministic PRNG (mulberry32) so chaos runs are repeatable. */
export function seeded(seed = 42) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Route = (url: URL, init: RequestInit) => Promise<Response> | Response;

export function testRuntime(clock: FakeClock, routes: Record<string, Route>, random = seeded(7)): Runtime {
  return {
    clock,
    random,
    logger: process.env.MIZAN_LOG ? { log: (l, m, d) => console.log(l, m, JSON.stringify(d)) } : silentLogger,
    fetch: async (url, init) => {
      const u = new URL(url);
      const route = routes[u.host];
      if (!route) throw new TypeError(`fetch failed: no fake server for ${u.host}`);
      return route(u, init);
    },
  };
}

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** A response that never arrives unless the request is aborted (simulates a hung connection). */
export function hang(init: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    const s = init.signal;
    if (!s) return;
    if (s.aborted) return reject(s.reason);
    s.addEventListener("abort", () => reject(s.reason), { once: true });
  });
}
