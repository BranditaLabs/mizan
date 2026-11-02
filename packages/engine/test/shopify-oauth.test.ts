import { describe, expect, it } from "vitest";
import { DriftMonitor } from "../src/adapt/drift.js";
import { ShapeWatch } from "../src/adapt/shape.js";
import { ShopifyGraphql } from "../src/connectors/shopify/client.js";
import { exchangeShopifyCode, migrateShopifyToken, missingScopes, normalizeShop, refreshShopifyToken, shopifyAuthorizeUrl, signShopifyQuery, verifyShopifyQuery } from "../src/connectors/shopify/oauth.js";
import { ORDER_BY_ID } from "../src/connectors/shopify/queries.js";
import { isIntegrationError } from "../src/core/errors.js";
import { FakeClock, seeded, testRuntime } from "./fakes/clock.js";
import { FakeShopify } from "./fakes/shopify.js";

const clock = new FakeClock();
const shop = new FakeShopify(clock, seeded(1));
const rt = testRuntime(clock, { [shop.host]: shop.handler });
const creds = (code: string) => ({ shop: shop.host, clientId: shop.clientId, clientSecret: shop.secret, code });

describe("Shopify OAuth", () => {
  it("accepts only myshopify.com shop domains (no SSRF through `shop`)", () => {
    expect(normalizeShop(" Nile-Store.myshopify.com/ ")).toBe("nile-store.myshopify.com");
    expect(normalizeShop("https://nile.myshopify.com")).toBe("nile.myshopify.com");
    for (const bad of ["evil.com", "nile.myshopify.com.evil.com", "nile.myshopify.com@evil.com", "-x.myshopify.com", "a/b.myshopify.com", "", 42, undefined]) {
      expect(normalizeShop(bad)).toBeNull();
    }
  });

  it("verifies the callback signature and its age", () => {
    const q = shop.authorize("state-1", ["read_orders"]);
    expect(verifyShopifyQuery(q, shop.secret, clock.now())).toBe(true);
    expect(verifyShopifyQuery({ ...q, shop: "other.myshopify.com" }, shop.secret, clock.now())).toBe(false);
    expect(verifyShopifyQuery({ ...q, state: "forged" }, shop.secret, clock.now())).toBe(false);
    expect(verifyShopifyQuery(q, "wrong-secret", clock.now())).toBe(false);
    expect(verifyShopifyQuery({ ...q, hmac: "zz" }, shop.secret, clock.now())).toBe(false);
    expect(verifyShopifyQuery(q, shop.secret, clock.now() + 2 * 3600_000)).toBe(false); // stale link
    const { hmac: _, ...unsigned } = q;
    expect(verifyShopifyQuery(unsigned, shop.secret, clock.now())).toBe(false);
    expect(signShopifyQuery(unsigned, shop.secret)).toBe(q.hmac);
  });

  it("builds the authorize URL for an offline token", () => {
    const url = new URL(shopifyAuthorizeUrl({ shop: shop.host, clientId: "cid", scopes: ["read_orders", "write_products"], redirectUri: "https://api.mizan.app/cb", state: "s" }));
    expect(url.origin).toBe(`https://${shop.host}`);
    expect(url.pathname).toBe("/admin/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: "cid", scope: "read_orders,write_products", redirect_uri: "https://api.mizan.app/cb", state: "s" });
    expect(url.searchParams.has("grant_options[]")).toBe(false);
  });

  it("exchanges a code once; write scopes imply read", async () => {
    const q = shop.authorize("s", ["read_orders", "read_products", "write_products"]);
    const grant = await exchangeShopifyCode(rt, creds(q.code!));
    expect(grant.accessToken).toBe(shop.tokens.at(-1));
    expect(grant.scopes).toEqual(["read_orders", "write_products"]);
    expect(missingScopes(["read_orders", "read_products", "write_products"], grant.scopes)).toEqual([]);
    expect(missingScopes(["read_orders", "read_customers"], grant.scopes)).toEqual(["read_customers"]);

    const again = await exchangeShopifyCode(rt, creds(q.code!)).catch((e) => e);
    expect(isIntegrationError(again) && again.kind).toBe("validation");
  });

  it("classifies a bad client secret, and does not retry a code after a timeout or 5xx", async () => {
    const q = shop.authorize("s", ["read_orders"]);
    const bad = await exchangeShopifyCode(rt, { ...creds(q.code!), clientSecret: "nope" }).catch((e) => e);
    expect(isIntegrationError(bad) && bad.kind).toBe("validation");

    shop.faults.push({ op: "oauthAccessToken", fault: "500" });
    const down = await exchangeShopifyCode(rt, creds(q.code!)).catch((e) => e);
    expect(isIntegrationError(down) && down.kind).toBe("transient");

    shop.faults.push({ op: "oauthAccessToken", fault: "timeout" });
    const pending = exchangeShopifyCode(rt, creds(q.code!)).catch((e) => e);
    await clock.advance(10_001);
    const slow = await pending;
    expect(isIntegrationError(slow) && slow.kind).toBe("timeout");
    expect(shop.tokens).toHaveLength(1); // only the first test's exchange issued a token
  });

  it("asks for an expiring offline token: the Admin API refuses a non-expiring one", async () => {
    const q = shop.authorize("s", ["read_orders"]);
    const grant = await exchangeShopifyCode(rt, creds(q.code!));
    expect(grant.refreshToken).toMatch(/^shprt_/);
    expect(grant.expiresAt).toBe(clock.now() + 3600_000);
    expect(grant.refreshExpiresAt).toBe(clock.now() + 7_776_000_000);
    expect(shop.nonExpiring.has(grant.accessToken)).toBe(false);

    // What a token without expiring=1 gets today (seen on staging, Nov 2026): 403 on every call. It is the
    // token, not a missing scope, so it is `auth` (reconnect), not `permission` (approve scopes).
    const gql = new ShopifyGraphql({ shop: shop.host, accessToken: "shpat_old", apiVersion: "2026-10", clientSecret: shop.secret }, rt, new DriftMonitor(), new ShapeWatch());
    shop.nonExpiring.add("shpat_old");
    const refused = await gql.run(ORDER_BY_ID, { id: "gid://shopify/Order/1" }, { idempotent: true }).catch((e) => e);
    expect(isIntegrationError(refused) && refused.kind).toBe("auth");
  });

  it("migrates a stored non-expiring token to an expiring pair; the old one stops working", async () => {
    // A token issued the old way (no expiring=1), as stores connected before Nov 2026 hold.
    const old = `shpat_legacy`;
    shop.nonExpiring.add(old);
    const app = { shop: shop.host, clientId: shop.clientId, clientSecret: shop.secret };
    const grant = await migrateShopifyToken(rt, { ...app, accessToken: old });
    expect(grant.refreshToken).toMatch(/^shprt_/);
    expect(grant.expiresAt).toBe(clock.now() + 3600_000);
    expect(shop.revoked.has(old)).toBe(true);
    // Once only: the old token is gone, and an expiring token cannot be migrated.
    for (const accessToken of [old, grant.accessToken]) {
      const again = await migrateShopifyToken(rt, { ...app, accessToken }).catch((e) => e);
      expect(isIntegrationError(again) && again.kind).toBe("validation");
    }
  });

  it("refreshes with rotation; a spent refresh token is `auth` (reconnect)", async () => {
    const q = shop.authorize("s", ["read_orders"]);
    const first = await exchangeShopifyCode(rt, creds(q.code!));
    const refresh = (refreshToken: string) => refreshShopifyToken(rt, { shop: shop.host, clientId: shop.clientId, clientSecret: shop.secret, refreshToken });

    const second = await refresh(first.refreshToken!);
    expect(second.accessToken).not.toBe(first.accessToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    // The presented token still works until its successor is used (a retry after a timeout is safe)…
    const retry = await refresh(first.refreshToken!);
    expect(retry.refreshToken).toMatch(/^shprt_/);
    // …and using the successor retires it.
    await refresh(second.refreshToken!);
    const spent = await refresh(first.refreshToken!).catch((e) => e);
    expect(isIntegrationError(spent) && spent.kind).toBe("auth");

    // A new install retires every refresh token the store had.
    const again = await exchangeShopifyCode(rt, creds(shop.authorize("s", ["read_orders"]).code!));
    expect(again.refreshToken).toBeDefined();
    const retired = await refresh(second.refreshToken!).catch((e) => e);
    expect(isIntegrationError(retired) && retired.kind).toBe("auth");
  });

  it("the client refreshes once when Shopify says the access token expired", async () => {
    const q = shop.authorize("s", ["read_orders"]);
    let grant = await exchangeShopifyCode(rt, creds(q.code!));
    const asked: boolean[] = [];
    const token = async (force?: boolean) => {
      asked.push(Boolean(force));
      if (force) grant = await refreshShopifyToken(rt, { shop: shop.host, clientId: shop.clientId, clientSecret: shop.secret, refreshToken: grant.refreshToken! });
      return grant.accessToken;
    };
    const order = shop.addOrder();
    const gql = new ShopifyGraphql({ shop: shop.host, accessToken: "", token, apiVersion: "2026-10", clientSecret: shop.secret }, rt, new DriftMonitor(), new ShapeWatch());

    await clock.advance(3600_000); // the hour is up
    const data = await gql.run<{ order: { id: string } }>(ORDER_BY_ID, { id: order.id }, { idempotent: true });
    expect(data.order.id).toBe(order.id);
    expect(asked).toEqual([false, true]);

    // A refresh that cannot help (the app was uninstalled) is not retried again.
    shop.uninstall();
    asked.length = 0;
    const gone = await gql.run(ORDER_BY_ID, { id: order.id }, { idempotent: true }).catch((e) => e);
    expect(isIntegrationError(gone) && gone.kind).toBe("auth");
    expect(asked).toEqual([false, true]);
  });
});
