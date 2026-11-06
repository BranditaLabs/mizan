import { describe, expect, it } from "vitest";
import { BUYER_CANCEL_REASONS, buyerLang, CURRENCY_AR, MAX_BUYER_REASONS } from "../src/confirmation.js";

describe("confirmation facts (E6-16a)", () => {
  it("five canonical cancel codes; nine store reasons leave room for the keep row", () => {
    expect(BUYER_CANCEL_REASONS).toEqual(["changed_mind", "ordered_by_mistake", "found_cheaper", "delivery_too_late", "other"]);
    expect(MAX_BUYER_REASONS + 1).toBe(10);
  });

  it("Arabic currency names, never the new riyal sign", () => {
    expect(CURRENCY_AR.EGP).toBe("ج.م.");
    expect(CURRENCY_AR.SAR).toBe("ر.س");
    expect(Object.values(CURRENCY_AR).join("")).not.toContain("⃁");
  });

  it.each([
    ["ar-EG", "ar"], ["ar", "ar"], ["AR_sa", "ar"], ["en", "en"], ["en-US", "en"], [" EN ", "en"],
    ["fr", null], ["de-AT", null], ["", null], [null, null], [undefined, null],
  ])("buyerLang(%j) → %j", (raw, lang) => expect(buyerLang(raw)).toBe(lang));
});
