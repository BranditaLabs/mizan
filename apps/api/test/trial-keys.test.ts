import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalEmail, trialKeys } from "../src/modules/billing/trial-keys.js";
import { SecretValue } from "../src/platform/secrets/secret-value.js";

/** One trial per mailbox (E12-2a2): aliases that land in one inbox share one key. */
const pepper = new SecretValue(createHash("sha256").update("trial-keys-test").digest("base64"));
const emailKey = (email: string) => trialKeys(pepper, { email })[0];

describe("trial keys", () => {
  it("binds the mailbox, not the exact address: +tags everywhere, dots and googlemail.com for Gmail", () => {
    const owner = emailKey("owner@gmail.com");
    for (const alias of ["owner+x@gmail.com", "o.wner@gmail.com", "O.W.N.E.R+shop2@GoogleMail.com", "  Owner@Gmail.com "]) {
      expect(emailKey(alias), alias).toBe(owner);
    }
    expect(canonicalEmail("Sara+ksa@Acme.com")).toBe("sara@acme.com");
    expect(canonicalEmail("s.ara@acme.com")).toBe("s.ara@acme.com"); // dots matter outside Gmail
    expect(emailKey("other@gmail.com")).not.toBe(owner);
  });

  it("keeps an address whose local part is only a tag as it is", () => {
    expect(canonicalEmail("+shop@acme.com")).toBe("+shop@acme.com");
  });

  it("is a peppered HMAC per kind, never the address", () => {
    const keys = trialKeys(pepper, { userId: "u-1", email: "owner@gmail.com", phone: "+20 100 111 2233", shopDomain: "https://Nile.myshopify.com/" });
    expect(keys.map((k) => k.split(":")[0])).toEqual(["user", "user", "phone", "shop_domain"]);
    for (const k of keys) expect(k).toMatch(/^[a-z_]+:[0-9a-f]{64}$/);
    expect(keys.join()).not.toContain("owner");
    expect(trialKeys(pepper, { shopDomain: "nile.myshopify.com" })).toEqual([keys[3]]);
  });
});
