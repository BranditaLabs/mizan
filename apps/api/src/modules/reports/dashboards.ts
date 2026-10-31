/**
 * The built-in dashboards (M20, E15-2): which metrics each shows, and which daily series. Every
 * number comes from the metric layer (metrics.ts), so a tile shows what every other screen shows.
 */
export const DASHBOARD_IDS = ["home", "operations", "profit", "payments", "stock"] as const;
export type DashboardId = (typeof DASHBOARD_IDS)[number];
export const SERIES = ["orders", "net_profit"] as const;
export type SeriesKey = (typeof SERIES)[number];

export interface DashboardDefinition {
  id: DashboardId;
  name: { en: string; ar: string };
  metrics: readonly string[];
  series: readonly SeriesKey[];
}

export const DASHBOARDS: readonly DashboardDefinition[] = [
  { id: "home", name: { en: "Overview", ar: "نظرة عامة" }, metrics: ["orders", "net_profit", "delivered_rate", "prepaid_share"], series: ["orders", "net_profit"] },
  { id: "operations", name: { en: "Operations", ar: "التشغيل" }, metrics: ["orders", "delivered_rate", "rto_rate", "cod_share"], series: ["orders"] },
  { id: "profit", name: { en: "Profit", ar: "الأرباح" }, metrics: ["net_profit", "average_order_value", "delivered_rate", "rto_rate"], series: ["net_profit"] },
  { id: "payments", name: { en: "Payments", ar: "المدفوعات" }, metrics: ["prepaid_share", "cod_share", "orders", "average_order_value"], series: ["orders"] },
  { id: "stock", name: { en: "Stock", ar: "المخزون" }, metrics: ["days_of_cover", "orders"], series: ["orders"] },
];
export const dashboardById = new Map(DASHBOARDS.map((d) => [d.id, d]));
/** Daily series a role may see: profit only for those who see money. */
export const SERIES_ROLES: Record<SeriesKey, ReadonlySet<string>> = {
  orders: new Set(["owner", "admin", "ops_manager", "finance", "agent", "warehouse"]),
  net_profit: new Set(["owner", "admin", "ops_manager", "finance"]),
};
export const SERIES_NAMES: Record<SeriesKey, { en: string; ar: string }> = {
  orders: { en: "Orders per day", ar: "الأوردرات في اليوم" },
  net_profit: { en: "Net profit per day", ar: "صافي الربح في اليوم" },
};
