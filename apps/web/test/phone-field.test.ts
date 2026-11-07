import { normalizePhone } from "@mizan/shared";
import { describe, expect, it } from "vitest";
import { countryFromLanguages, groupPhone, lastFour, PHONE_EXAMPLE, phoneFromPaste } from "../src/lib/auth/validate";

describe("phone field", () => {
  it("a pasted international number switches the country and keeps the rest", () => {
    expect(phoneFromPaste("+966 50 123 4567")).toEqual({ country: "SA", rest: "501234567" });
    expect(phoneFromPaste("00971501234567")).toEqual({ country: "AE", rest: "501234567" });
    expect(phoneFromPaste("+20 100 123 4821")).toEqual({ country: "EG", rest: "1001234821" });
    expect(phoneFromPaste("+٢٠١٠٠١٢٣٤٨٢١")).toEqual({ country: "EG", rest: "1001234821" });
  });
  it("leaves local numbers and unsupported countries alone", () => {
    expect(phoneFromPaste("01001234821")).toBeNull();
    expect(phoneFromPaste("+44 7700 900123")).toBeNull();
    expect(phoneFromPaste("hello")).toBeNull();
  });
  it("each country's example is a valid mobile number (the error shows it)", () => {
    for (const c of ["EG", "SA", "AE"] as const) expect(normalizePhone(PHONE_EXAMPLE[c], c)?.country).toBe(c);
  });
  it("regroups on blur, never invents digits", () => {
    expect(groupPhone("01001234821", "EG")).toBe("10 0123 4821");
    expect(groupPhone("0501234567", "SA")).toBe("50 123 4567");
    expect(groupPhone("0123", "EG")).toBe("0123");
  });
  it("default country from the browser's region, else Egypt", () => {
    expect(countryFromLanguages(["ar-SA", "en"])).toBe("SA");
    expect(countryFromLanguages(["en-AE"])).toBe("AE");
    expect(countryFromLanguages(["en-US", "fr"])).toBe("EG");
    expect(countryFromLanguages(undefined)).toBe("EG");
  });
  it("shows only the last four digits", () => expect(lastFour("+201001234821")).toBe("4821"));
});
