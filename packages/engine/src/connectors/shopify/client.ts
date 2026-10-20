import { IntegrationError } from "../../core/errors.js";
import type { Runtime } from "../../core/runtime.js";
import type { DriftSink } from "../../adapt/drift.js";
import type { ShapeWatch } from "../../adapt/shape.js";
import { CircuitBreaker } from "../../resilience/circuit.js";
import { send, type HttpResponse } from "../../resilience/http.js";
import { AdaptiveBucket } from "../../resilience/limiter.js";
import type { GqlOperation } from "./queries.js";

export interface ShopifyCredentials {
  /** "my-store.myshopify.com" */
  shop: string;
  accessToken: string;
  /** Pinned API version. Shopify ships one per quarter; keep this current. */
  apiVersion: string;
  /** App client secret, used to verify webhook HMACs. */
  clientSecret: string;
  /** Override for tests or a proxy. */
  baseUrl?: string;
}

interface GqlBody {
  data?: Record<string, unknown> | null;
  errors?: Array<{ message: string; extensions?: { code?: string; [k: string]: unknown } }>;
  extensions?: { cost?: { requestedQueryCost?: number; actualQueryCost?: number; throttleStatus?: { maximumAvailable: number; currentlyAvailable: number; restoreRate: number } } };
}

const SCHEMA_ERROR = /doesn't exist on type|undefinedField|Field '.*' doesn't exist|argumentNotAccepted|Unknown argument|isn't a defined input field|cannot query field/i;

/**
 * Shopify Admin GraphQL client.
 *
 * - Cost-aware throttling: every response carries the shop's real bucket
 *   (`extensions.cost.throttleStatus`); the limiter re-syncs to it, so the
 *   client slows down before Shopify has to throttle it. If it is throttled
 *   anyway, the wait is computed from the restore rate, not guessed.
 * - Version watch: Shopify silently serves a newer version when the pinned
 *   one retires. The `X-Shopify-API-Version` header is compared on every
 *   response and a mismatch is recorded as drift.
 * - Query variants: if a document is rejected because a field no longer
 *   exists, the next variant is tried automatically and the switch is
 *   remembered for this connection.
 * - userErrors are returned to the caller, which decides whether a message
 *   means "conflict, re-read and retry" or "bad input, stop".
 */
export class ShopifyGraphql {
  readonly circuit: CircuitBreaker;
  readonly bucket: AdaptiveBucket;
  private readonly variantInUse = new Map<string, number>();
  private versionWarned = false;

  constructor(
    private readonly creds: ShopifyCredentials,
    private readonly rt: Runtime,
    private readonly drift: DriftSink,
    private readonly shapes: ShapeWatch,
  ) {
    this.circuit = new CircuitBreaker(`shopify:${creds.shop}`, rt.clock, { failureThreshold: 5, openMs: 30_000 });
    // Standard plan restores 100 points/s; the first response re-syncs this to the shop's real numbers.
    this.bucket = new AdaptiveBucket(rt.clock, { capacity: 1_000, refillPerSec: 100 });
  }

  get endpoint() {
    const base = this.creds.baseUrl ?? `https://${this.creds.shop}`;
    return `${base}/admin/api/${this.creds.apiVersion}/graphql.json`;
  }

  async run<T = Record<string, unknown>>(op: GqlOperation, variables: Record<string, unknown>, opts: { idempotent: boolean; maxAttempts?: number }): Promise<T> {
    let i = this.variantInUse.get(op.name) ?? 0;
    for (;;) {
      const query = op.variants[i];
      try {
        const res = await send(this.rt, {
          connector: "shopify", op: `shopify.${op.name}`, method: "POST", url: this.endpoint,
          headers: { "X-Shopify-Access-Token": this.creds.accessToken },
          body: { query, variables, operationName: op.name },
          idempotent: opts.idempotent, maxAttempts: opts.maxAttempts ?? 6, cost: op.cost, timeoutMs: 20_000,
          inspect: (r) => this.inspect(op, r),
        }, { circuit: this.circuit, bucket: this.bucket });
        this.afterResponse(op, res);
        if (i !== (this.variantInUse.get(op.name) ?? 0)) this.variantInUse.set(op.name, i);
        return ((res.json as GqlBody).data ?? {}) as T;
      } catch (e) {
        if (e instanceof IntegrationError && e.kind === "schema_drift" && i + 1 < op.variants.length) {
          this.drift.record({
            connector: "shopify", entity: op.name, kind: "fallback_field",
            detail: `query variant ${i} rejected (${e.message}); switching to variant ${i + 1}`, at: this.rt.clock.now(),
          });
          i += 1;
          continue;
        }
        throw e;
      }
    }
  }

  private inspect(op: GqlOperation, res: HttpResponse): IntegrationError | null {
    const body = res.json as GqlBody | undefined;
    if (!body) return new IntegrationError({ kind: "transient", connector: "shopify", message: `${op.name}: empty or non-JSON response`, status: res.status });
    this.syncBucket(body);
    const errs = body.errors ?? [];
    if (!errs.length) return null;
    const codes = errs.map((e) => e.extensions?.code ?? "");
    const text = errs.map((e) => e.message).join("; ");
    if (codes.includes("THROTTLED") || /throttled/i.test(text)) {
      const ts = body.extensions?.cost?.throttleStatus;
      const need = body.extensions?.cost?.requestedQueryCost ?? op.cost;
      const waitMs = ts ? Math.ceil((Math.max(0, need - ts.currentlyAvailable) / Math.max(1, ts.restoreRate)) * 1000) : 1_000;
      return new IntegrationError({ kind: "rate_limited", connector: "shopify", message: `${op.name}: throttled`, retryAfterMs: waitMs, details: errs });
    }
    if (codes.includes("ACCESS_DENIED")) return new IntegrationError({ kind: "permission", connector: "shopify", message: `${op.name}: ${text}`, details: errs });
    if (codes.includes("INTERNAL_SERVER_ERROR")) return new IntegrationError({ kind: "transient", connector: "shopify", message: `${op.name}: ${text}`, details: errs });
    if (codes.includes("MAX_COST_EXCEEDED")) return new IntegrationError({ kind: "validation", connector: "shopify", message: `${op.name}: query too expensive — lower page size`, details: errs });
    if (SCHEMA_ERROR.test(text) || codes.some((c) => /undefined|argumentNotAccepted|missingRequiredArguments/i.test(c))) {
      return new IntegrationError({ kind: "schema_drift", connector: "shopify", message: `${op.name}: ${text}`, details: errs });
    }
    // Partial data with errors (e.g. a protected field redacted): keep the data, record drift, continue.
    if (body.data) {
      this.drift.record({ connector: "shopify", entity: op.name, kind: "missing_field", detail: `partial response: ${text}`, sample: errs, at: this.rt.clock.now() });
      return null;
    }
    return new IntegrationError({ kind: "validation", connector: "shopify", message: `${op.name}: ${text}`, details: errs });
  }

  private syncBucket(body: GqlBody) {
    const ts = body.extensions?.cost?.throttleStatus;
    if (ts) this.bucket.syncFromServer({ available: ts.currentlyAvailable, capacity: ts.maximumAvailable, refillPerSec: ts.restoreRate });
  }

  private afterResponse(op: GqlOperation, res: HttpResponse) {
    const served = res.headers.get("x-shopify-api-version");
    if (served && served !== this.creds.apiVersion && !this.versionWarned) {
      this.versionWarned = true;
      this.drift.record({
        connector: "shopify", entity: "api", kind: "version_fell_forward",
        detail: `requested ${this.creds.apiVersion}, served ${served} — update the pinned version and re-test`, at: this.rt.clock.now(),
      });
    }
    const data = (res.json as GqlBody).data;
    if (data) {
      const diff = this.shapes.observe(`shopify:${op.name}`, data);
      if (diff && (diff.removed.length || diff.retyped.length)) {
        this.drift.record({
          connector: "shopify", entity: op.name, kind: "shape_changed",
          detail: `removed: ${diff.removed.slice(0, 10).join(", ") || "—"}; retyped: ${diff.retyped.slice(0, 10).join(", ") || "—"}`,
          at: this.rt.clock.now(),
        });
      }
    }
  }
}

/** Throw on userErrors. Messages that signal a concurrent change become `conflict` (re-read and retry). */
export function assertNoUserErrors(op: string, errors: Array<{ field?: string[] | null; message: string; code?: string | null }> | undefined) {
  if (!errors?.length) return;
  const text = errors.map((e) => `${(e.field ?? []).join(".")}: ${e.message}`).join("; ");
  const conflict = errors.some((e) => /stale|compare|changeFrom|mismatch|has changed|concurrent|version/i.test(`${e.code ?? ""} ${e.message}`));
  throw new IntegrationError({ kind: conflict ? "conflict" : "validation", connector: "shopify", message: `${op}: ${text}`, details: errors });
}
