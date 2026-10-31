import { MoneySchema } from "@mizan/shared";
import { z } from "zod";
import { DASHBOARD_IDS, SERIES } from "./dashboards.js";

export const DashboardListSchema = z.object({ data: z.array(z.object({ id: z.enum(DASHBOARD_IDS), name: z.string() })) });

const period = {
  days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d), "7, 30 or 90").optional().describe("The last 7, 30 or 90 store days, today included (default 30)"),
  from: z.iso.date().optional().describe("Or a range of store days (with `to`, at most 366)"),
  to: z.iso.date().optional(),
};
const together = (q: { from?: string; to?: string }) => Boolean(q.from) === Boolean(q.to);

export const DashboardQuerySchema = z.object(period).refine(together, { message: "give from and to together", path: ["to"] });
export type DashboardQuery = z.output<typeof DashboardQuerySchema>;

export const ExportQuerySchema = z.object({ ...period, format: z.enum(["csv", "xlsx"]).default("xlsx").describe("Excel (default) or CSV (UTF-8 with BOM)") })
  .refine(together, { message: "give from and to together", path: ["to"] });
export type ExportQuery = z.output<typeof ExportQuerySchema>;

export const DashboardSchema = z.object({
  id: z.enum(DASHBOARD_IDS),
  name: z.string(),
  from: z.iso.date(),
  to: z.iso.date(),
  currency: z.string(),
  tiles: z.array(z.object({
    key: z.string(),
    name: z.string(),
    definition: z.string(),
    unit: z.enum(["count", "percent", "money", "days", "multiple"]),
    value: z.string().nullable(),
    money: MoneySchema.nullable().optional(),
  })).describe("The dashboard's metrics the caller may see, from the metric layer"),
  series: z.array(z.object({
    key: z.enum(SERIES),
    name: z.string(),
    unit: z.enum(["count", "money"]),
    points: z.array(z.object({ day: z.iso.date(), value: z.string() })),
  })).describe("Daily values, every day of the period"),
});
export type Dashboard = z.output<typeof DashboardSchema>;
