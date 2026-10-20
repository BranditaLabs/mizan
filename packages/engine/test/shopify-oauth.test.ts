import { describe, expect, it } from "vitest";
import { exchangeShopifyCode, missingScopes, normalizeShop, shopifyAuthorizeUrl, signShopifyQuery, verifyShopifyQuery } from "../src/connectors/shopify/oauth.js";
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
});
