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

export interface ShopifyGrant {
  accessToken: string;
  scopes: string[];
}

const noDrift: DriftSink = { record() {} };

/**
 * Exchange the one-time code for the store's offline access token.
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
    body: { client_id: p.clientId, client_secret: p.clientSecret, code: p.code },
  });
  const r = new Resolver(res.json, { connector: "shopify", entity: "oauth_grant", drift, now: () => rt.clock.now() });
  const accessToken = r.str("accessToken", ["access_token", "accessToken"], { required: true })!;
  const scope = r.str("scope", ["scope", "scopes"]) ?? "";
  return { accessToken, scopes: scope.split(",").map((s) => s.trim()).filter(Boolean) };
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
