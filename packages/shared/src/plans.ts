/**
 * Plans: what each includes (E12-2a3, docs/16 §7.2, docs/01 §8). One contract for the API, the
 * dashboard and the landing: limits and features live here, in code and pinned by tests; prices
 * live in the price book (plan_prices rows), never here.
 *
 * Limits: orders are soft (a warning and an upgrade prompt, never a stopped order); stores and
 * seats are checked when someone adds one. null = no limit.
 */
export const PLANS = ["free", "growth", "scale", "enterprise"] as const;
export type Plan = (typeof PLANS)[number];

export interface PlanLimits { ordersPerMonth: number | null; stores: number | null; users: number | null }
export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { ordersPerMonth: 300, stores: 1, users: 2 },
  growth: { ordersPerMonth: 3000, stores: 3, users: 8 },
  scale: { ordersPerMonth: 10_000, stores: null, users: 25 },
  enterprise: { ordersPerMonth: null, stores: null, users: null },
};
/** Automations a Free store keeps on after a trial; the rest are paused, never deleted (docs/16 §7.3). */
export const FREE_ACTIVE_AUTOMATIONS = 3;

export const PLAN_RANK: Record<Plan, number> = { free: 0, growth: 1, scale: 2, enterprise: 3 };
/** The plan to suggest when a limit is near or passed. */
export const NEXT_PLAN: Record<Plan, Plan | null> = { free: "growth", growth: "scale", scale: "enterprise", enterprise: null };

/** Paid features (entitlements); a plan has its own and every lower plan's. */
export const FEATURES = [
  "profit", "reports", "warehouse", "returns", "allCouriers", "allGateways", "automationRecipes",
  "reconciliation", "purchasing", "inbox", "crm", "attribution", "customAutomations", "publicApi",
  "riskNetwork", "multiCountry", "sandbox",
] as const;
export type Feature = (typeof FEATURES)[number];

/** The plan that first includes each feature. */
export const FEATURE_PLAN: Record<Feature, Plan> = {
  profit: "growth", reports: "growth", warehouse: "growth", returns: "growth", allCouriers: "growth", allGateways: "growth", automationRecipes: "growth",
  reconciliation: "scale", purchasing: "scale", inbox: "scale", crm: "scale", attribution: "scale", customAutomations: "scale", publicApi: "scale",
  riskNetwork: "enterprise", multiCountry: "enterprise", sandbox: "enterprise",
};

/** Every feature of a plan, lower plans' included. */
const featuresOf = (plan: Plan): readonly Feature[] => FEATURES.filter((f) => PLAN_RANK[FEATURE_PLAN[f]] <= PLAN_RANK[plan]);
export const PLAN_FEATURES: Record<Plan, readonly Feature[]> = { free: featuresOf("free"), growth: featuresOf("growth"), scale: featuresOf("scale"), enterprise: featuresOf("enterprise") };

export const hasFeature = (plan: Plan, feature: Feature): boolean => PLAN_RANK[FEATURE_PLAN[feature]] <= PLAN_RANK[plan];
export const isPlan = (v: string): v is Plan => (PLANS as readonly string[]).includes(v);
