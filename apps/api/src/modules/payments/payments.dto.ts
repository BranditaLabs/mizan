import { MoneySchema } from "@mizan/shared";
import { z } from "zod";
import { plainDecimal } from "../../platform/csv.js";

/** Methods the team records by hand: money that moved outside any gateway Mizan reads. */
export const MANUAL_METHODS = ["bank_transfer", "instapay", "wallet", "cash_pos", "store_credit"] as const;

export const RecordPaymentSchema = z.object({
  type: z.enum(["received", "refunded"]).describe("Money the customer paid, or money given back to them"),
  method: z.enum(MANUAL_METHODS),
  amount: z.string().transform((v, ctx) => {
    const d = plainDecimal(v);
    if (!d || !/[1-9]/.test(d)) {
      ctx.addIssue({ code: "custom", message: "a positive amount like 250 or 250.50" });
      return z.NEVER;
    }
    return d;
  }).describe("In the order's currency, e.g. \"250.00\"; Arabic digits accepted"),
  note: z.string().max(300).optional().describe("A transfer reference or why; no card numbers"),
  occurredAt: z.iso.datetime({ offset: true }).optional().describe("When the money moved; now if absent"),
}).strict();
export type RecordPayment = z.output<typeof RecordPaymentSchema>;

export const LedgerSchema = z.object({
  orderId: z.uuid(),
  currency: z.string(),
  status: z.string().describe("The order's payment status"),
  total: MoneySchema,
  paid: MoneySchema.describe("Σ money-in lines (sale, capture, cash collected) less voids"),
  refunded: MoneySchema.describe("Σ refunds"),
  chargedBack: MoneySchema.describe("Chargebacks less reversals"),
  net: MoneySchema.describe("What the merchant holds: paid − refunded − charged back"),
  balance: MoneySchema.describe("What the customer still owes"),
  canRecord: z.boolean().describe("Whether the caller may record a payment or refund"),
  lines: z.array(z.object({
    id: z.uuid(),
    kind: z.string().describe("authorization, capture, sale, cod_collection, refund, chargeback, chargeback_reversal, void"),
    method: z.string(),
    status: z.string().describe("pending, succeeded, failed, cancelled; only succeeded lines count"),
    source: z.enum(["store", "gateway", "courier", "manual"]),
    amount: MoneySchema.describe("Signed: money in positive, money out negative"),
    fee: MoneySchema.nullable(),
    feeIsActual: z.boolean(),
    note: z.string().nullable(),
    recordedBy: z.string().nullable().describe("The team member's name, for lines they recorded"),
    occurredAt: z.iso.datetime(),
  })),
});
export type Ledger = z.output<typeof LedgerSchema>;
