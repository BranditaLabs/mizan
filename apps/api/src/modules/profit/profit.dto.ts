import { MoneySchema } from "@mizan/shared";
import { z } from "zod";

/** One order's profit (E9-2). Realised numbers count money that is real; expected = if it delivers. */
export const OrderPnlSchema = z.object({
  currency: z.string(),
  day: z.iso.date().nullable().describe("The order's day, store time (rules and rate of that day)"),
  isFinal: z.boolean().describe("Final once settled or inspected; provisional before"),
  flags: z.array(z.string()).describe("fx_missing, ads_fx_missing, cost_missing, shipping_rate_missing, cod_fee_missing, payment_fee_missing, agent_cost_missing, packaging_cost_missing, return_rate_missing, estimated, awaiting_settlement"),
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

export const HomeQuerySchema = z.object({
  days: z.coerce.number().int().refine((v) => [7, 30, 90].includes(v), "7, 30 or 90").default(30).describe("Period: the last 7, 30 or 90 store days, today included"),
});

const Pct = z.string().nullable().describe("Percent with one decimal (\"14.9\"); null when there is nothing to divide by");
export const HOME_LEAKS = ["losing_orders", "refusals", "unallocated_ads", "other_currency", "cost_missing", "shipping_rate_missing", "cod_fee_missing", "agent_cost_missing", "packaging_cost_missing", "payment_fee_missing", "fx_missing", "ads_fx_missing", "sync_gap"] as const;

/** The profit home (E9-4), in the store's base currency; orders by the store day they were placed. */
export const ProfitHomeSchema = z.object({
  baseCurrency: z.string(),
  today: z.iso.date(),
  from: z.iso.date(),
  to: z.iso.date(),
  days: z.number().int(),
  yesterday: z.object({ day: z.iso.date(), orders: z.number().int(), revenue: MoneySchema, net: MoneySchema, expectedNet: MoneySchema }),
  period: z.object({
    orders: z.number().int(),
    revenue: MoneySchema.describe("Money that is real: prepaid when paid, COD when delivered; less refunds"),
    net: MoneySchema.describe("Σ orders' realised profit"),
    expectedNet: MoneySchema.describe("Σ orders' profit if those still on their way deliver"),
    fixedCosts: MoneySchema.describe("Monthly fixed costs spread over the period's days"),
    unallocatedAds: MoneySchema.describe("Ad spend on days with no order to carry it"),
    kept: MoneySchema.describe("What the store kept: net − fixed costs − unallocated ads"),
    expectedKept: MoneySchema,
    margin: Pct.describe("kept ÷ revenue"),
    keptPer100: MoneySchema.nullable().describe("Of every 100 of revenue, what was kept"),
    previousKept: MoneySchema.describe("The same for the period before"),
    change: Pct.describe("kept vs the period before"),
    delivered: z.number().int(),
    returned: z.number().int().describe("Refused or returned after shipping"),
    deliveryRate: Pct.describe("delivered ÷ (delivered + returned)"),
    refusalLoss: MoneySchema.describe("What refused orders lost, all costs counted"),
    adSpend: MoneySchema,
    breakdown: z.object({
      revenue: MoneySchema, productCost: MoneySchema, shippingAndCod: MoneySchema, ads: MoneySchema, returns: MoneySchema, team: MoneySchema,
      fees: MoneySchema.describe("Payment, channel and chargeback fees and packaging"), fixed: MoneySchema, kept: MoneySchema,
    }).describe("Where every pound of revenue went"),
  }),
  cash: z.object({
    inTransit: MoneySchema.describe("Cash to collect on parcels on their way"), inTransitOrders: z.number().int(),
    awaitingRemittance: MoneySchema.describe("Cash collected by couriers, not yet paid to the store"), awaitingRemittanceOrders: z.number().int(),
  }),
  trend: z.array(z.object({ day: z.iso.date(), orders: z.number().int(), net: MoneySchema, expectedNet: MoneySchema })),
  leaks: z.array(z.object({ kind: z.enum(HOME_LEAKS), count: z.number().int(), amount: MoneySchema.nullable() })).describe("What is costing money or hiding it, most costly first"),
});
