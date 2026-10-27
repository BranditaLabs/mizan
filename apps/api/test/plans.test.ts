import { describe, expect, it } from "vitest";
import { monthOf, monthStart, PLAN_LIMITS, previousMonth } from "../src/modules/billing/plans.js";

/** E12-3: months in the store's time zone, and the plans' limits (docs/01 §8). */
describe("billing months and plans", () => {
  it("reads and steps months", () => {
    expect(monthStart("2026-10")).toBe("2026-10-01");
    expect(monthStart("2026-13")).toBeNull();
    expect(monthStart("26-10")).toBeNull();
    expect(previousMonth("2026-10-01")).toBe("2026-09-01");
    expect(previousMonth("2026-01-01")).toBe("2025-12-01");
  });
  it("puts a moment in the store's month, not UTC's", () => {
    expect(monthOf(new Date("2026-09-30T20:59:59Z"), "Asia/Riyadh")).toBe("2026-09-01");
    expect(monthOf(new Date("2026-09-30T21:00:00Z"), "Asia/Riyadh")).toBe("2026-10-01");
    expect(monthOf(new Date("2026-12-31T23:30:00Z"), "Asia/Dubai")).toBe("2027-01-01");
    expect(monthOf(new Date("2026-12-31T23:30:00Z"), "UTC")).toBe("2026-12-01");
  });
  it("matches the proposal: orders a month, stores, users", () => {
    expect(PLAN_LIMITS.free).toEqual({ ordersPerMonth: 300, stores: 1, users: 2 });
    expect(PLAN_LIMITS.growth).toEqual({ ordersPerMonth: 3000, stores: 3, users: 8 });
    expect(PLAN_LIMITS.scale).toEqual({ ordersPerMonth: 10_000, stores: null, users: 25 });
    expect(PLAN_LIMITS.enterprise).toEqual({ ordersPerMonth: null, stores: null, users: null });
  });
});
