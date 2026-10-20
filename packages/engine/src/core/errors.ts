/**
 * One error taxonomy for every connector.
 *
 * Adapters never throw raw HTTP or GraphQL errors. They classify each failure
 * into a kind, and the kind alone decides what the engine does next:
 * wait and retry, re-read and retry, stop and alert, or park in the
 * dead-letter queue for a person.
 */

export type ErrorKind =
  | "rate_limited" // slow down, then retry
  | "transient" // 5xx, connection reset: retry with backoff
  | "timeout" // outcome unknown: retry only if the operation is idempotent or verifiable
  | "circuit_open" // the provider is failing; fail fast until it recovers
  | "auth" // token expired or revoked: stop, ask the merchant to reconnect
  | "permission" // missing scope: stop, needs a re-install or approval
  | "not_found"
  | "validation" // our payload was rejected: needs a fix, not a retry
  | "conflict" // concurrent change: re-read, re-apply, retry
  | "schema_drift" // response no longer matches what the adapter understands
  | "permanent";

const RETRYABLE: ReadonlySet<ErrorKind> = new Set(["rate_limited", "transient", "timeout", "circuit_open", "conflict"]);

export class IntegrationError extends Error {
  readonly kind: ErrorKind;
  readonly connector: string;
  readonly retryAfterMs?: number;
  readonly status?: number;
  readonly details?: unknown;

  constructor(opts: {
    kind: ErrorKind;
    connector: string;
    message: string;
    retryAfterMs?: number;
    status?: number;
    details?: unknown;
    cause?: unknown;
  }) {
    super(opts.message, { cause: opts.cause });
    this.name = "IntegrationError";
    this.kind = opts.kind;
    this.connector = opts.connector;
    this.retryAfterMs = opts.retryAfterMs;
    this.status = opts.status;
    this.details = opts.details;
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.kind);
  }
}

export function isIntegrationError(e: unknown): e is IntegrationError {
  return e instanceof IntegrationError;
}

/** Map an HTTP status to an error kind. Body-level hints are applied by each adapter. */
export function kindFromStatus(status: number): ErrorKind {
  if (status === 429) return "rate_limited";
  if (status === 401) return "auth";
  if (status === 403) return "permission";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 408) return "timeout";
  if (status >= 500) return "transient";
  if (status >= 400) return "validation";
  return "permanent";
}

/** Parse Retry-After (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}
