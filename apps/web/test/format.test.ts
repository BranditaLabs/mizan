import { describe, expect, it } from "vitest";
import { formatDate, formatMoney, formatNumber, formatRelative, formatWhen } from "../src/lib/format";

const strip = (s: string) => s.replace(/[‎‏؜  ]/g, " ").replace(/\s+/g, " ").trim();

describe("formatMoney", () => {
  it("formats decimal strings exactly, with the currency's decimals", () => {
    expect(strip(formatMoney({ amount: "1150.00", currency: "EGP" }, "en"))).toBe("EGP 1,150.00");
    expect(strip(formatMoney({ amount: "12.345", currency: "KWD" }, "en"))).toBe("KWD 12.345");
    // Beyond float precision: no rounding through a JS number.
    expect(strip(formatMoney({ amount: "90071992547409.93", currency: "SAR" }, "en"))).toBe("SAR 90,071,992,547,409.93");
  });

  it("Arabic: Western digits by default, Eastern Arabic as a store setting", () => {
    const latn = strip(formatMoney({ amount: "1150.00", currency: "EGP" }, "ar"));
    expect(latn).toContain("1,150.00");
    expect(latn).toContain("ج.م");
    expect(strip(formatMoney({ amount: "1150.00", currency: "EGP" }, "ar", "arab"))).toContain("١٬١٥٠٫٠٠");
  });

  it("rejects amounts that are not decimal strings", () => {
    expect(() => formatMoney({ amount: "1e3", currency: "EGP" }, "en")).toThrow();
  });
});

describe("numbers and dates", () => {
  it("numbers follow the digit setting", () => {
    expect(formatNumber(1042, "ar")).toBe("1,042");
    expect(formatNumber(1042, "ar", "arab")).toBe("١٬٠٤٢");
  });

  it("dates in Cairo time, both languages", () => {
    expect(formatDate("2026-10-20T22:30:00Z", "en")).toBe("Oct 21, 2026");
    expect(strip(formatDate("2026-10-20T22:30:00Z", "ar"))).toMatch(/21.*2026/);
  });

  it("relative times", () => {
    const now = Date.parse("2026-10-20T12:00:00Z");
    expect(formatRelative("2026-10-20T11:54:00Z", "en", now)).toBe("6 minutes ago");
    expect(formatWhen("2026-10-24T08:00:00Z", "en")).toBe("Sat 11:00 AM"); // Cairo time
    expect(formatRelative("2026-10-20T11:54:00Z", "ar", now)).toContain("6");
  });
});
