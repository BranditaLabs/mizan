import { MoneySchema } from "@mizan/shared";
import { z } from "zod";

export const MetricCatalogueSchema = z.object({
  data: z.array(z.object({
    key: z.string(),
    version: z.number().int(),
    unit: z.enum(["count", "percent", "money", "days"]),
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
}).refine((q) => Boolean(q.from) === Boolean(q.to), { message: "give from and to together", path: ["to"] });
export type MetricValuesQuery = z.output<typeof MetricValuesQuerySchema>;

export const MetricValuesSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  currency: z.string().describe("The store's base currency, for money metrics"),
  data: z.array(z.object({
    key: z.string(),
    version: z.number().int(),
    unit: z.enum(["count", "percent", "money", "days"]),
    value: z.string().nullable().describe("Decimal string: a count, a percentage with one decimal (\"82.4\"), an amount, or days; null when it cannot be computed (nothing to divide by)"),
    money: MoneySchema.nullable().optional(),
    numerator: z.string().optional(),
    denominator: z.string().optional(),
  })),
});
