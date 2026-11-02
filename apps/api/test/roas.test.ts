import { describe, expect, it } from "vitest";
import { multiple, perUnit, roasSummary, type RoasFacts } from "../src/modules/attribution/roas.js";

/** M7-1: the formulas behind True ROAS, with an example a merchant can check by hand. */
const facts = (over: Partial<RoasFacts> = {}): RoasFacts => ({
  // 100 orders from EGP 20,000 of ads, worth 125,000 placed: 10 cancelled, 15 refused, 60 delivered, 15 still moving.
  spend: 2_000_000n, orders: 100n, placedValue: 12_500_000n, cancelled: 10n, returned: 15n, delivered: 60n, moving: 15n,
  real: 7_500_000n, pending: 1_875_000n, net: 900_000n, ...over,
});

describe("true ROAS (M7-1)", () => {
  it("counts money that arrived, not purchases the platform saw", () => {
    const r = roasSummary(facts());
    expect(r.reportedRoas).toBe("6.25"); // 125,000 placed ÷ 20,000: what Ads Manager would suggest
    expect(r.trueRoas).toBe("3.75"); // 75,000 real ÷ 20,000
    // The 15 still moving arrive at the finished ones' rate: 60 ÷ 75 = 80% of 18,750 → 15,000 more.
    expect(r.projectedRoas).toBe("4.50");
    expect(r.costPerOrder).toBe(20_000n); // EGP 200 an order …
    expect(r.costPerDelivered).toBe(33_333n); // … but EGP 333.33 a delivered one
    expect(r.deliveredRate).toBe("80.0");
    expect(r.lostShare).toBe("25.0"); // 10 cancelled + 15 refused of 100
  });

  it("says nothing it cannot know: no spend, nothing delivered, nothing finished", () => {
    expect(roasSummary(facts({ spend: 0n }))).toMatchObject({ trueRoas: null, reportedRoas: null, projectedRoas: null, costPerOrder: 0n, costPerDelivered: 0n });
    const fresh = roasSummary(facts({ delivered: 0n, returned: 0n, real: 0n, moving: 90n }));
    expect(fresh).toMatchObject({ trueRoas: "0.00", projectedRoas: null, costPerDelivered: null, deliveredRate: null });
  });

  it("rounds half up to two decimals, negatives too", () => {
    expect(multiple(1n, 3n)).toBe("0.33");
    expect(multiple(2n, 3n)).toBe("0.67");
    expect(multiple(1n, 8n)).toBe("0.13");
    expect(multiple(-5n, 2n)).toBe("-2.50");
    expect(multiple(5n, 0n)).toBeNull();
    expect(perUnit(10n, 4n)).toBe(3n);
    expect(perUnit(10n, 0n)).toBeNull();
  });
});
