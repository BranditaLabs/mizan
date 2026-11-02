import { describe, expect, it } from "vitest";
import { landedFor, type PoLineWeight } from "../src/modules/purchasing/landed.js";

const lines: PoLineWeight[] = [
  { id: "abaya", quantity: 10, unitCostMinor: 10000n }, // value 1000.00
  { id: "scarf", quantity: 5, unitCostMinor: 4000n },   // value 200.00
];

describe("landed cost allocation (M16-4a)", () => {
  it("spreads by value: 600.00 freight on 1,200.00 of goods is 50% of each line's value", () => {
    const freight = [{ amountMinor: 60000n, currency: "EGP", allocateBy: "value" as const }];
    // abaya: 600 × 1000/1200 = 500.00 for 10 units → 50.00 each; scarf: 100.00 for 5 → 20.00 each
    expect(landedFor(freight, lines, "abaya", 1).get("EGP")).toBe(5000n);
    expect(landedFor(freight, lines, "abaya", 10).get("EGP")).toBe(50000n);
    expect(landedFor(freight, lines, "scarf", 5).get("EGP")).toBe(10000n);
  });

  it("spreads by quantity, keeps currencies apart, and adds up to the whole cost when everything arrives", () => {
    const costs = [
      { amountMinor: 30000n, currency: "EGP", allocateBy: "quantity" as const },
      { amountMinor: 1000n, currency: "USD", allocateBy: "value" as const },
    ];
    const a = landedFor(costs, lines, "abaya", 10);
    const s = landedFor(costs, lines, "scarf", 5);
    expect(a.get("EGP")! + s.get("EGP")!).toBe(30000n);
    expect(a.get("USD")! + s.get("USD")!).toBe(1000n);
    expect(a.get("EGP")).toBe(20000n); // 10 of 15 units
  });

  it("carries nothing for units past the ordered quantity, unknown lines or no units", () => {
    const freight = [{ amountMinor: 60000n, currency: "EGP", allocateBy: "value" as const }];
    expect(landedFor(freight, lines, "abaya", 12).get("EGP")).toBe(50000n);
    expect(landedFor(freight, lines, "bag", 3).size).toBe(0);
    expect(landedFor(freight, lines, "abaya", 0).size).toBe(0);
    expect(landedFor([], lines, "abaya", 3).size).toBe(0);
  });

  it("rounds per receipt half up, so partial receipts stay within a unit of the whole", () => {
    const odd = [{ amountMinor: 1000n, currency: "EGP", allocateBy: "quantity" as const }];
    const three: PoLineWeight[] = [{ id: "x", quantity: 3, unitCostMinor: 1n }];
    const parts = [1, 1, 1].map((u) => landedFor(odd, three, "x", u).get("EGP")!);
    expect(parts).toEqual([333n, 333n, 333n]);
    expect(1000n - parts.reduce((a, b) => a + b, 0n)).toBeLessThanOrEqual(3n);
  });
});
