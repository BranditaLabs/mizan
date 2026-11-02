import { normalizePhone } from "@mizan/shared";

/**
 * PII and secret redaction for logs (docs/07: phones, names, addresses,
 * tokens never reach Cloud Logging).
 *
 * Two layers:
 * 1. Key paths: fields whose *name* says they hold personal data or secrets
 *    are replaced wholesale (pino `redact`).
 * 2. Text scrubbing: free text (messages, error strings) is scanned for
 *    phones, emails and tokens, which are masked in place.
 */

export const REDACTED = "[redacted]";

/** Field names whose values are always personal data or secrets. Matched case-insensitively. */
const SENSITIVE_KEYS = new Set([
  "authorization", "cookie", "set-cookie", "x-api-key", "x-shopify-hmac-sha256", "x-hub-signature-256",
  "password", "secret", "token", "accesstoken", "refreshtoken", "idtoken", "apikey", "api_key", "clientsecret",
  "phone", "phone_e164", "mobile", "email", "name", "firstname", "lastname", "first_name", "last_name",
  "address", "address1", "address2", "line1", "line2", "street", "zip", "postcode", "lat", "lng", "location",
  "nationalid", "national_id",
]);

/** pino `redact.paths`: top-level and one level deep, plus request headers. */
export const PINO_REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-api-key"]',
  'req.headers["x-shopify-hmac-sha256"]',
  'req.headers["x-hub-signature-256"]',
  'res.headers["set-cookie"]',
  ...[...SENSITIVE_KEYS].filter((k) => /^[a-z_0-9]+$/.test(k)).flatMap((k) => [k, `*.${k}`]),
];

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu;
const BEARER = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/g;
const KEYS = /\b(?:shpat|shpss|shpca|shppa|mz_live|mz_test|sk_live|sk_test)_[A-Za-z0-9]+/g;
// Phone-shaped runs: optional +, digits (ASCII or Arabic-Indic) with spaces, dashes, dots, parentheses.
const PHONE_RUN = /\+?[\d٠-٩۰-۹][\d٠-٩۰-۹\s\-().]{6,}[\d٠-٩۰-۹]/g;

/** "+201001234821" → "010•••4821" style mask: keep the first 3 and last 4 digits of the national form. */
export function maskPhone(national: string): string {
  return national.length > 7 ? `${national.slice(0, 3)}•••${national.slice(-4)}` : "•••";
}

function scrubPhones(text: string): string {
  return text.replace(PHONE_RUN, (run) => {
    const phone = normalizePhone(run, "EG") ?? normalizePhone(run, "SA") ?? normalizePhone(run, "AE");
    return phone ? maskPhone(phone.national) : run;
  });
}

/** Mask phones, emails, bearer tokens and API keys inside free text. Order IDs and amounts are left alone. */
export function scrubText(text: string): string {
  return scrubPhones(text.replace(BEARER, "Bearer [redacted]").replace(KEYS, "[redacted-key]").replace(EMAIL, "[redacted-email]"));
}

/** Scrub a request URL: percent-decoded first so encoded phones and emails are caught too. */
export function scrubUrl(url: string): string {
  let decoded = url;
  try {
    decoded = decodeURIComponent(url.replace(/\+/g, " "));
  } catch {
    // malformed escapes: scrub the raw form
  }
  return scrubText(decoded);
}

const isSensitiveKey = (key: string) => SENSITIVE_KEYS.has(key.toLowerCase());

/**
 * Deep copy of a value with sensitive keys replaced and strings scrubbed.
 * Used for log bindings and error objects that pino's path redaction cannot see into.
 */
export function redactDeep(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return scrubText(value);
  if (value === null || typeof value !== "object") return value;
  if (depth > 8) return "[depth]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1, seen));
  if (value instanceof Error) {
    return { type: value.name, message: scrubText(value.message), stack: value.stack ? scrubText(value.stack) : undefined };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = isSensitiveKey(k) && v !== undefined && v !== null ? REDACTED : redactDeep(v, depth + 1, seen);
  }
  return out;
}
