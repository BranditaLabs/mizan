/**
 * Plans and what each includes (docs/01 §8, proposals to validate with pilot merchants). Limits
 * are soft: E12-1 warns and prompts an upgrade, it never stops an order. null = no limit.
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
