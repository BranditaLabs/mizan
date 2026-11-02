import { createHmac, timingSafeEqual } from "node:crypto";
import type { DriftSink } from "../../adapt/drift.js";
import { Resolver } from "../../adapt/resolve.js";
import type { Runtime } from "../../core/runtime.js";
import { send } from "../../resilience/http.js";

/**
 * Shopify OAuth (authorization code grant, offline access token).
 * shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant
 *
 * Only the provider mechanics live here; who may install into which store is the platform's job.
 */

/** `<name>.myshopify.com`: the only host we ever send a code or token to (no SSRF via `shop`). */
const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/** Normalized shop domain, or null when `shop` is not a myshopify.com domain. */
export function normalizeShop(shop: unknown): string | null {
  if (typeof shop !== "string") return null;
  const s = shop.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return SHOP.test(s) && s.length <= 255 ? s : null;
}

/**
 * Verify the `hmac` Shopify adds to OAuth callbacks and app launches: hex HMAC-SHA256,
 * with the app's client secret, of the other query parameters sorted and joined as `k=v&k=v`.
 * `maxAgeS` rejects stale links by their `timestamp`.
 */
export function verifyShopifyQuery(query: Record<string, unknown>, clientSecret: string, nowMs: number, maxAgeS = 3600): boolean {
  const hmac = query.hmac;
  if (typeof hmac !== "string" || !/^[0-9a-f]{64}$/i.test(hmac) || !clientSecret) return false;
  const message = Object.keys(query)
    .filter((k) => k !== "hmac" && k !== "signature")
    .sort()
    .map((k) => `${k}=${Array.isArray(query[k]) ? JSON.stringify(query[k]) : String(query[k])}`)
    .join("&");
  const expected = createHmac("sha256", clientSecret).update(message).digest();
  const given = Buffer.from(hmac, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  const ts = Number(query.timestamp);
  return Number.isFinite(ts) && Math.abs(nowMs / 1000 - ts) <= maxAgeS;
}

/** Sign a query like Shopify does (tests and fakes). */
export function signShopifyQuery(query: Record<string, string>, clientSecret: string): string {
  const message = Object.keys(query).filter((k) => k !== "hmac").sort().map((k) => `${k}=${query[k]}`).join("&");
  return createHmac("sha256", clientSecret).update(message).digest("hex");
}

export interface AuthorizeParams {
  shop: string;
  clientId: string;
  scopes: string[];
  redirectUri: string;
  state: string;
}

/** Where to send the merchant's browser. No `grant_options[]=per-user`: we want an offline (store) token. */
export function shopifyAuthorizeUrl(p: AuthorizeParams): string {
  const url = new URL(`https://${p.shop}/admin/oauth/authorize`);
  url.searchParams.set("client_id", p.clientId);
  url.searchParams.set("scope", p.scopes.join(","));
  url.searchParams.set("redirect_uri", p.redirectUri);
  url.searchParams.set("state", p.state);
  return url.toString();
}

/**
 * An expiring offline token (Shopify refuses non-expiring ones on the Admin API): the access token
 * lives about an hour, the refresh token about 90 days, and every refresh returns a new pair.
 * shopify.dev/docs/apps/build/authentication-authorization/access-tokens
 */
export interface ShopifyGrant {
  accessToken: string;
  scopes: string[];
  /** Missing only if Shopify answered with a non-expiring token. */
  refreshToken?: string;
  /** Epoch ms. */
  expiresAt?: number;
  refreshExpiresAt?: number;
}

const noDrift: DriftSink = { record() {} };

function readGrant(rt: Runtime, json: unknown, drift: DriftSink): ShopifyGrant {
  const r = new Resolver(json, { connector: "shopify", entity: "oauth_grant", drift, now: () => rt.clock.now() });
  const accessToken = r.str("accessToken", ["access_token", "accessToken"], { required: true })!;
  const scope = r.str("scope", ["scope", "scopes"]) ?? "";
  const refreshToken = r.str("refreshToken", ["refresh_token", "refreshToken"]);
  const expiresIn = Number(r.str("expiresIn", ["expires_in", "expiresIn"]));
  const refreshExpiresIn = Number(r.str("refreshExpiresIn", ["refresh_token_expires_in", "refreshTokenExpiresIn"]));
  const now = rt.clock.now();
  return {
    accessToken, scopes: scope.split(",").map((s) => s.trim()).filter(Boolean),
    ...(refreshToken ? { refreshToken } : {}),
    ...(expiresIn > 0 ? { expiresAt: now + expiresIn * 1000 } : {}),
    ...(refreshExpiresIn > 0 ? { refreshExpiresAt: now + refreshExpiresIn * 1000 } : {}),
  };
}

/**
 * Exchange the one-time code for the store's expiring offline access token.
 * Not idempotent (a code works once), so a timeout is not retried: the merchant installs again.
 */
export async function exchangeShopifyCode(
  rt: Runtime,
  p: { shop: string; clientId: string; clientSecret: string; code: string },
  drift: DriftSink = noDrift,
): Promise<ShopifyGrant> {
  const res = await send(rt, {
    connector: "shopify", op: "shopify.oauthAccessToken", method: "POST", idempotent: false, maxAttempts: 1, timeoutMs: 10_000,
    url: `https://${p.shop}/admin/oauth/access_token`,
    body: { client_id: p.clientId, client_secret: p.clientSecret, code: p.code, expiring: "1" },
  });
  return readGrant(rt, res.json, drift);
}

/**
 * A new access token (and refresh token) from the stored refresh token, with no merchant present.
 * Safe to repeat: the refresh token presented stays valid until its successor is used, so a retry
 * after a timeout just gets another pair. A 401 (`auth`) means the refresh token is spent or the app
 * was uninstalled: the merchant reconnects.
 */
export async function refreshShopifyToken(
  rt: Runtime,
  p: { shop: string; clientId: string; clientSecret: string; refreshToken: string },
  drift: DriftSink = noDrift,
): Promise<ShopifyGrant> {
  const res = await send(rt, {
    connector: "shopify", op: "shopify.oauthRefresh", method: "POST", idempotent: true, maxAttempts: 3, timeoutMs: 10_000,
    url: `https://${p.shop}/admin/oauth/access_token`,
    body: { client_id: p.clientId, client_secret: p.clientSecret, grant_type: "refresh_token", refresh_token: p.refreshToken },
  });
  return readGrant(rt, res.json, drift);
}

/**
 * Swap a stored non-expiring token for an expiring pair, with no merchant present (stores connected
 * before expiring tokens). Shopify invalidates the old token for the Admin API once this succeeds, so
 * the caller must store the answer before using it. A 400 (`validation`) means Shopify would not
 * take the token (already expiring, revoked): keep it and let the store reconnect.
 */
export async function migrateShopifyToken(
  rt: Runtime,
  p: { shop: string; clientId: string; clientSecret: string; accessToken: string },
  drift: DriftSink = noDrift,
): Promise<ShopifyGrant> {
  const res = await send(rt, {
    connector: "shopify", op: "shopify.oauthMigrate", method: "POST", idempotent: false, maxAttempts: 1, timeoutMs: 10_000,
    url: `https://${p.shop}/admin/oauth/access_token`,
    body: {
      client_id: p.clientId, client_secret: p.clientSecret, grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: p.accessToken, subject_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
      requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token", expiring: "1",
    },
  });
  return readGrant(rt, res.json, drift);
}

/**
 * Scopes that are missing from a grant. Shopify implies `read_x` by `write_x`,
 * so a grant of `write_products` satisfies `read_products`.
 */
export function missingScopes(required: string[], granted: string[]): string[] {
  const have = new Set(granted);
  for (const s of granted) if (s.startsWith("write_")) have.add(`read_${s.slice(6)}`);
  return required.filter((s) => !have.has(s));
}
