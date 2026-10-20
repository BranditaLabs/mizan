import { describe, expect, it } from "vitest";
import { shopDomain } from "../src/components/onboarding/shop-domain";
import { formatDuration } from "../src/lib/format";

describe("shopDomain: what merchants paste into 'store address'", () => {
  it("accepts the handle, the domain, or an admin URL", () => {
    expect(shopDomain("nile-abayas")).toBe("nile-abayas.myshopify.com");
    expect(shopDomain(" Nile-Abayas.myshopify.com ")).toBe("nile-abayas.myshopify.com");
    expect(shopDomain("https://nile-abayas.myshopify.com/admin/orders")).toBe("nile-abayas.myshopify.com");
  });
  it("refuses other domains and junk", () => {
    for (const bad of ["", "nile abayas", "nileabayas.com", "https://evil.example/x.myshopify.com", "-x.myshopify.com", "نايل"]) expect(shopDomain(bad), bad).toBeNull();
  });
});

describe("formatDuration (time-to-first-value)", () => {
  it("reads naturally in both languages", () => {
    expect(formatDuration(40, "en")).toBe("1 minute");
    expect(formatDuration(14 * 60, "en")).toBe("14 minutes");
    expect(formatDuration(3.5 * 3600, "en")).toBe("3.5 hours");
    expect(formatDuration(2 * 86_400, "en")).toBe("2 days");
    expect(formatDuration(14 * 60, "ar")).toMatch(/14 دقيقة/);
  });
});
