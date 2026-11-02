import { z } from "zod";
import { PLANS } from "./plans.js";

export const UsageQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().describe("YYYY-MM in the store's time zone; this month if absent"),
});

const Metrics = z.object({
  orders: z.number().int().describe("Orders placed in the month, every channel"),
  whatsappMessages: z.number().int().describe("WhatsApp messages Mizan sent (failed sends not counted)"),
  aiOffers: z.number().int().describe("Offers Claude wrote"),
  stores: z.number().int().describe("Store connections that are on"),
  users: z.number().int().describe("Active team members"),
});

const Limit = z.number().int().nullable();
export const UsageSchema = z.object({
  month: z.string().describe("YYYY-MM"),
  timezone: z.string(),
  plan: z.enum(PLANS),
  closed: z.boolean().describe("The month is over and its numbers are frozen"),
  usage: Metrics,
  limits: z.object({ ordersPerMonth: Limit, stores: Limit, users: Limit }).describe("The plan's limits; null = none"),
  alerts: z.array(z.object({ metric: z.enum(["orders", "stores", "users"]), level: z.enum(["near", "over"]), used: z.number().int(), limit: z.number().int() }))
    .describe("Limits this month is near (80%) or past; nothing is blocked"),
  nextPlan: z.object({ plan: z.enum(PLANS), limits: z.object({ ordersPerMonth: Limit, stores: Limit, users: Limit }) }).nullable().describe("The plan to upgrade to; null on the top plan"),
  upgradeRequest: z.object({ plan: z.enum(PLANS), at: z.iso.datetime() }).nullable().describe("An upgrade the store asked for and that is not done yet"),
  history: z.array(z.object({ month: z.string(), orders: z.number().int(), whatsappMessages: z.number().int(), aiOffers: z.number().int(), closed: z.boolean() }))
    .describe("This month and the five before, newest first"),
});
export type Usage = z.output<typeof UsageSchema>;

export const UpgradeRequestSchema = z.object({ plan: z.enum(PLANS).describe("A plan above the current one") }).strict();
export const UpgradeRequestedSchema = z.object({ plan: z.enum(PLANS), at: z.iso.datetime() });
