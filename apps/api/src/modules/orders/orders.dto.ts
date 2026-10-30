import { MoneySchema } from "@mizan/shared";
import { OrderSourceSchema } from "../attribution/attribution.dto.js";
import { z } from "zod";
import { MANUAL_PAYMENT_MODES, MONEY_IN_METHODS, ORDER_SOURCES } from "./manual-order.js";
import { BULK_ACTIONS, CANCEL_REASONS } from "./bulk.service.js";

export const ORDER_STATUSES = ["new", "pending_confirmation", "confirmed", "cancelled", "shipped", "delivered", "returned"] as const;
export const PAYMENT_MODES = ["cod", "prepaid", "partial", "bnpl", "bank_transfer", "store_credit", "mixed", "unknown"] as const;
export const PAYMENT_STATUSES = ["unpaid", "authorized", "partially_paid", "paid", "partially_refunded", "refunded", "disputed", "failed", "voided"] as const;

export const ListOrdersQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  /** needs_call: waiting for the team's call (confirmation escalated, retry time reached). */
  confirmation: z.enum(["needs_call"]).optional().describe("needs_call: orders the team should call now"),
  duplicate: z.enum(["suspected"]).optional().describe("suspected: likely duplicates waiting for the team (keep or merge)"),
  stock: z.enum(["short"]).optional().describe("short: confirmed orders waiting for stock (oversell blocked, E8-2)"),
  shipping: z.enum(["ready"]).optional().describe("ready: confirmed orders with no courier yet, not waiting for stock or a duplicate check (E7-2)"),
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
  duplicate: z.enum(["suspected", "kept", "merged"]).nullable().describe("A likely duplicate of an earlier order of the same customer (E5-3)"),
  stock: z.enum(["reserved", "short", "untracked"]).nullable().describe("Confirmed orders: reserved, short (waiting for stock) or untracked (no item counted in Mizan); null otherwise (E8-2)"),
});
export type OrderSummary = z.infer<typeof OrderSummarySchema>;

export const OrderPageSchema = z.object({
  data: z.array(OrderSummarySchema),
  nextCursor: z.string().nullable(),
  /** Per status for the same search and filters (the status filter aside): the list's tabs. */
  counts: z.object({ all: z.number().int(), ...Object.fromEntries(ORDER_STATUSES.map((s) => [s, z.number().int()])) } as Record<"all" | (typeof ORDER_STATUSES)[number], z.ZodNumber>),
  /** Orders the team should call now (the "Needs a call" tab). */
  needsCall: z.number().int(),
  /** Likely duplicates waiting for the team (the "Duplicates" tab). */
  duplicates: z.number().int(),
  /** Confirmed orders waiting for stock (the "Waiting for stock" tab). */
  waitingStock: z.number().int(),
  readyToShip: z.number().int().describe("Confirmed orders ready for the courier (E7-2)"),
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
    of: z.string().optional().describe("duplicate_found / duplicate_kept: the earlier order's number"),
    into: z.string().optional().describe("duplicate_merged: the order it was merged into"),
    status: z.string().optional().describe("shipment_status: the courier's status (canonical)"),
  }),
});

/**
 * One order (E5-2). Personal data stays masked as in the list: the label, the phone's last four
 * digits and the delivery area. Name, phone, street and map pin come only from POST …/reveal (audited).
 */
export const OrderDetailSchema = OrderSummarySchema.extend({
  externalId: z.string().nullable(),
  source: OrderSourceSchema.nullable().describe("Where the order came from (M7-2); null until it is known"),
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
    booking: z.enum(["pending", "booked", "failed"]).describe("E7-1: pending while the courier is booked; failed with errorCode"),
    errorCode: z.string().nullable().describe("Why the booking failed: city_unknown, address_invalid, payment_blocks, cancelled, not_found, courier_refused_key, courier_failed"),
    trackingUrl: z.string().nullable(),
  })),
  /** E10-4: the customer kept part of it; what they owe now. */
  partialDelivery: z.object({ due: MoneyLine, items: z.array(z.object({ lineId: z.uuid(), quantity: z.number().int() })), at: z.iso.datetime() }).nullable(),
  /** E10-4: refused at the door, why, and whether they opened the box first. */
  refusal: z.object({ reason: z.string(), openBox: z.boolean(), at: z.iso.datetime() }).nullable(),
  /** The earlier order this one likely repeats, and what matched (E5-3). */
  duplicateOf: z.object({
    id: z.uuid(), number: z.string(), status: z.enum(ORDER_STATUSES),
    items: z.array(z.string()).describe("Products in both orders"), minutesApart: z.number().int(),
  }).nullable(),
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

export const ResolveDuplicateSchema = z.strictObject({ action: z.enum(["keep", "merge"]).describe("keep: both are real orders; merge: cancel this one as a duplicate of the earlier") });
export const DuplicateResolvedSchema = z.object({ status: z.enum(["kept", "merged"]) });

/** E5-5: an order the team enters by hand (phone, WhatsApp, Instagram, walk-in). */
const Amount = z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/, "an amount like 150 or 150.50");
export const NewOrderSchema = z.strictObject({
  source: z.enum(ORDER_SOURCES).describe("Where the customer ordered"),
  customer: z.strictObject({ name: z.string().trim().min(2).max(120), phone: z.string().trim().min(6).max(24).describe("Local or international; checked for the store's country") }),
  address: z.strictObject({
    line1: z.string().trim().min(3).max(200), line2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(2).max(80), province: z.string().trim().max(80).optional(),
  }),
  lines: z.array(z.strictObject({
    variantId: z.uuid().optional().describe("A product from the catalogue (its price unless unitPrice is given)"),
    title: z.string().trim().min(1).max(200).optional().describe("An item not in the catalogue (needs unitPrice)"),
    quantity: z.number().int().min(1).max(999),
    unitPrice: Amount.optional(),
  }).refine((l) => Boolean(l.variantId) !== Boolean(l.title) && (l.variantId || l.unitPrice), "a catalogue product, or a title with a price")).min(1).max(50),
  shipping: Amount.default("0"),
  discount: Amount.default("0"),
  payment: z.strictObject({
    mode: z.enum(MANUAL_PAYMENT_MODES).describe("cod: the courier collects all; prepaid: paid in full; partial: a deposit now, the rest on delivery; bank_transfer: waits for the money unless paid"),
    method: z.enum(MONEY_IN_METHODS).optional().describe("How money already paid came in (prepaid, partial, bank_transfer)"),
    paid: Amount.optional().describe("partial: the deposit; prepaid: the total (optional); bank_transfer: the total once it arrived"),
  }),
});
export const OrderCreatedSchema = z.object({ id: z.uuid(), number: z.string(), status: z.enum(ORDER_STATUSES) });
export const OrderProductsQuerySchema = z.object({ q: z.string().trim().min(1).max(64).optional().describe("Product title or SKU") });
export const OrderProductsSchema = z.object({
  data: z.array(z.object({ variantId: z.uuid(), sku: z.string().nullable(), title: z.string(), price: MoneySchema, available: z.number().int().nullable() })),
});

/** E5-4: one action on many orders, applied by the worker in chunks. */
const OrderIds = z.array(z.uuid()).min(1).max(500).describe("Up to 500 orders");
export const BulkRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("assign"), orderIds: OrderIds, userId: z.uuid().nullable().describe("A team member, or null to unassign") }),
  z.strictObject({ action: z.literal("tag"), orderIds: OrderIds, tags: z.array(z.string().trim().toLowerCase().regex(/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,39}$/u)).min(1).max(5).describe("Added (in Shopify too); never removed") }),
  z.strictObject({ action: z.literal("confirm"), orderIds: OrderIds }),
  z.strictObject({ action: z.literal("cancel"), orderIds: OrderIds, reason: z.enum(CANCEL_REASONS) }),
  z.strictObject({ action: z.literal("ship"), orderIds: OrderIds }).describe("Book the courier for each confirmed order (E7-2)"),
]);
export const BulkActionSchema = z.object({
  id: z.uuid(), action: z.enum(BULK_ACTIONS), status: z.enum(["running", "done"]),
  total: z.number().int(), done: z.number().int(), skipped: z.number().int(), failed: z.number().int(),
  createdAt: z.iso.datetime(), finishedAt: z.iso.datetime().nullable(),
  issues: z.array(z.object({
    orderId: z.uuid(), number: z.string(), status: z.enum(["skipped", "failed"]),
    reason: z.string().describe("cancelled, unchanged, shipped, paid_needs_refund, already_confirmed, duplicate_suspected, not_found, already_shipping, not_confirmed, address_missing, payment_blocks_shipping, error…"),
  })).describe("Orders skipped or failed and why (200 at most)"),
});
