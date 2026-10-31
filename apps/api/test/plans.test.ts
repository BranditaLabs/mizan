import { describe, expect, it } from "vitest";
import { limitAlerts, monthOf, monthStart, NEXT_PLAN, PLAN_LIMITS, previousMonth } from "../src/modules/billing/plans.js";

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

  it("is near a limit from 80% (all of it used included) and over past it; no limit, no alert (E12-1)", () => {
    const free = PLAN_LIMITS.free;
    expect(limitAlerts({ orders: 239, stores: 0, users: 1 }, free)).toEqual([]);
    expect(limitAlerts({ orders: 240, stores: 1, users: 2 }, free)).toEqual([
      { metric: "orders", level: "near", used: 240, limit: 300 }, { metric: "stores", level: "near", used: 1, limit: 1 }, { metric: "users", level: "near", used: 2, limit: 2 },
    ]);
    expect(limitAlerts({ orders: 301, stores: 2, users: 3 }, free).map((a) => `${a.metric}:${a.level}`)).toEqual(["orders:over", "stores:over", "users:over"]);
    expect(limitAlerts({ orders: 1_000_000, stores: 50, users: 500 }, PLAN_LIMITS.enterprise)).toEqual([]);
    expect(limitAlerts({ orders: 1, stores: 40, users: 1 }, PLAN_LIMITS.scale)).toEqual([]); // unlimited stores
    expect(NEXT_PLAN).toEqual({ free: "growth", growth: "scale", scale: "enterprise", enterprise: null });
  });
});
