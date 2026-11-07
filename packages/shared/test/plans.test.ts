import { describe, expect, it } from "vitest";
import { FEATURE_PLAN, FEATURES, hasFeature, isPlan, NEXT_PLAN, PLAN_FEATURES, PLAN_LIMITS, PLAN_RANK, PLANS } from "../src/plans.js";

/** The plan contract the API, the dashboard and the landing share (E12-2a3, docs/01 §8): pinned. */
describe("plans", () => {
  it("pins limits per plan", () => {
    expect(PLAN_LIMITS).toEqual({
      free: { ordersPerMonth: 300, stores: 1, users: 2 },
      growth: { ordersPerMonth: 3000, stores: 3, users: 8 },
      scale: { ordersPerMonth: 10_000, stores: null, users: 25 },
      enterprise: { ordersPerMonth: null, stores: null, users: null },
    });
    expect(PLANS.map((p) => PLAN_RANK[p])).toEqual([0, 1, 2, 3]);
    expect(PLANS.map((p) => NEXT_PLAN[p])).toEqual(["growth", "scale", "enterprise", null]);
  });

  it("pins features: each plan has its own and every lower plan's; Free has none", () => {
    expect(PLAN_FEATURES.free).toEqual([]);
    expect(PLAN_FEATURES.growth).toEqual(["profit", "reports", "warehouse", "returns", "allCouriers", "allGateways", "automationRecipes"]);
    expect(PLAN_FEATURES.scale).toEqual([...PLAN_FEATURES.growth, "reconciliation", "purchasing", "inbox", "crm", "attribution", "customAutomations", "publicApi"]);
    expect(PLAN_FEATURES.enterprise).toEqual([...FEATURES]);
    for (const f of FEATURES) for (const p of PLANS) expect(hasFeature(p, f)).toBe(PLAN_RANK[p] >= PLAN_RANK[FEATURE_PLAN[f]]);
    expect(isPlan("scale")).toBe(true);
    expect(isPlan("gold")).toBe(false);
  });
});
