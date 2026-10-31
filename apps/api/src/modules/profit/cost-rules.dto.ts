import { MoneySchema } from "@mizan/shared";
import { z } from "zod";

export const COST_RULE_KINDS = ["agent_per_order", "packaging_per_order", "cod_fee_pct", "payment_fee_pct", "courier_rate", "fixed_monthly"] as const;
export type CostRuleKind = (typeof COST_RULE_KINDS)[number];
/** Ledger payment methods (migration 0002 `payments.method`), for gateway fee rules. */
export const PAYMENT_METHODS = ["card", "wallet", "apple_pay", "bnpl", "bank_transfer", "instapay", "fawry_ref", "store_credit", "cash_pos", "marketplace"] as const;

/** Money in the store's base currency, as typed: "7.50", "60". */
const Amount = z.string().trim().regex(/^\d{1,12}(\.\d{1,3})?$/, "a decimal amount like 7.50");
const Percent = z.string().trim().regex(/^\d{1,3}(\.\d{1,3})?$/, "a percentage like 1.5").refine((v) => Number(v) <= 100, "at most 100");
const Courier = z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{2,32}$/, "a courier code like bosta");
const Day = z.iso.date().describe("YYYY-MM-DD in the store's time zone");
const validFrom = Day.optional().describe("First day the rule applies (default: today, store time)");

/**
 * A cost rule (M5). Amounts are in the store's base currency. Saving a rule for the same kind and
 * scope starts a new version from `validFrom` and closes the previous one: older orders keep the
 * cost that applied on their day.
 */
export const CreateCostRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("packaging_per_order"), amount: Amount, scope: z.strictObject({ connectionId: z.uuid().optional() }).default({}), validFrom }),
  z.object({ kind: z.literal("agent_per_order"), amount: Amount, scope: z.strictObject({ connectionId: z.uuid().optional() }).default({}), validFrom }),
  z.object({ kind: z.literal("cod_fee_pct"), pct: Percent, scope: z.strictObject({ courier: Courier.optional() }).default({}), validFrom }),
  z.object({
    kind: z.literal("payment_fee_pct"), pct: Percent, fixed: Amount.optional().describe("Fixed part per payment, e.g. 2.5% + 2.00"),
    scope: z.strictObject({ method: z.enum(PAYMENT_METHODS).optional() }).default({}), validFrom,
  }),
  z.object({
    kind: z.literal("courier_rate"), amount: Amount.describe("Delivery price"), returnAmount: Amount.optional().describe("Price of a return leg"),
    scope: z.strictObject({ courier: Courier, zone: z.string().trim().toLowerCase().min(1).max(60).optional() }), validFrom,
  }),
  z.object({ kind: z.literal("fixed_monthly"), amount: Amount, scope: z.strictObject({ label: z.string().trim().min(1).max(60) }), validFrom }),
]);
export type CreateCostRule = z.output<typeof CreateCostRuleSchema>;

export const CostRuleSchema = z.object({
  id: z.uuid(),
  kind: z.enum(COST_RULE_KINDS),
  scope: z.object({
    connectionId: z.uuid().optional(), courier: z.string().optional(), zone: z.string().optional(), method: z.string().optional(), label: z.string().optional(),
  }),
  amount: MoneySchema.nullable(),
  returnAmount: MoneySchema.nullable(),
  pct: z.string().nullable(),
  fixed: MoneySchema.nullable(),
  validFrom: z.iso.date(),
  validTo: z.iso.date().nullable().describe("Last day it applies; null = until changed"),
  createdAt: z.iso.datetime(),
});
export type CostRuleView = z.infer<typeof CostRuleSchema>;

export const CostRuleListSchema = z.object({
  baseCurrency: z.string(),
  today: z.iso.date().describe("Today in the store's time zone"),
  data: z.array(CostRuleSchema),
});

export const CostRuleQuerySchema = z.object({
  at: Day.optional().describe("Rules that apply on this day (default today)"),
  history: z.stringbool().optional().describe("Every version, newest first"),
});
