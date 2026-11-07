import { asciiDigits, mmss, normalizeCode, resendWait, shouldAutoSubmit } from "@mizan/design-system/auth-code";
import { describe, expect, it } from "vitest";

describe("one-time code input", () => {
  it("Arabic-Indic and Persian digits count", () => {
    expect(asciiDigits("١٢٣٤٥٦")).toBe("123456");
    expect(normalizeCode("۱۲۳۴۵۶")).toBe("123456");
    expect(normalizeCode("١٢٣ ٤٥٦")).toBe("123456");
  });
  it("a pasted message gives its run of 6 digits, not a phone number or a date in it", () => {
    expect(normalizeCode("Your code is 123456. Do not share it.")).toBe("123456");
    expect(normalizeCode("كود ميزان: ٦٥٤٣٢١")).toBe("654321");
    expect(normalizeCode("On 2026-11-07 your code 482913 from +201001234821")).toBe("482913");
  });
  it("typing keeps digits only, at most 6", () => {
    expect(normalizeCode("12a3")).toBe("123");
    expect(normalizeCode("12345678")).toBe("123456");
    expect(normalizeCode("")).toBe("");
  });
  it("auto-submits once per distinct value: never while busy, never a refused code again", () => {
    expect(shouldAutoSubmit("123456", { busy: false, rejected: null })).toBe(true);
    expect(shouldAutoSubmit("12345", { busy: false, rejected: null })).toBe(false);
    expect(shouldAutoSubmit("123456", { busy: true, rejected: null })).toBe(false);
    expect(shouldAutoSubmit("123456", { busy: false, rejected: "123456" })).toBe(false);
    expect(shouldAutoSubmit("123457", { busy: false, rejected: "123456" })).toBe(true);
  });
  it("resend waits grow: 60s, 120s, then 300s; countdown as m:ss", () => {
    expect([1, 2, 3, 4, 9].map(resendWait)).toEqual([60, 120, 300, 300, 300]);
    expect(resendWait(0)).toBe(60);
    expect([59, 60, 120, 300, 0, -3, 1.2].map(mmss)).toEqual(["0:59", "1:00", "2:00", "5:00", "0:00", "0:00", "0:02"]);
  });
});
