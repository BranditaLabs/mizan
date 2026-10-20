/**
 * Everything with a side effect outside pure logic is injected: time, sleep,
 * HTTP, randomness and logging. Production passes the real ones; tests pass
 * a fake clock and fake servers, so failure scenarios run in milliseconds and
 * are fully repeatable.
 */

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const t = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => {
        clearTimeout(t);
        reject(signal.reason);
      }, { once: true });
    }),
};

export type LogLevel = "debug" | "info" | "warn" | "error";
export interface Logger {
  log(level: LogLevel, msg: string, data?: Record<string, unknown>): void;
}

export const consoleLogger: Logger = {
  log(level, msg, data) {
    const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...data });
    if (level === "error" || level === "warn") console.error(line);
    else console.log(line);
  },
};

export const silentLogger: Logger = { log() {} };

export interface Runtime {
  fetch: FetchFn;
  clock: Clock;
  logger: Logger;
  random: () => number;
}

export function defaultRuntime(overrides: Partial<Runtime> = {}): Runtime {
  return {
    fetch: (url, init) => fetch(url, init),
    clock: systemClock,
    logger: consoleLogger,
    random: Math.random,
    ...overrides,
  };
}
