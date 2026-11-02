import { IntegrationError, isIntegrationError, kindFromStatus, parseRetryAfter } from "../core/errors.js";
import type { Runtime } from "../core/runtime.js";
import { backoffDelay, DEFAULT_BACKOFF, type BackoffPolicy } from "./backoff.js";
import type { CircuitBreaker } from "./circuit.js";
import type { AdaptiveBucket } from "./limiter.js";

export interface HttpResponse {
  status: number;
  headers: Headers;
  text: string;
  json: unknown;
}

export interface RequestSpec {
  connector: string;
  /** Operation name for logs and metrics, e.g. "bosta.createDelivery". */
  op: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /**
   * Safe to send twice? GETs are; creates usually are not. A non-idempotent
   * request that times out is NOT retried here: the outcome is unknown, so
   * the caller must verify (look the record up) before trying again.
   */
  idempotent: boolean;
  maxAttempts?: number;
  /** Tokens to reserve in the rate limiter (Shopify: estimated query cost). */
  cost?: number;
  /**
   * Body-level classification for APIs that return errors with HTTP 200
   * (GraphQL). Return an error to treat the response as failed.
   */
  inspect?: (res: HttpResponse) => IntegrationError | null;
  /**
   * Classification of an error response (status >= 300) for APIs whose body code says more than
   * the status (Meta: HTTP 400 with code 130429 is a rate limit). Null = the generic status rules.
   */
  classify?: (res: HttpResponse) => IntegrationError | null;
}

export interface Guards {
  circuit?: CircuitBreaker;
  bucket?: AdaptiveBucket;
  backoff?: BackoffPolicy;
}

const HEALTH_FAILURES = new Set(["transient", "timeout"]);

/**
 * The one door every connector request goes through:
 * circuit check → rate limit → timeout → classify → retry with jittered
 * backoff (honouring Retry-After) → report health back to the circuit.
 */
export async function send(rt: Runtime, spec: RequestSpec, guards: Guards = {}): Promise<HttpResponse> {
  const maxAttempts = spec.maxAttempts ?? 5;
  const timeoutMs = spec.timeoutMs ?? 15_000;
  let lastError: IntegrationError | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let admitted = false;
    try {
      guards.circuit?.beforeRequest();
      admitted = true;
      await guards.bucket?.acquire(spec.cost ?? 1);
      const res = await attemptOnce(rt, spec, timeoutMs);
      const bodyError = res.status < 300 ? spec.inspect?.(res) ?? null : null;
      if (res.status >= 300 || bodyError) {
        throw bodyError ?? (res.status >= 300 ? spec.classify?.(res) : null) ?? errorFromResponse(spec, res, rt.clock.now());
      }
      guards.circuit?.onSuccess();
      guards.bucket?.onSuccess();
      return res;
    } catch (raw) {
      const err = toIntegrationError(spec, raw);
      lastError = err;
      if (err.kind === "rate_limited") guards.bucket?.onThrottled();
      // Every request the circuit admitted must report back, or a half-open
      // trial stays "in flight" forever and the circuit never closes.
      if (admitted) {
        if (HEALTH_FAILURES.has(err.kind)) guards.circuit?.onFailure();
        else guards.circuit?.onNeutral(); // provider answered (429, 4xx): it is up
      }

      const unknownOutcome = err.kind === "timeout" && !spec.idempotent;
      const canRetry = err.retryable && !unknownOutcome && attempt + 1 < maxAttempts;
      rt.logger.log(canRetry ? "warn" : "error", "request failed", {
        connector: spec.connector, op: spec.op, attempt: attempt + 1, kind: err.kind, status: err.status, message: err.message,
      });
      if (!canRetry) throw err;
      const wait = Math.max(err.retryAfterMs ?? 0, backoffDelay(attempt, rt.random, guards.backoff ?? DEFAULT_BACKOFF));
      await rt.clock.sleep(wait);
    }
  }
  throw lastError!;
}

async function attemptOnce(rt: Runtime, spec: RequestSpec, timeoutMs: number): Promise<HttpResponse> {
  const ctl = new AbortController();
  const timer = new AbortController();
  const timeout = rt.clock.sleep(timeoutMs, timer.signal).then(
    () => {
      ctl.abort(new IntegrationError({ kind: "timeout", connector: spec.connector, message: `${spec.op} timed out after ${timeoutMs} ms` }));
      throw new IntegrationError({ kind: "timeout", connector: spec.connector, message: `${spec.op} timed out after ${timeoutMs} ms` });
    },
    () => new Promise<never>(() => {}),
  );
  try {
    const call = (async () => {
      const r = await rt.fetch(spec.url, {
        method: spec.method,
        headers: { accept: "application/json", ...(spec.body !== undefined ? { "content-type": "application/json" } : {}), ...spec.headers },
        body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
        signal: ctl.signal,
      });
      const text = await r.text();
      let json: unknown = undefined;
      if (text) {
        try { json = JSON.parse(text); } catch { json = undefined; }
      }
      return { status: r.status, headers: r.headers, text, json } satisfies HttpResponse;
    })();
    call.catch(() => undefined); // the loser of the race must not surface as an unhandled rejection
    return await Promise.race([call, timeout]);
  } finally {
    timer.abort();
  }
}

function errorFromResponse(spec: RequestSpec, res: HttpResponse, now: number): IntegrationError {
  const kind = kindFromStatus(res.status);
  const msg = extractMessage(res.json) ?? res.text.slice(0, 300) ?? `HTTP ${res.status}`;
  return new IntegrationError({
    kind,
    connector: spec.connector,
    status: res.status,
    message: `${spec.op}: HTTP ${res.status} ${msg}`.trim(),
    retryAfterMs: parseRetryAfter(res.headers.get("retry-after"), now),
    details: res.json ?? res.text.slice(0, 2000),
  });
}

function extractMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  for (const k of ["message", "error", "errors", "error_description"]) {
    const v = b[k];
    if (typeof v === "string") return v;
    if (Array.isArray(v) && v.length) return JSON.stringify(v).slice(0, 300);
  }
  return undefined;
}

function toIntegrationError(spec: RequestSpec, e: unknown): IntegrationError {
  if (isIntegrationError(e)) return e;
  const cause = e as { name?: string; cause?: unknown; message?: string };
  if (isIntegrationError(cause?.cause)) return cause.cause;
  if (cause?.name === "AbortError") {
    return new IntegrationError({ kind: "timeout", connector: spec.connector, message: `${spec.op} aborted`, cause: e });
  }
  return new IntegrationError({ kind: "transient", connector: spec.connector, message: `${spec.op}: network error ${cause?.message ?? String(e)}`, cause: e });
}
