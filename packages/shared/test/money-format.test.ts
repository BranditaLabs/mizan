import { describe, expect, it } from "vitest";
import { formatAmount, formatMoney } from "../src/money-format.js";
import { FEE_METHOD_SLUGS, PAYMENT_METHOD_SLUGS, PROVIDER_SLUGS, STORE_COURIER, isPaymentMethodSlug, isProviderSlug, realCustomerName } from "../src/catalog.js";

const NBSP = "\u00a0";
const RLM = "\u200f";
const LRM = "\u200e";

describe("formatMoney: the one contract (docs/16 §1.2)", () => {
  it("English: ISO code first, never US$ or $", () => {
    expect(formatMoney({ amount: "1150.00", currency: "EGP" }, "en")).toBe(`EGP${NBSP}1,150.00`);
    expect(formatMoney({ amount: "785.95", currency: "USD" }, "en")).toBe(`USD${NBSP}785.95`);
    expect(formatMoney({ amount: "785.95", currency: "usd" }, "en")).toBe(`USD${NBSP}785.95`);
  });

  it("Arabic: amount then the Arabic short name, Western digits, inside the RLM marks Intl ar-EG used", () => {
    expect(formatMoney({ amount: "1150.00", currency: "EGP" }, "ar")).toBe(`${RLM}1,150.00${NBSP}ج.م.${RLM}`);
    expect(formatMoney({ amount: "749.95", currency: "SAR" }, "ar")).toBe(`${RLM}749.95${NBSP}ر.س${RLM}`);
    expect(formatMoney({ amount: "785.95", currency: "USD" }, "ar")).toBe(`${RLM}785.95${NBSP}دولار${RLM}`);
    expect(formatMoney({ amount: "10", currency: "MAD" }, "ar")).toBe(`${RLM}10.00${NBSP}MAD${RLM}`);
  });

  it("Arabic negatives keep the minus with the number (an LRM before it, as Intl ar-EG did)", () => {
    expect(formatMoney({ amount: "-1150.00", currency: "EGP" }, "ar")).toBe(`${RLM}${LRM}-1,150.00${NBSP}ج.م.${RLM}`);
    expect(formatMoney({ amount: "-1150.00", currency: "EGP" }, "en")).toBe(`EGP${NBSP}-1,150.00`);
  });

  it("the same marks as the Intl ar-EG currency format the screens used before, so the amount reads first in RTL", () => {
    const intl = new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", numberingSystem: "latn" }).format(1150);
    const ours = formatMoney({ amount: "1150.00", currency: "EGP" }, "ar");
    expect(ours.startsWith(RLM)).toBe(intl.startsWith(RLM));
    expect(ours.endsWith(RLM)).toBe(intl.endsWith(RLM));
  });

  it("the same amount reads the same whatever the currency's symbol data", () => {
    for (const c of ["EGP", "SAR", "AED", "USD", "EUR"]) {
      expect(formatMoney({ amount: "1.00", currency: c }, "en")).toMatch(new RegExp(`^${c}${NBSP}1\.00$`));
      expect(formatMoney({ amount: "1.00", currency: c }, "ar")).not.toMatch(/[٠-٩]/);
    }
  });

  it("uses the currency's decimals exactly, beyond float precision", () => {
    expect(formatMoney({ amount: "12.345", currency: "KWD" }, "en")).toBe(`KWD${NBSP}12.345`);
    expect(formatMoney({ amount: "1500", currency: "JPY" }, "en")).toBe(`JPY${NBSP}1,500`);
    expect(formatMoney({ amount: "90071992547409.93", currency: "SAR" }, "en")).toBe(`SAR${NBSP}90,071,992,547,409.93`);
    expect(formatAmount({ amount: "-42.5", currency: "EGP" })).toBe("-42.50");
  });

  it("Eastern Arabic digits only when the store asks", () => {
    expect(formatMoney({ amount: "1150.00", currency: "EGP" }, "ar", "arab")).toBe(`${RLM}١٬١٥٠٫٠٠${NBSP}ج.م.${RLM}`);
  });

  it("refuses what is not a decimal string", () => {
    expect(() => formatMoney({ amount: "1e3", currency: "EGP" }, "en")).toThrow();
    expect(() => formatMoney({ amount: "1.00", currency: "EG" }, "en")).toThrow();
  });
});

describe("catalogue (X9)", () => {
  it("lists every method and provider once", () => {
    expect(new Set(PAYMENT_METHOD_SLUGS).size).toBe(PAYMENT_METHOD_SLUGS.length);
    expect(new Set(PROVIDER_SLUGS).size).toBe(PROVIDER_SLUGS.length);
    expect(isPaymentMethodSlug("cod")).toBe(true);
    expect(isProviderSlug("whatsapp_cloud")).toBe(true);
    expect(isProviderSlug("nope")).toBe(false);
  });

  it("fee rules: the hosted and transfer methods, never cash or store credit", () => {
    expect(FEE_METHOD_SLUGS).toEqual(["card", "wallet", "apple_pay", "bnpl", "bank_transfer", "instapay"]);
  });
});

describe("codes instead of English words stored as data (FX-1)", () => {
  it("the connectors' Customer placeholder is no name", () => {
    expect(realCustomerName("Customer")).toBeNull();
    expect(realCustomerName("  ")).toBeNull();
    expect(realCustomerName(undefined)).toBeNull();
    expect(realCustomerName(" منى عادل ")).toBe("منى عادل");
  });

  it("the store's own courier is a code", () => expect(STORE_COURIER).toBe("store_courier"));
});
