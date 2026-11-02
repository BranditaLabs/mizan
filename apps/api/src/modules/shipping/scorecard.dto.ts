import { z } from "zod";

export const ScorecardQuerySchema = z.object({
  days: z.coerce.number().int().refine((d) => [30, 90, 180].includes(d), "30, 90 or 180").default(90).describe("Shipments booked in the last 30, 90 or 180 days"),
});
export type ScorecardQuery = z.output<typeof ScorecardQuerySchema>;

const Stats = z.object({
  shipments: z.number().int().describe("Booked in the period"),
  delivered: z.number().int(),
  returned: z.number().int().describe("Returned or on the way back"),
  inFlight: z.number().int().describe("Still with the courier"),
  deliveredRate: z.string().nullable().describe("delivered ÷ (delivered + returned), one decimal: the metric layer's formula; null until one ended"),
  rtoRate: z.string().nullable(),
  avgDaysToDeliver: z.string().nullable().describe("Booked → delivered, in days, one decimal"),
});
export const ScorecardSchema = z.object({
  days: z.number().int(),
  couriers: z.array(Stats.extend({
    courier: z.string(),
    zones: z.array(Stats.extend({ zone: z.string().nullable().describe("The governorate (or city when there is none); null when unknown") })).describe("Most shipments first"),
  })),
});
export type Scorecard = z.output<typeof ScorecardSchema>;
