import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The OAuth `state` parameter: signed, short-lived, and tied to the shop it was issued for.
 * An install started inside Mizan also carries the tenant and user, so only they can claim it.
 *
 *   base64url(JSON payload) "." base64url(HMAC-SHA256(key, payload))
 *
 * The key is derived from the Shopify client secret (HKDF), so no extra secret is needed.
 */
export interface StatePayload {
  v: 1;
  shop: string;
  tenant?: string;
  user?: string;
  /** Random nonce: two installs never share a state. */
  n: string;
  /** Expiry, seconds since epoch. */
  exp: number;
}

export const STATE_TTL_S = 10 * 60;

const keyFor = (clientSecret: string) => Buffer.from(hkdfSync("sha256", clientSecret, Buffer.alloc(0), "mizan:shopify-oauth-state", 32));

export function signState(clientSecret: string, p: Omit<StatePayload, "v" | "n" | "exp">, nowMs: number): string {
  const payload: StatePayload = { v: 1, ...p, n: randomBytes(12).toString("base64url"), exp: Math.floor(nowMs / 1000) + STATE_TTL_S };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", keyFor(clientSecret)).update(body).digest("base64url")}`;
}

/** The payload, or null when the state is forged, malformed or expired. */
export function verifyState(clientSecret: string, state: unknown, nowMs: number): StatePayload | null {
  if (typeof state !== "string" || state.length > 1024) return null;
  const [body, mac, extra] = state.split(".");
  if (!body || !mac || extra !== undefined) return null;
  const expected = createHmac("sha256", keyFor(clientSecret)).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let p: StatePayload;
  try {
    p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
  } catch {
    return null;
  }
  if (p.v !== 1 || typeof p.shop !== "string" || typeof p.exp !== "number" || p.exp < nowMs / 1000) return null;
  if ((p.tenant === undefined) !== (p.user === undefined)) return null;
  return p;
}
