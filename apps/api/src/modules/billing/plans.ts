import { NEXT_PLAN, PLAN_LIMITS, PLAN_RANK, PLANS, type Plan, type PlanLimits } from "@mizan/shared";

/**
 * Plans and what each includes now live in @mizan/shared (plans.ts, E12-2a3): one contract for the
 * API, the dashboard and the landing. Re-exported here for the billing module. Order limits are
 * soft: E12-1 warns and prompts an upgrade, it never stops an order. null = no limit.
 */
export { NEXT_PLAN, PLAN_LIMITS, PLAN_RANK, PLANS, type Plan, type PlanLimits };

/** "2026-10" → the month's first day as a date string; null when not a month. */
export function monthStart(month: string): string | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  return m ? `${m[1]}-${m[2]}-01` : null;
}

/** The month before "2026-10-01" → "2026-09-01". */
export function previousMonth(first: string): string {
  const [y, m] = first.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
}

/** The month a moment falls in, in a time zone: "2026-10-01". */
export function monthOf(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-01`;
}

export const LIMIT_METRICS = ["orders", "stores", "users"] as const;
export type LimitMetric = (typeof LIMIT_METRICS)[number];
export interface LimitAlert { metric: LimitMetric; level: "near" | "over"; used: number; limit: number }
/** From this share of a limit, the store is told it is getting close. */
export const NEAR_SHARE = 0.8;

/**
 * Where the store stands against its plan (E12-1): `near` from 80% of a limit (all of it used
 * counts as near: the next one goes over), `over` past it. Soft: nothing is ever blocked.
 */
export function limitAlerts(used: { orders: number; stores: number; users: number }, limits: PlanLimits): LimitAlert[] {
  const pairs: Array<[LimitMetric, number, number | null]> = [["orders", used.orders, limits.ordersPerMonth], ["stores", used.stores, limits.stores], ["users", used.users, limits.users]];
  const out: LimitAlert[] = [];
  for (const [metric, n, limit] of pairs) {
    if (limit === null) continue;
    if (n > limit) out.push({ metric, level: "over", used: n, limit });
    else if (n >= Math.ceil(limit * NEAR_SHARE)) out.push({ metric, level: "near", used: n, limit });
  }
  return out;
}
