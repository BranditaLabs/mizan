import { MoneySchema, PAYMENT_MODES, PAYMENT_STATUSES } from "@mizan/shared";
import { z } from "zod";
import { plainDecimal } from "../../platform/csv.js";
import { REFUND_DESTINATIONS, REFUND_STATUSES } from "./refunds.rules.js";

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

/** Payments list views (E14-6; docs/modules/M15 main screen). */
export const PAYMENT_VIEWS = ["all", "unpaid", "paid", "cod_due", "refunds", "disputes"] as const;
export type PaymentView = (typeof PAYMENT_VIEWS)[number];

export const ListPaymentsQuerySchema = z.object({
  view: z.enum(PAYMENT_VIEWS).default("all").describe("unpaid: waiting for money before shipping; cod_due: cash the courier still has to collect; refunds; disputes"),
  mode: z.enum(PAYMENT_MODES).optional(),
  q: z.string().trim().min(1).max(40).optional().describe("The order's number"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
});
export type ListPaymentsQuery = z.output<typeof ListPaymentsQuerySchema>;

const Totals = z.object({ currency: z.string(), total: MoneySchema, paid: MoneySchema, refunded: MoneySchema, balance: MoneySchema, cod: MoneySchema });

export const PaymentPageSchema = z.object({
  data: z.array(z.object({
    order: z.object({ id: z.uuid(), number: z.string(), status: z.string(), placedAt: z.iso.datetime() }),
    mode: z.enum(PAYMENT_MODES),
    status: z.enum(PAYMENT_STATUSES),
    methods: z.array(z.string()).describe("Methods in the order's ledger (card, wallet, instapay…)"),
    total: MoneySchema,
    paid: MoneySchema,
    refunded: MoneySchema,
    balance: MoneySchema.describe("What the customer still owes"),
    cod: MoneySchema.describe("Cash the courier collects"),
  })),
  counts: z.object({ all: z.number().int(), unpaid: z.number().int(), paid: z.number().int(), cod_due: z.number().int(), refunds: z.number().int(), disputes: z.number().int() }),
  totals: z.array(Totals).describe("The view's sums, one row per currency (never mixed)"),
  nextCursor: z.string().nullable(),
});
export type PaymentPage = z.output<typeof PaymentPageSchema>;

export const PaymentMixQuerySchema = z.object({ days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d), "7, 30 or 90").default(30) });

export const PaymentMixSchema = z.object({
  days: z.number().int(),
  orders: z.number().int().describe("Orders placed in the period, cancelled ones left out"),
  modes: z.array(z.object({ mode: z.enum(PAYMENT_MODES), orders: z.number().int(), pct: z.number().describe("Share of the period's orders, one decimal") })),
  received: z.array(z.object({ method: z.string(), amount: MoneySchema })).describe("Money in during the period by method, net of voids, per currency"),
});

const RefundAmount = z.string().transform((v, ctx) => {
  const d = plainDecimal(v);
  if (!d || !/[1-9]/.test(d)) {
    ctx.addIssue({ code: "custom", message: "a positive amount like 250 or 250.50" });
    return z.NEVER;
  }
  return d;
});

export const NewRefundSchema = z.object({
  amount: RefundAmount.describe("In the order's currency; Arabic digits accepted"),
  destination: z.enum(REFUND_DESTINATIONS).describe("original_method: back the way it came (online payments only); store_credit: to the customer's credit; bank_transfer; cash"),
  reason: z.string().trim().min(1).max(300).optional(),
  ticketId: z.uuid().optional().describe("The ticket this refund settles; it must be on the same order"),
}).strict();
export type NewRefund = z.output<typeof NewRefundSchema>;

export const RejectRefundSchema = z.object({ reason: z.string().trim().min(1).max(300) }).strict();
export const CompleteRefundSchema = z.object({
  reference: z.string().trim().min(1).max(100).optional().describe("The transfer or gateway reference"),
  note: z.string().trim().min(1).max(300).optional(),
}).strict();
export type CompleteRefund = z.output<typeof CompleteRefundSchema>;

export const ListRefundsQuerySchema = z.object({
  status: z.enum([...REFUND_STATUSES, "open", "all"]).default("open").describe("open: requested or approved, still to do (default)"),
  orderId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListRefundsQuery = z.output<typeof ListRefundsQuerySchema>;

const Person = z.object({ id: z.uuid(), name: z.string().nullable() });
export const RefundSchema = z.object({
  id: z.uuid(),
  number: z.string().describe("R-1001"),
  order: z.object({ id: z.uuid(), number: z.string() }),
  ticket: z.object({ id: z.uuid(), number: z.string() }).nullable(),
  amount: MoneySchema,
  destination: z.enum(REFUND_DESTINATIONS),
  status: z.enum(REFUND_STATUSES),
  reason: z.string().nullable(),
  requestedBy: Person.nullable(),
  approvedBy: Person.nullable(),
  rejectionReason: z.string().nullable(),
  reference: z.string().nullable(),
  needsApproval: z.boolean().describe("Over the store's threshold (or in another currency)"),
  can: z.object({ approve: z.boolean(), reject: z.boolean(), complete: z.boolean() }).describe("What the caller may do with it now"),
  completesFromStore: z.boolean().describe("Back to the original method on a store order: do it in the store; it completes when the store reports it"),
  createdAt: z.iso.datetime(),
  approvedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
});
export type Refund = z.output<typeof RefundSchema>;

export const RefundListSchema = z.object({
  data: z.array(RefundSchema),
  counts: z.object({ requested: z.number().int(), approved: z.number().int(), completed: z.number().int(), rejected: z.number().int() }),
});

export const RefundOptionsSchema = z.object({
  refundable: MoneySchema.describe("What the order holds less refunds still open"),
  destinations: z.array(z.enum(REFUND_DESTINATIONS)),
  approveOver: MoneySchema.describe("The store's threshold; above it a refund needs approval"),
});
