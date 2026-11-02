import { describe, expect, it } from "vitest";
import { marketingRewrite, normalizeHost } from "@/lib/marketing";
import { formatPrice, monthlyPrice, PLANS } from "@/components/landing/pricing";

const base = { marketingHost: "mizan.brandita.net", host: "mizan.brandita.net" };

describe("marketing host rewrite (proxy.ts)", () => {
  it("does nothing without MARKETING_HOST or on another host", () => {
    expect(marketingRewrite({ ...base, marketingHost: undefined, pathname: "/" })).toBeNull();
    expect(marketingRewrite({ ...base, marketingHost: "", pathname: "/en" })).toBeNull();
    expect(marketingRewrite({ ...base, host: "app.mizan.brandita.net", pathname: "/" })).toBeNull();
  });

  it("shows the landing page at /ar and /en", () => {
    expect(marketingRewrite({ ...base, pathname: "/ar" })).toBe("/ar/landing");
    expect(marketingRewrite({ ...base, pathname: "/en/" })).toBe("/en/landing");
  });

  it("leaves every other path to the app", () => {
    for (const pathname of ["/en/sign-in", "/ar/legal/terms", "/en/landing", "/fr", "/arabic"]) {
      expect(marketingRewrite({ ...base, pathname }), pathname).toBeNull();
    }
  });

  it("picks the language at / from the saved choice, then the browser, then Arabic", () => {
    expect(marketingRewrite({ ...base, pathname: "/", cookieLocale: "en", acceptLanguage: "ar" })).toBe("/en/landing");
    expect(marketingRewrite({ ...base, pathname: "/", cookieLocale: "xx", acceptLanguage: "fr-FR, en-US;q=0.8, ar;q=0.5" })).toBe("/en/landing");
    expect(marketingRewrite({ ...base, pathname: "/", acceptLanguage: "en;q=0.3, ar-EG" })).toBe("/ar/landing");
    expect(marketingRewrite({ ...base, pathname: "/", acceptLanguage: "de" })).toBe("/ar/landing");
    expect(marketingRewrite({ ...base, pathname: "/" })).toBe("/ar/landing");
  });

  it("compares hosts without case, port or proxy lists", () => {
    expect(normalizeHost("Mizan.Brandita.NET:443")).toBe("mizan.brandita.net");
    expect(marketingRewrite({ ...base, host: "mizan.brandita.net, internal:8080", pathname: "/en" })).toBe("/en/landing");
  });
});

describe("landing prices (docs/01-business-model.md)", () => {
  it("are EGP 0 / 2,500 / 6,500 and USD 0 / 99 / 299 a month", () => {
    expect(PLANS.map((p) => p.egp)).toEqual([0, 2500, 6500, undefined]);
    expect(PLANS.map((p) => p.usd)).toEqual([0, 99, 299, undefined]);
  });
  it("give 2 months free on annual billing, shown per month", () => {
    expect(monthlyPrice(2500, true)).toBe(2083);
    expect(monthlyPrice(6500, true)).toBe(5417);
    expect(monthlyPrice(99, true)).toBe(83);
    expect(monthlyPrice(299, false)).toBe(299);
    expect(formatPrice(2083, false)).toBe("2,083");
    expect(formatPrice(83, true)).toBe("$83");
  });
});
