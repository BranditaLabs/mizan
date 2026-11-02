import { describe, expect, it } from "vitest";
import { readWooAuthToken, wooAuthToken } from "../src/modules/connections/woocommerce/woocommerce-auth.js";

/** E5-7 one click: the signed `user_id` WooCommerce posts back with the keys. */
describe("WooCommerce approval token", () => {
  const claim = { tenantId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", siteUrl: "https://shop.example.com", expiresAt: Date.now() + 60_000 };
  it("round-trips, and only with the same key", () => {
    const t = wooAuthToken(undefined, claim);
    expect(readWooAuthToken(undefined, t)).toEqual({ ...claim, expiresAt: Math.floor(claim.expiresAt / 1000) * 1000 });
    expect(readWooAuthToken(Buffer.alloc(32, 9).toString("base64"), t)).toBeNull();
  });
  it("refuses an altered site or store, an expired token and junk", () => {
    const t = wooAuthToken(undefined, claim);
    const [body, mac] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, "base64url").toString()), s: "https://evil.example" })).toString("base64url");
    expect(readWooAuthToken(undefined, `${forged}.${mac}`)).toBeNull();
    expect(readWooAuthToken(undefined, wooAuthToken(undefined, { ...claim, expiresAt: Date.now() - 1000 }))).toBeNull();
    for (const junk of [undefined, 42, "", "a.b", "x".repeat(2000)]) expect(readWooAuthToken(undefined, junk)).toBeNull();
  });
});
