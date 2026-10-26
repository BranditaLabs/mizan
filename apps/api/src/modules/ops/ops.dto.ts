import { z } from "zod";
import { ADJUST_REASONS } from "../stock/stock.dto.js";

/** Operations the ops app can queue offline (E8-3); pick, pack and receive-by-PO come with E8-4 and M16. */
export const OP_TYPES = ["stock.receive", "stock.count", "stock.adjust"] as const;
export const OP_STATUSES = ["applied", "duplicate", "rejected", "conflict"] as const;

export const OpsSyncSchema = z.strictObject({
  deviceId: z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/).describe("The phone's install id, as the app made it"),
  ops: z.array(z.strictObject({
    opId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).describe("Made by the app once per operation (a UUID or ULID); a replay with the same opId changes nothing"),
    type: z.string().min(1).max(40).describe(`One of: ${OP_TYPES.join(", ")}`),
    payload: z.record(z.string(), z.unknown()),
    at: z.iso.datetime({ offset: true }).describe("When it happened on the phone; ops are applied in this order"),
  })).min(1).max(200),
});
export type OpsSyncBody = z.infer<typeof OpsSyncSchema>;

/** Payload of the stock ops: the item by id, barcode (a scan) or SKU (typed when the barcode won't read). */
export const StockOpPayloadSchema = z.strictObject({
  variantId: z.uuid().optional(),
  barcode: z.string().trim().min(1).max(64).optional(),
  sku: z.string().trim().min(1).max(100).optional(),
  quantity: z.number().int().min(-100_000).max(100_000),
  reason: z.enum(ADJUST_REASONS).optional(),
  note: z.string().trim().max(200).optional(),
}).refine((p) => Boolean(p.variantId ?? p.barcode ?? p.sku), { message: "name the item: variantId, barcode or sku" });

export const OpsSyncResultSchema = z.object({
  serverTime: z.iso.datetime(),
  results: z.array(z.object({
    opId: z.string(),
    status: z.enum(OP_STATUSES).describe("applied now; duplicate: already synced (see original); rejected: can never apply (fix and send a new op); conflict: the server's stock wins, tell the user"),
    original: z.enum(["applied", "rejected", "conflict"]).nullable().describe("For a duplicate: what happened the first time"),
    code: z.string().nullable().describe("unknown_type, invalid_payload, unknown_item, below_reserved…"),
    message: z.string().nullable(),
    result: z.record(z.string(), z.unknown()).nullable().describe("For applied stock ops: the item's levels after it"),
  })).describe("In the order the ops were sent"),
});
