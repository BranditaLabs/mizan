import { PLANS } from "@mizan/shared";
import { z } from "zod";
import { SUBSCRIPTION_STATUSES } from "./state.js";

export const SubscriptionViewSchema = z.object({
  plan: z.enum(PLANS).describe("The plan the store is entitled to now (Free once a trial ends unpaid)"),
  status: z.enum(SUBSCRIPTION_STATUSES),
  subscribedPlan: z.enum(PLANS).describe("The plan of the subscription itself (a trial's tier)"),
  interval: z.enum(["month", "year"]),
  comped: z.boolean().describe("Mizan pays it (pilots, staff deals)"),
  cancelAtPeriodEnd: z.boolean(),
  currentPeriodEnd: z.iso.datetime().nullable(),
  timezone: z.string().describe("The store's time zone: days are counted in it"),
  trial: z.object({
    plan: z.enum(PLANS),
    startedAt: z.iso.datetime(),
    endsAt: z.iso.datetime().describe("23:59:59 on the last day, in the store's time zone"),
    daysLeft: z.number().int().min(0).describe("Calendar days left, today included: 7 on day 1, 1 on the last day"),
  }).nullable().describe("The running trial; null when none"),
  lastTrial: z.object({ plan: z.enum(PLANS), endedAt: z.iso.datetime() }).nullable().describe("The trial that ended most recently, if any (to say it is over)"),
});
export type SubscriptionView = z.output<typeof SubscriptionViewSchema>;
