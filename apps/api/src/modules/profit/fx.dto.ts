import { z } from "zod";

const Rate = z.string().trim().regex(/^\d{1,10}(\.\d{1,8})?$/, "a rate like 48.75").refine((v) => Number(v) > 0, "must be more than 0");

export const FxQuerySchema = z.object({ day: z.iso.date().optional().describe("Default today (store time)") });

export const FxRateSchema = z.object({
  quote: z.string(),
  rate: z.string().nullable().describe("1 base = rate quote; null when missing"),
  source: z.enum(["manual", "feed", "same", "missing"]),
  day: z.iso.date().nullable().describe("Day of the rate used (earlier than asked when stale)"),
  stale: z.boolean(),
});
export const FxRatesSchema = z.object({
  base: z.string(),
  day: z.iso.date(),
  feed: z.string().nullable().describe("Where daily rates come from (shown with attribution)"),
  rates: z.array(FxRateSchema),
});
export type FxRateView = z.infer<typeof FxRateSchema>;

export const SetFxRateSchema = z.object({ rate: Rate.describe("1 unit of the store's base currency = rate units of the quote currency") });
export const FxParamsSchema = z.object({ day: z.iso.date(), quote: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/) });
