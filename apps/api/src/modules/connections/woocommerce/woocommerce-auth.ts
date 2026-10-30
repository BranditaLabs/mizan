import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

/**
 * The `user_id` Mizan hands WooCommerce's one-click approval (`/wc-auth/v1/authorize`, E5-7).
 * WooCommerce posts the new keys to Mizan's callback with this value and nothing else to say who
 * asked, so it carries the store (tenant), the member who asked, the site and an expiry, signed:
 *
 *   base64url(JSON { t, u, s, e }) "." base64url(HMAC-SHA256(key, payload)[0..16])
 *
 * Nothing is stored; a forged, altered or expired value is refused. Replaying a genuine one only
 * saves the same site's keys again for the same store.
 */
const MAC_BYTES = 16;
/** Development and tests only (config refuses a missing key in production). */
const DEV_KEY = Buffer.alloc(32, 7).toString("base64");
/** Time to approve in WooCommerce (sign in, read, approve). */
export const WOO_AUTH_TTL_MS = 30 * 60_000;

export interface WooAuthClaim { tenantId: string; userId: string; siteUrl: string; expiresAt: number }

const keyOf = (secret: string | undefined) => Buffer.from(hkdfSync("sha256", Buffer.from(secret ?? DEV_KEY, "base64"), Buffer.alloc(0), "mizan:woo-auth", 32));

export function wooAuthToken(secret: string | undefined, c: WooAuthClaim): string {
  const body = Buffer.from(JSON.stringify({ t: c.tenantId, u: c.userId, s: c.siteUrl, e: Math.floor(c.expiresAt / 1000) })).toString("base64url");
  return `${body}.${createHmac("sha256", keyOf(secret)).update(body).digest().subarray(0, MAC_BYTES).toString("base64url")}`;
}

export function readWooAuthToken(secret: string | undefined, token: unknown, now = Date.now()): WooAuthClaim | null {
  if (typeof token !== "string" || token.length > 1000) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", keyOf(secret)).update(body).digest().subarray(0, MAC_BYTES);
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let p: { t?: unknown; u?: unknown; s?: unknown; e?: unknown };
  try { p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
  if (typeof p.t !== "string" || typeof p.u !== "string" || typeof p.s !== "string" || typeof p.e !== "number") return null;
  if (p.e * 1000 < now) return null;
  return { tenantId: p.t, userId: p.u, siteUrl: p.s, expiresAt: p.e * 1000 };
}
