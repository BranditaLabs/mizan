import { MoneySchema } from "@mizan/shared";
import { z } from "zod";

/** One order's profit (E9-2). Realised numbers count money that is real; expected = if it delivers. */
export const OrderPnlSchema = z.object({
  currency: z.string(),
  day: z.iso.date().nullable().describe("The order's day, store time (rules and rate of that day)"),
  isFinal: z.boolean().describe("Final once settled or inspected; provisional before"),
  flags: z.array(z.string()).describe("fx_missing, cost_missing, shipping_rate_missing, cod_fee_missing, payment_fee_missing, agent_cost_missing, packaging_cost_missing, return_rate_missing, estimated, awaiting_settlement"),
  computedAt: z.iso.datetime(),
  revenue: MoneySchema, refunds: MoneySchema, productCost: MoneySchema, shipping: MoneySchema, codFee: MoneySchema, paymentFee: MoneySchema,
  channelFee: MoneySchema, ads: MoneySchema, agent: MoneySchema, packaging: MoneySchema, returns: MoneySchema, chargebacks: MoneySchema,
  net: MoneySchema.describe("Realised profit so far"),
  expectedRevenue: MoneySchema,
  expectedNet: MoneySchema.describe("Profit if the order delivers (orders still moving); equals net otherwise"),
});

export const RecalculateSchema = z.object({
  from: z.iso.date().optional().describe("First order day (store time)"),
  to: z.iso.date().optional().describe("Last order day (store time)"),
});
export const RecalculatedSchema = z.object({ recomputed: z.number().int(), truncated: z.boolean().describe("More provisional orders remain: call again") });
