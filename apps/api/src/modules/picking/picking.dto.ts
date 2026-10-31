import { z } from "zod";

/** E8-4c: a pick list from confirmed orders (these, or the oldest ready ones). */
export const NewPickListSchema = z.strictObject({
  orderIds: z.array(z.uuid()).min(1).max(100).optional().describe("Orders to pick; without it, the oldest confirmed orders ready to pack"),
  limit: z.number().int().min(1).max(100).default(30).describe("How many orders when orderIds is not given"),
});

const Line = z.object({
  variantId: z.uuid().nullable(), sku: z.string().nullable(), barcode: z.string().nullable(), title: z.string(), quantity: z.number().int(),
});

export const PickListSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  status: z.enum(["open", "closed"]),
  createdAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
  /** What to take from the shelves for the orders not packed yet, sorted by shelf (bin), then SKU. */
  items: z.array(Line.extend({ bin: z.string().nullable() })).describe("Totals for the unpacked orders, sorted by bin then SKU"),
  orders: z.array(z.object({
    id: z.uuid(), number: z.string(), packedAt: z.iso.datetime().nullable(), lines: z.array(Line),
  })).describe("Each order with what must be scanned to pack it"),
});
export type PickList = z.infer<typeof PickListSchema>;

export const PickListPageSchema = z.object({
  data: z.array(z.object({ id: z.uuid(), number: z.number().int(), status: z.enum(["open", "closed"]), orders: z.number().int(), packed: z.number().int(), createdAt: z.iso.datetime() })),
});
export const PickListsQuerySchema = z.object({ status: z.enum(["open", "closed"]).default("open") });

/** Payload of the ops app's `order.pack`: the order and every item scanned into the box. */
export const PackPayloadSchema = z.strictObject({
  orderId: z.uuid().optional(),
  orderNumber: z.string().trim().min(1).max(40).optional(),
  items: z.array(z.strictObject({
    variantId: z.uuid().optional(),
    barcode: z.string().trim().min(1).max(64).optional(),
    sku: z.string().trim().min(1).max(100).optional(),
    quantity: z.number().int().min(1).max(10_000),
  }).refine((i) => Boolean(i.variantId ?? i.barcode ?? i.sku), { message: "name the item: variantId, barcode or sku" })).min(1).max(200),
  /** A barcode would not read and the item was typed: logged as manual. */
  manual: z.boolean().default(false),
}).refine((p) => Boolean(p.orderId ?? p.orderNumber), { message: "name the order: orderId or orderNumber" });
export type PackPayload = z.infer<typeof PackPayloadSchema>;
