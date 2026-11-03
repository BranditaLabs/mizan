import { IntegrationError } from "../../core/errors.js";
import type { Runtime } from "../../core/runtime.js";
import { CircuitBreaker } from "../../resilience/circuit.js";
import { send, type HttpResponse } from "../../resilience/http.js";
import { AdaptiveBucket } from "../../resilience/limiter.js";

/** Paymob's regions (docs/06 §7 "Paymob in depth"): one account per region, the same paths on each host. */
export type PaymobRegion = "eg" | "ksa" | "uae" | "om";
export const PAYMOB_HOSTS: Record<PaymobRegion, string> = {
  eg: "https://accept.paymob.com", ksa: "https://ksa.paymob.com", uae: "https://uae.paymob.com", om: "https://oman.paymob.com",
};
/** The Unified Checkout host per region (no separate sandbox host: test keys, same page). */
export const PAYMOB_CHECKOUT: Record<PaymobRegion, string> = {
  eg: "https://eg.checkout.paymob.com", ksa: "https://ksa.checkout.paymob.com", uae: "https://uae.checkout.paymob.com", om: "https://om.checkout.paymob.com",
};

export interface PaymobCredentials {
  region: PaymobRegion;
  /** `sk_test_…` / `sk_live_…`: intentions, refunds, voids, captures (`Authorization: Token …`). */
  secretKey: string;
  /** `pk_…`: the checkout page only. */
  publicKey: string;
  /** For the 60-minute auth token the inquiry calls take (`Authorization: Bearer …`). */
  apiKey: string;
  /** Signs the callbacks (E14-2b). */
  hmacSecret: string;
  /** Mizan's method name → this account's integration id ("card" → 4097558). Same mode as the keys. */
  integrations: Record<string, number>;
}

/** The auth token lasts 60 minutes (Postman, Transaction Inquiry); it is renewed a little before. */
const TOKEN_TTL_MS = 55 * 60_000;

/**
 * Paymob's Accept REST API (E14-2a). Two credentials: the secret key on writes (`Token`), and an
 * auth token from the API key on reads (`Bearer`, cached per connection, renewed on 401). Errors
 * come as `{ detail }`, `{ message }` or field lists; a 404 "Integration ID/Name does not exist"
 * is a set-up mistake (an id of the other mode or another account), never something to retry.
 * No rate limits are published: a conservative bucket per connection.
 */
export class PaymobRest {
  readonly circuit: CircuitBreaker;
  readonly bucket: AdaptiveBucket;
  private token?: { value: string; at: number };

  constructor(readonly creds: PaymobCredentials, private readonly rt: Runtime) {
    this.circuit = new CircuitBreaker(`paymob:${creds.region}`, rt.clock, { failureThreshold: 5, openMs: 30_000 });
    this.bucket = new AdaptiveBucket(rt.clock, { capacity: 5, refillPerSec: 2 });
  }

  get host() {
    return PAYMOB_HOSTS[this.creds.region];
  }

  /** A write with the secret key. Not idempotent unless the caller says so: a timeout is never re-sent here. */
  async withSecret<T>(op: string, method: "POST" | "GET", path: string, body: unknown, idempotent: boolean): Promise<T> {
    const res = await this.call(op, method, path, `Token ${this.creds.secretKey}`, body, idempotent);
    return res.json as T;
  }

  /** A read with the auth token; a 401 renews the token once. */
  async withToken<T>(op: string, method: "POST" | "GET", path: string, body?: unknown): Promise<T> {
    try {
      return (await this.call(op, method, path, `Bearer ${await this.authToken()}`, body, true)).json as T;
    } catch (e) {
      if (!(e instanceof IntegrationError) || e.kind !== "auth" || !this.token) throw e;
      this.token = undefined;
      return (await this.call(op, method, path, `Bearer ${await this.authToken()}`, body, true)).json as T;
    }
  }

  private async authToken(): Promise<string> {
    if (this.token && this.rt.clock.now() - this.token.at < TOKEN_TTL_MS) return this.token.value;
    // Asking for a token twice is harmless (each lives its hour).
    const res = await this.call("auth", "POST", "/api/auth/tokens", null, { api_key: this.creds.apiKey }, true);
    const value = (res.json as { token?: unknown } | undefined)?.token;
    if (typeof value !== "string" || !value) throw new IntegrationError({ kind: "schema_drift", connector: "paymob", message: "auth: the answer has no token" });
    this.token = { value, at: this.rt.clock.now() };
    return value;
  }

  private async call(op: string, method: "POST" | "GET", path: string, authorization: string | null, body: unknown, idempotent: boolean): Promise<HttpResponse> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (authorization) headers.Authorization = authorization;
    const res = await send(this.rt, {
      connector: "paymob", op: `paymob.${op}`, method, url: `${this.host}${path}`, headers, ...(body !== undefined && body !== null ? { body } : {}),
      idempotent, maxAttempts: idempotent ? 5 : 1, timeoutMs: 20_000,
      inspect: (r) => (r.json === undefined && r.status !== 204 ? new IntegrationError({ kind: "transient", connector: "paymob", status: r.status, message: `${op}: the answer was not JSON` }) : null),
      classify: (r) => classify(op, r),
    }, { circuit: this.circuit, bucket: this.bucket });
    return res;
  }
}

/** Status ≥ 300 with what Paymob's body says. Null = the generic rules (429, 5xx, Retry-After). */
export function classify(op: string, res: HttpResponse): IntegrationError | null {
  const body = res.json as Record<string, unknown> | undefined;
  const text = errorText(body) || `HTTP ${res.status}`;
  const msg = `${op}: ${text}`;
  if (res.status === 401) return new IntegrationError({ kind: "auth", connector: "paymob", status: 401, message: msg });
  if (res.status === 403) return new IntegrationError({ kind: "permission", connector: "paymob", status: 403, message: msg });
  // An integration id of the other mode (test/live) or another account: the store's set-up, not a retry.
  if (res.status === 404 && /integration/i.test(text)) return new IntegrationError({ kind: "validation", connector: "paymob", status: 404, message: `${op}: an integration id is not this account's or not in this mode (${text})` });
  if (res.status === 404) return new IntegrationError({ kind: "not_found", connector: "paymob", status: 404, message: msg });
  if (res.status === 400 || res.status === 422) return new IntegrationError({ kind: "validation", connector: "paymob", status: res.status, message: msg });
  return null;
}

/** `{ detail }`, `{ message }`, or `{ field: ["…"] }` → one line (values only from the error body, never the request). */
function errorText(body: Record<string, unknown> | undefined): string {
  if (!body || typeof body !== "object") return "";
  for (const k of ["detail", "message", "error"]) if (typeof body[k] === "string") return body[k] as string;
  return Object.entries(body).flatMap(([k, v]) => (Array.isArray(v) ? [`${k}: ${v.map(String).join(" ")}`] : typeof v === "string" ? [`${k}: ${v}`] : [])).join("; ").slice(0, 300);
}
