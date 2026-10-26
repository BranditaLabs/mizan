import { z } from "zod";

export const STOCK_FILTERS = ["all", "counted", "not_counted", "out", "low"] as const;
export const MOVEMENT_KINDS = ["receive", "count", "adjust"] as const;
export const ADJUST_REASONS = ["damaged", "lost", "found", "correction", "other"] as const;

export const StockQuerySchema = z.object({
  search: z.string().trim().max(100).optional().describe("Product title, SKU or barcode (part of it)"),
  filter: z.enum(STOCK_FILTERS).default("all").describe("counted: stock kept in Mizan; out: counted with nothing available; low: at or under its threshold"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
});

export const StockRowSchema = z.object({
  variantId: z.uuid(),
  productTitle: z.string(),
  variantTitle: z.string().nullable(),
  sku: z.string(),
  barcode: z.string().nullable(),
  counted: z.boolean().describe("true once received or counted in Mizan; then confirmed orders reserve it"),
  onHand: z.number().int().nullable(),
  reserved: z.number().int().nullable(),
  available: z.number().int().nullable().describe("On hand − reserved; null when not counted"),
  storeAvailable: z.number().int().nullable().describe("What the store last reported (information only once counted here)"),
  lowStockAt: z.number().int().nullable(),
});

export const StockPageSchema = z.object({
  data: z.array(StockRowSchema),
  nextCursor: z.string().nullable(),
  warehouse: z.object({ id: z.uuid(), name: z.string() }),
  counts: z.object({
    variants: z.number().int(), counted: z.number().int(), out: z.number().int(), low: z.number().int(),
    waitingOrders: z.number().int().describe("Confirmed orders waiting for stock (oversell blocked)"),
  }),
});

export const RecordMovementsSchema = z.strictObject({
  items: z.array(z.strictObject({
    variantId: z.uuid(),
    kind: z.enum(MOVEMENT_KINDS).describe("receive: add arrived stock; count: set on hand to what was counted; adjust: add or remove with a reason"),
    quantity: z.number().int().min(-100_000).max(100_000).describe("receive: > 0; count: ≥ 0 (the number on the shelf); adjust: ≠ 0"),
    reason: z.enum(ADJUST_REASONS).optional().describe("Required for adjust"),
  })).min(1).max(200),
  note: z.string().trim().max(200).optional(),
}).superRefine((b, ctx) => b.items.forEach((i, n) => {
  const bad = i.kind === "receive" ? i.quantity <= 0 : i.kind === "count" ? i.quantity < 0 : i.quantity === 0;
  if (bad) ctx.addIssue({ code: "custom", path: ["items", n, "quantity"], message: `not a valid quantity for ${i.kind}` });
  if (i.kind === "adjust" && !i.reason) ctx.addIssue({ code: "custom", path: ["items", n, "reason"], message: "an adjustment needs a reason" });
}));
export type RecordMovementsBody = z.infer<typeof RecordMovementsSchema>;

export const MovementsRecordedSchema = z.object({
  applied: z.number().int().describe("Items whose stock changed"),
  levels: z.array(z.object({ variantId: z.uuid(), onHand: z.number().int(), reserved: z.number().int(), available: z.number().int() })),
  ordersReserved: z.number().int().describe("Orders waiting for stock that are now reserved"),
});

export const StockHistorySchema = z.object({
  data: z.array(z.object({
    id: z.uuid(),
    at: z.iso.datetime(),
    kind: z.enum(["receive", "count", "adjust", "reserve", "release", "pick", "return_restock", "transfer_in", "transfer_out", "write_off"]),
    delta: z.number().int().describe("Change to on hand (receive, count, adjust, pick) or to reserved (reserve, release)"),
    reason: z.string().nullable(),
    note: z.string().nullable(),
    order: z.object({ id: z.uuid(), number: z.string() }).nullable(),
  })),
});

export const ThresholdSchema = z.strictObject({
  lowStockAt: z.number().int().min(0).max(100_000).nullable().describe("Alert (stock.low) when available falls to this or under; null: no alert"),
});

export const ThresholdSetSchema = z.object({ variantId: z.uuid(), lowStockAt: z.number().int().nullable(), available: z.number().int() });
