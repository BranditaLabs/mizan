import { describe, expect, it } from "vitest";
import { destinationsFor, ledgerMethodFor, needsApproval } from "../src/modules/payments/refunds.rules.js";

/** E14-4: where money can go back and when a person approves, without the database. */
describe("refund rules", () => {
  it("offers the original method only for money that came in online, store credit only to a known customer", () => {
    expect(destinationsFor({ methods: ["card"], hasCustomer: true })).toEqual(["original_method", "store_credit", "bank_transfer", "cash"]);
    expect(destinationsFor({ methods: ["cod"], hasCustomer: true })).toEqual(["store_credit", "bank_transfer", "cash"]);
    expect(destinationsFor({ methods: ["instapay", "bank_transfer"], hasCustomer: false })).toEqual(["bank_transfer", "cash"]);
    expect(destinationsFor({ methods: ["cod", "wallet"], hasCustomer: false })).toEqual(["original_method", "bank_transfer", "cash"]);
  });
  it("asks for approval over the threshold, or in a currency the threshold is not in", () => {
    const s = { approveOverMinor: 100000n, baseCurrency: "EGP" };
    expect(needsApproval({ amountMinor: 100000n, currency: "EGP" }, s)).toBe(false);
    expect(needsApproval({ amountMinor: 100001n, currency: "EGP" }, s)).toBe(true);
    expect(needsApproval({ amountMinor: 1n, currency: "SAR" }, s)).toBe(true);
    expect(needsApproval({ amountMinor: 1n, currency: "EGP" }, { approveOverMinor: 0n, baseCurrency: "EGP" })).toBe(true);
  });
  it("books a refund under the method the money goes back by", () => {
    expect(ledgerMethodFor("original_method", ["cod", "wallet"])).toBe("wallet");
    expect(ledgerMethodFor("store_credit", ["card"])).toBe("store_credit");
    expect(ledgerMethodFor("bank_transfer", ["card"])).toBe("bank_transfer");
    expect(ledgerMethodFor("cash", ["cod"])).toBe("cash_pos");
  });
});
