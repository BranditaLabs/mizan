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

export const OrderIdParamSchema = z.uuid();

const MoneyLine = MoneySchema;
/** Timeline entry. `data` keeps business facts only (source, changed fields, reason, payment from → to). */
export const OrderEventSchema = z.object({
  id: z.uuid(),
  type: z.string().describe("created, updated, payment_changed, awaiting_payment, …"),
  fromStatus: z.string().nullable(),
  toStatus: z.string().nullable(),
  actorType: z.enum(["user", "system", "automation", "customer", "courier"]),
  at: z.iso.datetime(),
  data: z.object({
    source: z.string().optional(),
    channel: z.string().optional(),
    changed: z.array(z.string()).optional(),
    reason: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
});

/**
 * One order (E5-2). Personal data stays masked as in the list: the label, the phone's last four
 * digits and the delivery area. Name, phone, street and map pin come only from POST …/reveal (audited).
 */
export const OrderDetailSchema = OrderSummarySchema.extend({
  externalId: z.string().nullable(),
  currency: z.string(),
  subtotal: MoneyLine,
  shipping: MoneyLine,
  discount: MoneyLine,
  paid: MoneyLine,
  refunded: MoneyLine,
  balance: MoneyLine.describe("Still owed by the customer: total − paid, never below zero"),
  area: z.object({ city: z.string().nullable(), province: z.string().nullable(), country: z.string().nullable() }),
  hasLocation: z.boolean().describe("A map pin exists (shown on reveal)"),
  riskReasons: z.array(z.string()),
  assignedTo: z.uuid().nullable(),
  redacted: z.boolean().describe("Personal data deleted at the customer's or store's request"),
  timestamps: z.object({
    placedAt: z.iso.datetime(), confirmedAt: z.iso.datetime().nullable(), shippedAt: z.iso.datetime().nullable(),
    deliveredAt: z.iso.datetime().nullable(), cancelledAt: z.iso.datetime().nullable(),
  }),
  lines: z.array(z.object({
    id: z.uuid(), sku: z.string().nullable(), title: z.string(), quantity: z.number().int(), unitPrice: MoneyLine, total: MoneyLine, variantId: z.uuid().nullable(),
  })),
  payments: z.array(z.object({
    id: z.uuid(), kind: z.string(), method: z.string(), status: z.string(), amount: MoneyLine, occurredAt: z.iso.datetime(),
  })),
  shipments: z.array(z.object({
    id: z.uuid(), provider: z.string(), trackingNumber: z.string().nullable(), status: z.string(), statusAt: z.iso.datetime().nullable(), cod: MoneyLine,
  })),
  /** Newest first. */
  events: z.array(OrderEventSchema),
});
export type OrderDetail = z.infer<typeof OrderDetailSchema>;

/** The delivery contact, decrypted on request; every call is written to the audit log. */
export const RevealedCustomerSchema = z.object({
  name: z.string().nullable(),
  phone: z.string().nullable().describe("E.164"),
  address: z.object({
    line1: z.string().nullable(), line2: z.string().nullable(), city: z.string().nullable(), province: z.string().nullable(), country: z.string().nullable(),
  }),
  location: z.object({ lat: z.number(), lng: z.number() }).nullable(),
});
export type RevealedCustomer = z.infer<typeof RevealedCustomerSchema>;
