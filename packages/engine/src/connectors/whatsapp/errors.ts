import { IntegrationError, kindFromStatus, parseRetryAfter, type ErrorKind } from "../../core/errors.js";
import type { HttpResponse } from "../../resilience/http.js";

/**
 * Meta Graph API error codes (body `error.code`) → the engine's error kinds. Meta answers most
 * failures with HTTP 400 and says what happened in the code, so the status alone misleads
 * (a throughput limit is a 400). Unknown codes fall back to the HTTP status.
 *
 * Several delivery failures (131047 outside the 24-hour window, 131026 undeliverable) usually
 * arrive later in a `failed` status webhook rather than on the send; `kindOfCode` serves both.
 */
const CODES: Record<number, ErrorKind> = {
  // Rate limits: app (4), WABA (80007), number throughput (130429), same recipient too often (131056).
  4: "rate_limited", 80007: "rate_limited", 130429: "rate_limited", 131056: "rate_limited",
  // Token expired, invalidated or the app lost the permission.
  190: "auth", 10: "permission", 200: "permission", 3: "permission",
  // Our request: invalid parameter, template missing or its parameters do not match, unsupported message.
  100: "validation", 131008: "validation", 131009: "validation", 131051: "validation",
  132000: "validation", 132001: "validation", 132005: "validation", 132007: "validation", 132012: "validation", 132015: "validation", 132016: "validation",
  // The customer: outside the free 24-hour window (needs a template), cannot receive, or did not accept terms.
  131047: "validation", 131026: "validation", 131021: "validation", 131030: "validation",
  // Meta side, retry later.
  1: "transient", 2: "transient", 131000: "transient", 131016: "transient", 133004: "transient",
  // The business account or number: blocked, locked, not registered, payment missing. A person must act.
  368: "permission", 131031: "permission", 131042: "permission", 133010: "permission",
};

/** Codes that mean "this customer cannot get this message", not "our request is wrong". */
export const RECIPIENT_CODES: ReadonlySet<number> = new Set([131026, 131021, 131030]);
/** The 24-hour customer service window has closed: only a template can reach the customer now. */
export const WINDOW_CLOSED = 131047;

export function kindOfCode(code: number | undefined, status = 400): ErrorKind {
  return (code !== undefined ? CODES[code] : undefined) ?? kindFromStatus(status);
}

interface GraphError { message?: string; type?: string; code?: number; error_subcode?: number; error_data?: { details?: string }; fbtrace_id?: string }

/** `send()` hook for error responses: body code first, then status. No message text, which may echo the customer's number. */
export function classifyGraphError(op: string, res: HttpResponse, now: number): IntegrationError | null {
  const err = (res.json as { error?: GraphError } | undefined)?.error;
  if (!err || typeof err !== "object") return null;
  const code = typeof err.code === "number" ? err.code : undefined;
  return new IntegrationError({
    kind: kindOfCode(code, res.status), connector: "whatsapp", status: res.status,
    message: `${op}: Meta error ${code ?? "?"}${err.error_subcode ? `/${err.error_subcode}` : ""} (${err.type ?? "unknown"})`,
    retryAfterMs: parseRetryAfter(res.headers.get("retry-after"), now) ?? (code === 131056 ? 6_000 : undefined),
    details: { code, subcode: err.error_subcode, fbtrace: err.fbtrace_id },
  });
}
