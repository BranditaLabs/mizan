import { MoneySchema } from "@mizan/shared";
import { z } from "zod";

export const ORDER_STATUSES = ["new", "pending_confirmation", "confirmed", "cancelled", "shipped", "delivered", "returned"] as const;
export const PAYMENT_MODES = ["cod", "prepaid", "partial", "bnpl", "bank_transfer", "store_credit", "mixed", "unknown"] as const;
export const PAYMENT_STATUSES = ["unpaid", "authorized", "partially_paid", "paid", "partially_refunded", "refunded", "disputed", "failed", "voided"] as const;

export const ListOrdersQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  /** Order number ("#1042", "1042"), the store's order id, or the customer's phone in any form. */
  q: z.string().trim().min(1).max(64).optional().describe("Order number, store order id, or the customer's phone"),
  paymentMode: z.enum(PAYMENT_MODES).optional(),
  connectionId: z.uuid().optional(),
  /** Placed at or after (ISO date-time). */
  from: z.iso.datetime({ offset: true }).optional(),
  /** Placed before (ISO date-time). */
  to: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
});
export type ListOrdersQuery = z.output<typeof ListOrdersQuerySchema>;

/** A list row: no personal data beyond a minimised label and the phone's last four digits. */
export const OrderSummarySchema = z.object({
  id: z.uuid(),
  number: z.string(),
  status: z.enum(ORDER_STATUSES),
  channel: z.string(),
  store: z.object({ connectionId: z.uuid().nullable(), provider: z.string().nullable() }),
  customer: z.object({ label: z.string().nullable().describe('"Mona A."'), phoneLast4: z.string().nullable() }),
  total: MoneySchema,
  /** Cash the courier collects (0 when prepaid); from cashToCollect, never the total. */
  cod: MoneySchema.describe("Cash the courier collects; from cashToCollect, never the total"),
  paymentMode: z.enum(PAYMENT_MODES),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  risk: z.number().int().min(0).max(100).nullable(),
  tags: z.array(z.string()),
  placedAt: z.iso.datetime(),
});
export type OrderSummary = z.infer<typeof OrderSummarySchema>;

export const OrderPageSchema = z.object({
  data: z.array(OrderSummarySchema),
  nextCursor: z.string().nullable(),
  /** Per status for the same search and filters (the status filter aside): the list's tabs. */
  counts: z.object({ all: z.number().int(), ...Object.fromEntries(ORDER_STATUSES.map((s) => [s, z.number().int()])) } as Record<"all" | (typeof ORDER_STATUSES)[number], z.ZodNumber>),
});
