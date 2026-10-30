import { z } from "zod";

/** A non-negative decimal amount as a string ("90.00"); checked against the currency's decimals by the service. */
const Amount = z.string().trim().regex(/^\d{1,12}(\.\d{1,3})?$/, "an amount like 90 or 90.50");
const Currency = z.string().trim().regex(/^[A-Z]{3}$/, "a 3-letter currency code (ISO 4217)");

// ───────────── Suppliers ─────────────

export const NewSupplierSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  currency: Currency.describe("What the supplier invoices in; POs default to it"),
  contactName: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(32).optional().describe("Shown to the team; not used for messages yet"),
  email: z.email().max(200).optional(),
  country: z.string().trim().regex(/^[A-Z]{2}$/).optional(),
  leadTimeDays: z.number().int().min(0).max(365).optional(),
  paymentTerms: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
});
export type NewSupplier = z.infer<typeof NewSupplierSchema>;

export const UpdateSupplierSchema = NewSupplierSchema.partial().extend({
  archived: z.boolean().optional().describe("Archived suppliers are hidden and get no new POs; their POs stay"),
});
export type UpdateSupplier = z.infer<typeof UpdateSupplierSchema>;

export const SupplierSchema = z.object({
  id: z.uuid(), name: z.string(), currency: z.string(),
  contactName: z.string().nullable(), phone: z.string().nullable(), email: z.string().nullable(), country: z.string().nullable(),
  leadTimeDays: z.number().int().nullable(), paymentTerms: z.string().nullable(), notes: z.string().nullable(),
  archived: z.boolean(), openOrders: z.number().int().describe("POs not yet received or cancelled"),
});
export const SupplierListSchema = z.object({ data: z.array(SupplierSchema) });
export const SuppliersQuerySchema = z.object({ archived: z.enum(["true", "false"]).default("false").transform((v) => v === "true") });

// ───────────── Purchase orders ─────────────

export const PO_STATUSES = ["draft", "approved", "sent", "partially_received", "received", "cancelled"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];
/** Where stock can still arrive. */
export const RECEIVABLE: readonly PoStatus[] = ["approved", "sent", "partially_received"];

const PoLineInput = z.strictObject({
  variantId: z.uuid(),
  quantity: z.number().int().min(1).max(1_000_000),
  unitCost: Amount.describe("Per unit, in the PO's currency"),
});

export const NewPurchaseOrderSchema = z.strictObject({
  supplierId: z.uuid(),
  currency: Currency.optional().describe("Defaults to the supplier's"),
  expectedAt: z.iso.date().optional().describe("When the supplier should deliver (YYYY-MM-DD)"),
  notes: z.string().trim().max(500).optional(),
  lines: z.array(PoLineInput).min(1).max(200),
}).refine((b) => new Set(b.lines.map((l) => l.variantId)).size === b.lines.length, { message: "each item once per PO", path: ["lines"] });
export type NewPurchaseOrder = z.infer<typeof NewPurchaseOrderSchema>;

export const PurchaseOrdersQuerySchema = z.object({
  status: z.enum([...PO_STATUSES, "open"]).optional().describe("open = approved, sent or partially received (what the warehouse can receive)"),
  supplierId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const Money = z.object({ amount: z.string(), currency: z.string() });

export const PurchaseOrderSummarySchema = z.object({
  id: z.uuid(), number: z.string(), status: z.enum(PO_STATUSES),
  supplier: z.object({ id: z.uuid(), name: z.string() }),
  total: Money, items: z.number().int().describe("Lines (SKUs)"), units: z.number().int(),
  receivedUnits: z.number().int().describe("Good and damaged units that arrived"),
  expectedAt: z.iso.date().nullable(), late: z.boolean().describe("Expected date passed and not fully received"),
  createdAt: z.iso.datetime(),
});
export const PurchaseOrderListSchema = z.object({
  data: z.array(PurchaseOrderSummarySchema),
  counts: z.record(z.enum(PO_STATUSES), z.number().int()),
});

export const PurchaseOrderSchema = PurchaseOrderSummarySchema.extend({
  notes: z.string().nullable(),
  approvedAt: z.iso.datetime().nullable(), sentAt: z.iso.datetime().nullable(), receivedAt: z.iso.datetime().nullable(), cancelledAt: z.iso.datetime().nullable(),
  needsOwner: z.boolean().describe("Above the approval threshold (or in a foreign currency): only owner or admin can approve"),
  lines: z.array(z.object({
    id: z.uuid(), variantId: z.uuid(), sku: z.string().nullable(), barcode: z.string().nullable(), title: z.string(),
    quantity: z.number().int(), received: z.number().int(), damaged: z.number().int(), unitCost: Money,
  })),
  receipts: z.array(z.object({
    id: z.uuid(), number: z.number().int(), receivedAt: z.iso.datetime(), units: z.number().int(), damaged: z.number().int(),
    costStatus: z.enum(["applied", "fx_missing"]).describe("fx_missing: stock went in, but no FX rate for the day, so the cost was not updated"),
    fxRate: z.string().nullable().describe("1 item currency = rate PO currency, locked at receipt"),
    overApproved: z.boolean(), viaApp: z.boolean(),
  })),
});
export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;

/** Items of a receipt: by id, scanned barcode or typed SKU; `damaged` arrived but is not stocked. */
export const ReceiptItemSchema = z.strictObject({
  variantId: z.uuid().optional(),
  barcode: z.string().trim().min(1).max(64).optional(),
  sku: z.string().trim().min(1).max(100).optional(),
  quantity: z.number().int().min(0).max(1_000_000).describe("Good units, into stock"),
  damaged: z.number().int().min(0).max(1_000_000).default(0),
}).refine((i) => Boolean(i.variantId ?? i.barcode ?? i.sku), { message: "name the item: variantId, barcode or sku" })
  .refine((i) => i.quantity + i.damaged > 0, { message: "nothing received" });

export const NewReceiptSchema = z.strictObject({
  items: z.array(ReceiptItemSchema).min(1).max(200),
  allowOver: z.boolean().default(false).describe("Take in more than ordered (owner, admin or ops manager)"),
  note: z.string().trim().max(200).optional(),
});
export type NewReceipt = z.output<typeof NewReceiptSchema>;

/** Payload of the ops app's `po.receive`: the PO (by id or number) and what was scanned off the delivery. */
export const PoReceivePayloadSchema = z.strictObject({
  purchaseOrderId: z.uuid().optional(),
  number: z.string().trim().min(1).max(40).optional(),
  items: z.array(ReceiptItemSchema).min(1).max(200),
  note: z.string().trim().max(200).optional(),
}).refine((p) => Boolean(p.purchaseOrderId ?? p.number), { message: "name the PO: purchaseOrderId or number" });
export type PoReceivePayload = z.output<typeof PoReceivePayloadSchema>;

// ───────────── Settings ─────────────

export const PurchasingSettingsSchema = z.strictObject({
  approveOver: Amount.describe("POs above this, in the store's base currency, need owner or admin to approve; foreign-currency POs always do"),
});
export type PurchasingSettings = z.infer<typeof PurchasingSettingsSchema>;
export const DEFAULT_PURCHASING: PurchasingSettings = { approveOver: "50000.00" };

export function purchasingSettings(settings: unknown): PurchasingSettings {
  const parsed = PurchasingSettingsSchema.safeParse((settings as { purchasing?: unknown } | null)?.purchasing);
  return parsed.success ? parsed.data : DEFAULT_PURCHASING;
}
