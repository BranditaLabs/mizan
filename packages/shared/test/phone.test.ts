import { describe, expect, it } from "vitest";
import { normalizePhone, toAsciiDigits } from "../src/phone.js";

describe("normalizePhone — Egypt", () => {
  it.each([
    "01001234821",
    "1001234821",
    "+201001234821",
    "+20 100 123 4821",
    "+20 0100 123 4821",
    "00201001234821",
    "201001234821",
    "(010) 0123-4821",
    "٠١٠٠١٢٣٤٨٢١",
    "۰۱۰۰۱۲۳۴۸۲۱",
    "‎+20 100 123 4821‏",
  ])("%j → +201001234821", (input) => {
    expect(normalizePhone(input, "EG")).toEqual({ e164: "+201001234821", country: "EG", national: "01001234821" });
  });

  it.each(["010", "011", "012", "015"])("accepts %s prefixes", (p) => {
    expect(normalizePhone(`${p}12345678`, "EG")?.e164).toBe(`+20${p.slice(1)}12345678`);
  });

  it.each(["01301234821", "0100123482", "010012348211", "0223456789"])("rejects %j (not an EG mobile)", (input) => {
    expect(normalizePhone(input, "EG")).toBeUndefined();
  });
});

describe("normalizePhone — Saudi Arabia", () => {
  it.each(["0501234567", "501234567", "+966501234567", "00966501234567", "966501234567", "+966 050 123 4567"])(
    "%j → +966501234567",
    (input) => {
      expect(normalizePhone(input, "SA")).toEqual({ e164: "+966501234567", country: "SA", national: "0501234567" });
    },
  );

  it("rejects landlines", () => expect(normalizePhone("0112345678", "SA")).toBeUndefined());
});

describe("normalizePhone — UAE", () => {
  it.each(["0501234567", "+971501234567", "00971 50 123 4567", "971501234567"])("%j → +971501234567", (input) => {
    expect(normalizePhone(input, "AE")).toEqual({ e164: "+971501234567", country: "AE", national: "0501234567" });
  });

  it.each(["052", "054", "055", "056", "058"])("accepts %s", (p) => {
    expect(normalizePhone(`${p}1234567`, "AE")?.country).toBe("AE");
  });

  it("rejects 051 and 053 (not UAE mobile ranges)", () => {
    expect(normalizePhone("+971511234567", "AE")).toBeUndefined();
    expect(normalizePhone("+971531234567", "AE")).toBeUndefined();
  });
});

describe("normalizePhone — cross-country and junk", () => {
  it("an explicit country code wins over the default country", () => {
    expect(normalizePhone("+966501234567", "EG")?.country).toBe("SA");
    expect(normalizePhone("+201001234821", "SA")?.country).toBe("EG");
  });

  it("reads a bare country code when the number is not local", () => {
    expect(normalizePhone("966501234567", "EG")?.e164).toBe("+966501234567");
    expect(normalizePhone("971501234567", "SA")?.e164).toBe("+971501234567");
  });

  it("a local number is read in the default country", () => {
    expect(normalizePhone("0501234567", "SA")?.country).toBe("SA");
    expect(normalizePhone("0501234567", "AE")?.country).toBe("AE");
  });

  it.each([undefined, null, "", "   ", "abc", "+1 415 555 0100", "+44 7700 900123", "12-34", "+20abc", "01001234821 ext 2"])(
    "returns undefined for %j",
    (input) => expect(normalizePhone(input, "EG")).toBeUndefined(),
  );
});

describe("toAsciiDigits", () => {
  it("converts both Arabic digit sets and leaves the rest", () => {
    expect(toAsciiDigits("٠١٢٣٤٥٦٧٨٩ ۰۱۲۳۴۵۶۷۸۹ abc 42")).toBe("0123456789 0123456789 abc 42");
  });
});
