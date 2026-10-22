import { describe, expect, it } from "vitest";
import {
  addMoney, compareMoney, currencyDecimals, fromMinor, isCurrencyCode, isDecimalAmount,
  isZeroMoney, subtractMoney, sumMoney, toMinor, percentOf, convertMoney, ratio,
} from "../src/money.js";

const egp = (amount: string) => ({ amount, currency: "EGP" });

describe("currencyDecimals", () => {
  it.each([
    ["EGP", 2], ["SAR", 2], ["AED", 2], ["QAR", 2], ["MAD", 2], ["USD", 2],
    ["KWD", 3], ["BHD", 3], ["OMR", 3], ["JOD", 3], ["IQD", 3], ["TND", 3], ["LYD", 3],
    ["JPY", 0], ["CLF", 4],
  ])("%s → %i", (code, d) => expect(currencyDecimals(code)).toBe(d));

  it("accepts lower case and whitespace", () => expect(currencyDecimals(" kwd ")).toBe(3));

  it.each(["", "EG", "EGPP", "12$"])("rejects %j", (code) => {
    expect(() => currencyDecimals(code)).toThrow(/ISO 4217/);
  });

  it("isCurrencyCode is strict upper case", () => {
    expect(isCurrencyCode("EGP")).toBe(true);
    expect(isCurrencyCode("egp")).toBe(false);
  });
});

describe("toMinor", () => {
  it.each([
    ["1150.00", "EGP", 115000n],
    ["1150.5", "EGP", 115050n],
    ["1150", "EGP", 115000n],
    ["0", "EGP", 0n],
    ["0.00", "SAR", 0n],
    ["-25.10", "EGP", -2510n],
    ["+7.5", "AED", 750n],
    ["1,150.00", "SAR", 115000n],
    ["  99.99 ", "EGP", 9999n],
    ["12.345", "KWD", 12345n],
    ["0.005", "BHD", 5n],
    ["1.2", "OMR", 1200n],
    ["500", "JPY", 500n],
    ["10.500", "EGP", 1050n],
    ["1.0000", "CLF", 10000n],
    ["9007199254740993.01", "EGP", 900719925474099301n],
  ])("%s %s → %s", (amount, currency, minor) => {
    expect(toMinor(amount, currency)).toBe(minor);
    expect(toMinor({ amount, currency })).toBe(minor);
  });

  it("refuses to round away real precision", () => {
    expect(() => toMinor("10.505", "EGP")).toThrow(/more than 2 decimals for EGP/);
    expect(() => toMinor("1.5", "JPY")).toThrow(/more than 0 decimals/);
    expect(() => toMinor("1.0001", "KWD")).toThrow(/more than 3 decimals/);
  });

  it.each(["", "abc", "12abc", "1.2.3", ".5", "5.", "1e3", "--1", "١٢"])("rejects %j", (amount) => {
    expect(() => toMinor(amount, "EGP")).toThrow(/not a decimal amount/);
  });

  it("rejects a missing or invalid currency", () => {
    expect(() => toMinor("1.00", "")).toThrow(/ISO 4217/);
    expect(() => toMinor("1.00", undefined as unknown as string)).toThrow(/ISO 4217/);
  });
});

describe("fromMinor", () => {
  it.each([
    [115000n, "EGP", "1150.00"],
    [5n, "EGP", "0.05"],
    [0n, "EGP", "0.00"],
    [-2510n, "EGP", "-25.10"],
    [-5n, "EGP", "-0.05"],
    [5n, "BHD", "0.005"],
    [12345n, "KWD", "12.345"],
    [500n, "JPY", "500"],
    [1n, "CLF", "0.0001"],
    [900719925474099301n, "EGP", "9007199254740993.01"],
  ])("%s %s → %s", (minor, currency, amount) => {
    expect(fromMinor(minor, currency)).toEqual({ amount, currency });
  });

  it("accepts safe integers and normalizes the code", () => {
    expect(fromMinor(180000, "egp")).toEqual({ amount: "1800.00", currency: "EGP" });
  });

  it("rejects floats and unsafe numbers", () => {
    expect(() => fromMinor(1.5, "EGP")).toThrow(/safe integer/);
    expect(() => fromMinor(2 ** 53, "EGP")).toThrow(/safe integer/);
  });

  it("round-trips through toMinor for 0, 2 and 3 decimal currencies", () => {
    for (const currency of ["JPY", "EGP", "KWD"]) {
      for (const minor of [0n, 1n, -1n, 99n, 100n, 101n, 123456789n, -987654321n]) {
        expect(toMinor(fromMinor(minor, currency))).toBe(minor);
      }
    }
  });
});

describe("arithmetic", () => {
  it("adds and subtracts exactly where floats would drift", () => {
    expect(addMoney(egp("0.10"), egp("0.20"))).toEqual(egp("0.30"));
    expect(subtractMoney(egp("1150.00"), egp("150.50"))).toEqual(egp("999.50"));
    expect(subtractMoney(egp("10"), egp("25.25"))).toEqual(egp("-15.25"));
  });

  it("sums a list, empty list is zero", () => {
    expect(sumMoney([egp("0.10"), egp("0.20"), egp("0.30")], "EGP")).toEqual(egp("0.60"));
    expect(sumMoney([], "KWD")).toEqual({ amount: "0.000", currency: "KWD" });
  });

  it("compares", () => {
    expect(compareMoney(egp("1.00"), egp("1"))).toBe(0);
    expect(compareMoney(egp("0.99"), egp("1"))).toBe(-1);
    expect(compareMoney(egp("1.01"), egp("1"))).toBe(1);
  });

  it("detects zero", () => {
    expect(isZeroMoney(egp("0.00"))).toBe(true);
    expect(isZeroMoney(egp("-0"))).toBe(true);
    expect(isZeroMoney(egp("0.01"))).toBe(false);
  });

  it("never mixes currencies", () => {
    const sar = { amount: "1.00", currency: "SAR" };
    expect(() => addMoney(egp("1.00"), sar)).toThrow(/currency mismatch: EGP vs SAR/);
    expect(() => subtractMoney(egp("1.00"), sar)).toThrow(/currency mismatch/);
    expect(() => compareMoney(egp("1.00"), sar)).toThrow(/currency mismatch/);
    expect(() => sumMoney([sar], "EGP")).toThrow(/currency mismatch/);
    expect(addMoney(egp("1.00"), { amount: "1.00", currency: "egp" })).toEqual(egp("2.00"));
  });

  it("isDecimalAmount", () => {
    expect(isDecimalAmount("1150.00")).toBe(true);
    expect(isDecimalAmount("-1")).toBe(true);
    expect(isDecimalAmount("1,150.00")).toBe(false);
    expect(isDecimalAmount("1150.")).toBe(false);
  });
});

describe("percentOf, convertMoney, ratio (E9-1: fees and exchange rates, exact)", () => {
  const egp = (amount: string) => ({ amount, currency: "EGP" });
  it("takes a percentage, rounding half to even", () => {
    expect(percentOf(egp("1250.00"), "1.5")).toEqual(egp("18.75"));
    expect(percentOf(egp("0.50"), "1")).toEqual(egp("0.00")); // 0.005 → 0.00 (tie to even)
    expect(percentOf(egp("1.50"), "1")).toEqual(egp("0.02")); // 0.015 → 0.02 (tie to even)
    expect(percentOf(egp("999.99"), "2.75")).toEqual(egp("27.50")); // 27.499725
    expect(percentOf({ amount: "12.345", currency: "KWD" }, "10")).toEqual({ amount: "1.234", currency: "KWD" }); // 1.2345 → 1.234
    expect(() => percentOf(egp("10.00"), "-1")).toThrow(RangeError);
  });

  it("converts between currencies with a rate of target units per source unit", () => {
    expect(convertMoney({ amount: "100.00", currency: "USD" }, "EGP", "48.75")).toEqual(egp("4875.00"));
    expect(convertMoney(egp("4875.00"), "USD", "0.02051282")).toEqual({ amount: "100.00", currency: "USD" });
    expect(convertMoney(egp("1000.00"), "KWD", "0.00631")).toEqual({ amount: "6.310", currency: "KWD" });
    expect(convertMoney({ amount: "1.000", currency: "KWD" }, "EGP", "158.123456")).toEqual(egp("158.12"));
    expect(() => convertMoney(egp("1.00"), "USD", "0")).toThrow(/positive/);
    expect(() => convertMoney(egp("1.00"), "USD", "abc")).toThrow(RangeError);
  });

  it("rounds negative amounts (refunds, reversals) the same way, away from or to even", () => {
    expect(percentOf(egp("-1250.00"), "1.5")).toEqual(egp("-18.75"));
    expect(percentOf(egp("-999.99"), "2.75")).toEqual(egp("-27.50")); // -27.499725
    expect(percentOf(egp("-1.50"), "1")).toEqual(egp("-0.02")); // -0.015 → tie to even
    expect(percentOf(egp("-2.50"), "1")).toEqual(egp("-0.02")); // -0.025 → tie to even
    expect(percentOf(egp("-0.50"), "1")).toEqual(egp("0.00"));
    expect(convertMoney({ amount: "-100.00", currency: "USD" }, "EGP", "48.755")).toEqual(egp("-4875.50"));
  });

  it("derives cross rates from one feed base", () => {
    // USD-based feed: 1 USD = 48.75 EGP, 3.75 SAR → 1 EGP = 0.0769… SAR
    expect(ratio("3.75", "48.75")).toBe("0.076923076923");
    expect(ratio("48.75", "1", 4)).toBe("48.7500");
    expect(() => ratio("1", "0")).toThrow(/zero/);
    expect(ratio("1", "-4", 2)).toBe("-0.25"); // negative divisor
    expect(ratio("-7", "2", 0)).toBe("-4"); // -3.5 → tie to even
    expect(ratio("7", "2", 0)).toBe("4");
    expect(() => ratio("x", "1")).toThrow(/not a decimal/);
  });
});
