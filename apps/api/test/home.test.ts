import { describe, expect, it } from "vitest";
import { daysOf, fixedCostsFor, percent } from "../src/modules/profit/home.js";

/** E9-4: monthly fixed costs over a period, and margins, to the minor unit. */
describe("profit home arithmetic", () => {
  it("a monthly cost over its whole month is exactly the amount; over part of it, its days' share", () => {
    const rent = [{ amountMinor: 3_000_000n, validFrom: "2026-01-01", validTo: null }];
    expect(fixedCostsFor(rent, "2026-10-01", "2026-10-31")).toBe(3_000_000n);
    expect(fixedCostsFor(rent, "2026-02-01", "2026-02-28")).toBe(3_000_000n);
    expect(fixedCostsFor(rent, "2026-10-01", "2026-10-10")).toBe(967_746n); // 967.74 a day, the 6-piastre remainder on the first 6 days
    expect(fixedCostsFor(rent, "2026-09-24", "2026-10-23")).toBe(fixedCostsFor(rent, "2026-09-24", "2026-09-30") + fixedCostsFor(rent, "2026-10-01", "2026-10-23"));
    // Any split of a year into periods adds up to twelve months.
    let sum = 0n;
    for (let d = "2026-01-01"; d <= "2026-12-31";) {
      const end = daysOf(d, "2026-12-31").slice(0, 17).at(-1)!;
      sum += fixedCostsFor(rent, d, end);
      d = daysOf(end, "2027-01-01")[1]!;
    }
    expect(sum).toBe(36_000_000n);
  });

  it("only the days a cost was in force count", () => {
    const salaries = [
      { amountMinor: 3_100_000n, validFrom: "2026-10-01", validTo: "2026-10-15" },
      { amountMinor: 6_200_000n, validFrom: "2026-10-16", validTo: null },
    ];
    expect(fixedCostsFor(salaries, "2026-10-01", "2026-10-31")).toBe(1_500_000n + 3_200_000n);
    expect(fixedCostsFor([], "2026-10-01", "2026-10-31")).toBe(0n);
  });

  it("margins with one decimal, rounded; none without revenue", () => {
    expect(percent(149n, 1000n)).toBe("14.9");
    expect(percent(1n, 3n)).toBe("33.3");
    expect(percent(2n, 3n)).toBe("66.7");
    expect(percent(-41n, 1000n)).toBe("-4.1");
    expect(percent(0n, 5n)).toBe("0.0");
    expect(percent(5n, 0n)).toBeNull();
  });
});
