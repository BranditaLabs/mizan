import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

/**
 * The customer's confirm link token (E6-7): the run id and a MAC, short enough for an SMS
 * (38 characters). Nothing secret is stored: the token is rebuilt from the run id whenever a
 * message is sent, and the run row decides whether the link still works (expiry, answered).
 *
 *   base64url( run uuid (16 bytes) ‖ HMAC-SHA256(key, uuid)[0..12] )
 */
const MAC_BYTES = 12;
/** Development and tests only (config refuses a missing key in production). */
const DEV_KEY = Buffer.alloc(32, 7).toString("base64");

const keyOf = (secret: string | undefined) => Buffer.from(hkdfSync("sha256", Buffer.from(secret ?? DEV_KEY, "base64"), Buffer.alloc(0), "mizan:confirm-link", 32));

export function linkToken(secret: string | undefined, runId: string): string {
  const id = Buffer.from(runId.replace(/-/g, ""), "hex");
  const mac = createHmac("sha256", keyOf(secret)).update(id).digest().subarray(0, MAC_BYTES);
  return Buffer.concat([id, mac]).toString("base64url");
}

/** The run id, or null for a forged or malformed token. */
export function runIdOf(secret: string | undefined, token: unknown): string | null {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{30,48}$/.test(token)) return null;
  const raw = Buffer.from(token, "base64url");
  if (raw.length !== 16 + MAC_BYTES) return null;
  const id = raw.subarray(0, 16);
  const expected = createHmac("sha256", keyOf(secret)).update(id).digest().subarray(0, MAC_BYTES);
  if (!timingSafeEqual(raw.subarray(16), expected)) return null;
  const hex = id.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
