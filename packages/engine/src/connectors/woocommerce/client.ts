import { IntegrationError } from "../../core/errors.js";
import type { Runtime } from "../../core/runtime.js";
import type { DriftSink } from "../../adapt/drift.js";
import type { ShapeWatch } from "../../adapt/shape.js";
import { CircuitBreaker } from "../../resilience/circuit.js";
import { send, type HttpResponse } from "../../resilience/http.js";
import { AdaptiveBucket } from "../../resilience/limiter.js";

export interface WooCommerceCredentials {
  /** The WordPress site, "https://store.example.com". HTTPS only: the keys travel as Basic auth. */
  siteUrl: string;
  consumerKey: string;
  consumerSecret: string;
  /** The secret Mizan sets on the webhooks it creates; it signs X-WC-Webhook-Signature. */
  webhookSecret: string;
  /** Where the store delivers this connection's webhooks (https; the platform's per-connection URL). */
  webhookUrl?: string;
  /** Learned: this host strips the Authorization header, so the keys go in the query string. */
  queryStringAuth?: boolean;
}

/** WordPress / WooCommerce REST error body: `{ code, message, data: { status } }`. */
interface WpError { code?: string; message?: string; data?: { status?: number } }

export interface WooPage<T> { items: T[]; totalPages: number }

const NOT_FOUND = /invalid_id|_invalid$|not_found/i;

/**
 * WooCommerce REST API v3 (`/wp-json/wc/v3`) client. Facts from the official docs and source:
 * - Auth over HTTPS is Basic with the consumer key and secret. Some hosts drop the
 *   Authorization header ("Consumer key is missing"); the keys then go in the query string.
 *   That switch is tried once on a 401 and remembered for the connection.
 * - Errors are `{ code, message, data.status }`; 401 keys refused, 403 missing permission (or a
 *   firewall page in HTML), 404 `rest_no_route` when WooCommerce or the REST API is off.
 * - No documented rate limit; shared hosting answers 429 or 503 under load, sometimes with
 *   Retry-After. The bucket starts gentle and adapts.
 * - WordPress plugins print PHP notices before the JSON on misconfigured sites: the JSON is
 *   recovered from the body (and recorded as drift) instead of failing every call.
 * - Pages are 1-based (`page`, `per_page` ≤ 100); `X-WP-TotalPages` gives the count.
 */
export class WooRest {
  readonly circuit: CircuitBreaker;
  readonly bucket: AdaptiveBucket;
  private noiseWarned = false;

  constructor(
    readonly creds: WooCommerceCredentials,
    private readonly rt: Runtime,
    private readonly drift: DriftSink,
    private readonly shapes: ShapeWatch,
  ) {
    if (!/^https:\/\//i.test(creds.siteUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(creds.siteUrl)) {
      throw new IntegrationError({ kind: "validation", connector: "woocommerce", message: "the store must be on HTTPS (the keys travel as Basic auth)" });
    }
    this.circuit = new CircuitBreaker(`woocommerce:${host(creds.siteUrl)}`, rt.clock, { failureThreshold: 5, openMs: 30_000 });
    this.bucket = new AdaptiveBucket(rt.clock, { capacity: 10, refillPerSec: 5 });
  }

  get queryStringAuth() {
    return Boolean(this.creds.queryStringAuth);
  }

  async get<T = unknown>(op: string, path: string, query: Record<string, string | number | boolean | undefined> = {}): Promise<{ json: T; totalPages: number }> {
    const res = await this.request(op, "GET", path, query, undefined, true);
    return { json: res.json as T, totalPages: Number(res.headers.get("x-wp-totalpages") ?? "1") || 1 };
  }

  /** A write. Not idempotent unless the caller says so: a timeout is verified by the caller, never re-sent here. */
  async write<T = unknown>(op: string, method: "POST" | "PUT" | "DELETE", path: string, body: unknown, idempotent = false): Promise<T> {
    return (await this.request(op, method, path, {}, body, idempotent)).json as T;
  }

  private async request(op: string, method: "GET" | "POST" | "PUT" | "DELETE", path: string, query: Record<string, string | number | boolean | undefined>, body: unknown, idempotent: boolean): Promise<HttpResponse> {
    try {
      return await this.once(op, method, path, query, body, idempotent);
    } catch (e) {
      // The host dropped the Authorization header: the same keys in the query string (HTTPS only).
      if (e instanceof IntegrationError && e.kind === "auth" && !this.creds.queryStringAuth && /^https:/i.test(this.creds.siteUrl)) {
        this.creds.queryStringAuth = true;
        try {
          const res = await this.once(op, method, path, query, body, idempotent);
          this.drift.record({ connector: "woocommerce", entity: "auth", kind: "fallback_field", detail: "Authorization header refused or dropped; keys sent in the query string", at: this.rt.clock.now() });
          return res;
        } catch (again) {
          this.creds.queryStringAuth = false;
          throw again;
        }
      }
      throw e;
    }
  }

  private async once(op: string, method: "GET" | "POST" | "PUT" | "DELETE", path: string, query: Record<string, string | number | boolean | undefined>, body: unknown, idempotent: boolean): Promise<HttpResponse> {
    const url = new URL(`${this.creds.siteUrl.replace(/\/+$/, "")}/wp-json/wc/v3${path}`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = {};
    if (this.creds.queryStringAuth) {
      url.searchParams.set("consumer_key", this.creds.consumerKey);
      url.searchParams.set("consumer_secret", this.creds.consumerSecret);
    } else {
      headers.Authorization = `Basic ${Buffer.from(`${this.creds.consumerKey}:${this.creds.consumerSecret}`).toString("base64")}`;
    }
    const res = await send(this.rt, {
      connector: "woocommerce", op: `woocommerce.${op}`, method, url: url.toString(), headers, body,
      idempotent, maxAttempts: 6, timeoutMs: 20_000,
      inspect: (r) => this.inspect(op, r),
      classify: (r) => classify(op, r),
    }, { circuit: this.circuit, bucket: this.bucket });
    if (res.json === undefined) res.json = salvageJson(res.text);
    const diff = res.json && method === "GET" ? this.shapes.observe(`woocommerce:${op}`, Array.isArray(res.json) ? res.json[0] ?? {} : res.json) : null;
    if (diff && (diff.removed.length || diff.retyped.length)) {
      this.drift.record({
        connector: "woocommerce", entity: op, kind: "shape_changed",
        detail: `removed: ${diff.removed.slice(0, 10).join(", ") || "—"}; retyped: ${diff.retyped.slice(0, 10).join(", ") || "—"}`, at: this.rt.clock.now(),
      });
    }
    return res;
  }

  /** A 2xx that is not JSON: PHP notices before the JSON are recovered; an HTML page (maintenance, login) is a failure. */
  private inspect(op: string, res: HttpResponse): IntegrationError | null {
    if (res.json !== undefined || res.status === 204) return null;
    if (salvageJson(res.text) !== undefined) {
      if (!this.noiseWarned) {
        this.noiseWarned = true;
        this.drift.record({ connector: "woocommerce", entity: op, kind: "shape_changed", detail: "the site prints text (PHP notices) before the JSON; recovered", sample: res.text.slice(0, 200), at: this.rt.clock.now() });
      }
      return null;
    }
    return new IntegrationError({ kind: "transient", connector: "woocommerce", status: res.status, message: `${op}: the site answered without JSON (maintenance page or a plugin in the way)` });
  }
}

/** Status ≥ 300: the body's code says more than the status. Null = the generic rules (429, 5xx, Retry-After). */
function classify(op: string, res: HttpResponse): IntegrationError | null {
  const body = (res.json ?? salvageJson(res.text)) as WpError | undefined;
  const code = body?.code ?? "";
  const msg = `${op}: ${body?.message ?? `HTTP ${res.status}`}${code ? ` (${code})` : ""}`;
  if (res.status === 401) return new IntegrationError({ kind: "auth", connector: "woocommerce", status: 401, message: msg, details: body });
  if (res.status === 403) {
    // A firewall or security plugin page is not a key problem, but it needs the merchant too.
    return new IntegrationError({ kind: "permission", connector: "woocommerce", status: 403, message: body ? msg : `${op}: blocked by the site's firewall or a security plugin`, details: body });
  }
  if (res.status === 404 && code === "rest_no_route") {
    return new IntegrationError({ kind: "permanent", connector: "woocommerce", status: 404, message: `${op}: the store's REST API is off (WooCommerce deactivated or permalinks set to plain)`, details: body });
  }
  if (res.status === 404 && (NOT_FOUND.test(code) || !body)) return new IntegrationError({ kind: "not_found", connector: "woocommerce", status: 404, message: msg, details: body });
  if (res.status === 400) return new IntegrationError({ kind: "validation", connector: "woocommerce", status: 400, message: msg, details: body });
  return null;
}

/** JSON after leading noise ("Deprecated: …" notices, a BOM): from the first `{` or `[` that parses to the end. */
export function salvageJson(text: string): unknown {
  if (!text) return undefined;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length && i < 20_000; i++) {
    const c = t[i];
    if (c !== "{" && c !== "[") continue;
    try { return JSON.parse(t.slice(i)); } catch { /* keep looking */ }
  }
  return undefined;
}

function host(url: string) {
  try { return new URL(url).host; } catch { return url; }
}
