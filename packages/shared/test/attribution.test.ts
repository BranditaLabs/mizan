import { describe, expect, it } from "vitest";
import { resolveOrderSource, sourceAttributes, platformFromName, OrderSourceHintsSchema } from "../src/index.js";

describe("resolveOrderSource (M7-2)", () => {
  it("an ad click id wins over everything, and keeps the value for conversion events later", () => {
    const s = resolveOrderSource({
      lastVisit: { landingUrl: "https://nile.shop/products/abaya?fbclid=IwAR1abc&utm_source=newsletter&utm_campaign=ramadan", referrerUrl: "https://l.instagram.com/" },
    });
    expect(s).toMatchObject({ platform: "meta", paid: true, rule: "click_id", clickId: { kind: "fbclid", value: "IwAR1abc" }, landingPath: "/products/abaya", utm: { campaign: "ramadan" } });
    expect(resolveOrderSource({ lastVisit: { landingUrl: "/?gclid=Cj0" } })).toMatchObject({ platform: "google", paid: true, clickId: { kind: "gclid" } });
    expect(resolveOrderSource({ lastVisit: { landingUrl: "/?ttclid=E.C.P" } }).platform).toBe("tiktok");
    expect(resolveOrderSource({ lastVisit: { landingUrl: "/?ScCid=abc" } }).platform).toBe("snapchat");
  });

  it("UTM tags name the platform, the medium says paid or organic", () => {
    expect(resolveOrderSource({ lastVisit: { landingUrl: "/?utm_source=facebook&utm_medium=paid_social&utm_campaign=eid-sale&utm_content=video-2" } }))
      .toMatchObject({ platform: "meta", paid: true, rule: "utm", utm: { source: "facebook", medium: "paid_social", campaign: "eid-sale", content: "video-2" } });
    expect(resolveOrderSource({ lastVisit: { utm: { source: "ig", medium: "bio" } } })).toMatchObject({ platform: "meta", paid: false });
    expect(resolveOrderSource({ lastVisit: { utm: { source: "TikTok", medium: "cpc" } } })).toMatchObject({ platform: "tiktok", paid: true });
    expect(resolveOrderSource({ lastVisit: { utm: { source: "klaviyo", medium: "email" } } })).toMatchObject({ platform: "email", paid: false });
    expect(resolveOrderSource({ lastVisit: { utm: { source: "fashionblog.eg" } } })).toMatchObject({ platform: "referral", paid: null });
    expect(resolveOrderSource({ attributes: { utm_source: "snapchat", utm_medium: "cpm" } })).toMatchObject({ platform: "snapchat", paid: true, rule: "utm" });
  });

  it("then the referring site, never the store's own pages", () => {
    expect(resolveOrderSource({ lastVisit: { referrerUrl: "https://www.google.com.eg/search?q=abaya" } })).toMatchObject({ platform: "google", paid: null, rule: "referrer", referrerDomain: "google.com.eg" });
    expect(resolveOrderSource({ lastVisit: { referrerUrl: "https://m.facebook.com/" } }).platform).toBe("meta");
    expect(resolveOrderSource({ lastVisit: { referrerUrl: "https://wa.me/201001234567" } }).platform).toBe("whatsapp");
    expect(resolveOrderSource({ lastVisit: { referrerUrl: "https://fashionblog.eg/top-10" } })).toMatchObject({ platform: "referral", paid: false, referrerDomain: "fashionblog.eg" });
    const own = resolveOrderSource({ lastVisit: { landingUrl: "https://nile.shop/cart", referrerUrl: "https://nile.shop/products/x" } }, { storeDomain: "nile.shop" });
    expect(own).toMatchObject({ platform: "direct", rule: "store" });
    expect(own.referrerDomain).toBeUndefined();
  });

  it("then the store's own classification, then the sales channel", () => {
    expect(resolveOrderSource({ lastVisit: { source: "Instagram", sourceType: "SOCIAL" } })).toMatchObject({ platform: "meta", rule: "store" });
    expect(resolveOrderSource({ lastVisit: { sourceType: "typein" } })).toMatchObject({ platform: "direct", paid: false });
    expect(resolveOrderSource({ lastVisit: { sourceType: "SEO" } })).toMatchObject({ platform: "search", paid: false });
    expect(resolveOrderSource({ channel: "pos" })).toMatchObject({ platform: "pos", rule: "channel" });
    expect(resolveOrderSource({ channel: "shopify_draft_order", lastVisit: { utm: { source: "facebook" } } })).toMatchObject({ platform: "manual", rule: "channel" });
    expect(resolveOrderSource({ channel: "web" })).toMatchObject({ platform: "unknown", rule: "none", paid: null });
    expect(resolveOrderSource(undefined)).toMatchObject({ platform: "unknown", rule: "none", discountCodes: [] });
  });

  it("last touch decides; a different first touch is kept beside it", () => {
    const s = resolveOrderSource({
      firstVisit: { landingUrl: "/?utm_source=tiktok&utm_medium=cpc", occurredAt: "2026-10-01T10:00:00Z" },
      lastVisit: { referrerUrl: "https://www.google.com/" },
    });
    expect(s).toMatchObject({ platform: "google", firstPlatform: "tiktok", firstSeenAt: "2026-10-01T10:00:00Z" });
    expect(resolveOrderSource({ firstVisit: { utm: { source: "facebook", medium: "cpc" } } })).toMatchObject({ platform: "meta", paid: true });
    expect(resolveOrderSource({ firstVisit: { utm: { source: "facebook" } }, lastVisit: { utm: { source: "fb" } } }).firstPlatform).toBeUndefined();
  });

  it("keeps no query string, no referrer path, and only source-like attributes", () => {
    const s = resolveOrderSource({ lastVisit: { landingUrl: "https://nile.shop/checkout?email=mona@example.com&phone=0100&utm_source=fb", referrerUrl: "https://fashionblog.eg/post?u=mona" } });
    expect(JSON.stringify(s)).not.toMatch(/mona|0100|email=/);
    expect(s.landingPath).toBe("/checkout");
    expect(sourceAttributes([{ key: "UTM_Source", value: "tiktok" }, { key: "gift_note", value: "for Mona" }, { key: "fbclid", value: 12 }, { key: "phone", value: "0100" }]))
      .toEqual({ utm_source: "tiktok", fbclid: "12" });
    expect(sourceAttributes([{ key: "gift", value: "x" }])).toBeUndefined();
  });

  it("tidies discount codes and survives junk", () => {
    expect(resolveOrderSource({ discountCodes: [" EID20 ", "EID20", "", "SARA10"] }).discountCodes).toEqual(["EID20", "SARA10"]);
    expect(resolveOrderSource({ lastVisit: { landingUrl: "::not a url::", referrerUrl: "%%%" } }).rule).toBe("store");
    expect(resolveOrderSource({ lastVisit: { landingUrl: `/?utm_campaign=${"x".repeat(400)}` } }).utm.campaign).toHaveLength(200);
    expect(platformFromName("l.facebook.com")).toBe("meta");
    expect(platformFromName("somewhere")).toBeUndefined();
  });

  it("hints are a schema at the trust boundary", () => {
    expect(OrderSourceHintsSchema.safeParse({ lastVisit: { utm: { source: "fb" } }, discountCodes: ["A"], attributes: { utm_source: "fb" } }).success).toBe(true);
    expect(OrderSourceHintsSchema.safeParse({ attributes: { utm_source: 3 } }).success).toBe(false);
  });
});
