import { describe, expect, it } from "vitest";
import { COUNTRY_CODES, COUNTRY_DEFAULTS, isCountryCode } from "../src/countries.js";
import { currencyDecimals } from "../src/money.js";

describe("country defaults", () => {
  it("Egypt: EGP, Africa/Cairo, ar-EG", () => {
    expect(COUNTRY_DEFAULTS.EG).toMatchObject({ currency: "EGP", timezone: "Africa/Cairo", locale: "ar-EG", phoneCountry: "EG" });
  });

  it("every country has a known currency, a real IANA timezone and AR/EN names", () => {
    for (const code of COUNTRY_CODES) {
      const c = COUNTRY_DEFAULTS[code];
      expect(() => currencyDecimals(c.currency)).not.toThrow();
      expect(() => new Intl.DateTimeFormat("en", { timeZone: c.timezone })).not.toThrow();
      expect(c.locale).toMatch(/^ar-[A-Z]{2}$/);
      expect(c.name.ar && c.name.en).toBeTruthy();
    }
  });

  it("guards codes", () => {
    expect(isCountryCode("SA")).toBe(true);
    expect(isCountryCode("US")).toBe(false);
    expect(isCountryCode("toString")).toBe(false);
  });
});
