import { MoneySchema } from "@mizan/shared";
import { z } from "zod";
import { isWeekParam } from "./week.js";

export const MetricCatalogueSchema = z.object({
  data: z.array(z.object({
    key: z.string(),
    version: z.number().int(),
    unit: z.enum(["count", "percent", "money", "days", "multiple"]),
    module: z.string(),
    name: z.string(),
    definition: z.string(),
  })).describe("The metrics the caller may see, in their language"),
});

export const MetricValuesQuerySchema = z.object({
  keys: z.string().max(400).optional().describe("Comma-separated metric keys; every metric the caller may see if absent"),
  days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d), "7, 30 or 90").optional().describe("The last 7, 30 or 90 store days, today included (default 30)"),
  from: z.iso.date().optional().describe("Or a range of store days (with `to`, at most 366)"),
  to: z.iso.date().optional(),
  week: z.string().max(8).refine(isWeekParam, "an ISO week such as 2026-W43, or last").optional()
    .describe("Or an ISO week, Monday to Sunday in store days (\"2026-W43\"); \"last\" for the last full week"),
}).refine((q) => Boolean(q.from) === Boolean(q.to) && (!q.week || (!q.from && q.days === undefined)), { message: "give from and to together; a week alone", path: ["to"] });
export type MetricValuesQuery = z.output<typeof MetricValuesQuerySchema>;

/** FX-2: how far the period's profit can be trusted; the same on Today, the order, Profit and Reports. */
export const ProfitQualitySchema = z.object({
  costsComplete: z.boolean().describe("No order of the period misses a cost (product cost, courier rate, fee, FX rate)"),
  delivered: z.boolean().describe("At least one order of the period was delivered"),
  provisional: z.boolean().describe("Costs missing or nothing delivered: show \"Provisional profit\", never a margin"),
  ordersMissingCosts: z.number().int(),
  productsMissingCost: z.number().int().describe("Distinct products in those orders with no cost yet"),
});

export const MetricValuesSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  currency: z.string().describe("The store's base currency, for money metrics"),
  quality: ProfitQualitySchema,
  data: z.array(z.object({
    key: z.string(),
    version: z.number().int(),
    unit: z.enum(["count", "percent", "money", "days", "multiple"]),
    value: z.string().nullable().describe("Decimal string: a count, a percentage with one decimal (\"82.4\"), an amount, or days; null when it cannot be computed (nothing to divide by)"),
    money: MoneySchema.nullable().optional(),
    provisional: z.boolean().describe("A profit figure whose inputs are not all there yet (quality.provisional): never shown as final"),
    numerator: z.string().optional(),
    denominator: z.string().optional(),
  })),
});
