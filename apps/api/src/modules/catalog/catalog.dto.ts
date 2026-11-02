import { MoneySchema } from "@mizan/shared";
import { z } from "zod";

export const VariantCostQuerySchema = z.object({
  /** Only variants whose cost was never entered. */
  missingCost: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** nextCursor from the previous page. */
  cursor: z.string().max(200).optional(),
});

export const VariantCostSchema = z.object({
  variantId: z.uuid(),
  productTitle: z.string(),
  variantTitle: z.string().nullable(),
  sku: z.string(),
  price: MoneySchema,
  /** null until the merchant enters it (a cost of 0 is a real cost). */
  cost: MoneySchema.nullable().describe("null until entered; 0 is a real cost"),
});
export type VariantCost = z.infer<typeof VariantCostSchema>;

export const VariantCostPageSchema = z.object({
  data: z.array(VariantCostSchema),
  nextCursor: z.string().nullable(),
  counts: z.object({ variants: z.number().int(), missingCost: z.number().int() }),
});

const Decimal = z.string().regex(/^\d{1,12}(\.\d{1,3})?$/, "a decimal amount like 250 or 250.50");

export const SetCostsSchema = z.strictObject({
  items: z.array(z.strictObject({ variantId: z.uuid(), cost: Decimal })).min(1).max(500),
});
export type SetCostsBody = z.infer<typeof SetCostsSchema>;

export const CostsUpdatedSchema = z.object({ updated: z.number().int(), missingCost: z.number().int() });

// ── E8-1 products screen ──

export const ProductQuerySchema = z.object({
  /** Product title, SKU or barcode (part of it). */
  search: z.string().trim().max(100).optional(),
  status: z.enum(["active", "draft", "archived", "all"]).default("all").describe("all = active and draft (archived only when asked)"),
  missing: z.enum(["cost", "barcode"]).optional().describe("Only products with a variant missing its cost or barcode"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(400).optional(),
});

export const CatalogVariantSchema = z.object({
  id: z.uuid(),
  title: z.string().nullable(),
  sku: z.string(),
  barcode: z.string().nullable(),
  barcodeOwner: z.enum(["store", "mizan"]).describe("store: follows the store's barcode on every sync; mizan: set here, syncs leave it alone"),
  price: MoneySchema,
  compareAt: MoneySchema.nullable(),
  cost: MoneySchema.nullable().describe("null until entered; 0 is a real cost"),
  available: z.number().int().nullable().describe("Stock as the store last reported it; null = not known"),
});

export const CatalogProductSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  status: z.enum(["active", "draft", "archived"]),
  store: z.object({ connectionId: z.uuid(), provider: z.string(), name: z.string() }).nullable().describe("The store it syncs from; null = added in Mizan"),
  variants: z.array(CatalogVariantSchema),
});

export const ProductPageSchema = z.object({
  data: z.array(CatalogProductSchema),
  nextCursor: z.string().nullable(),
  counts: z.object({ products: z.number().int(), variants: z.number().int(), missingCost: z.number().int(), missingBarcode: z.number().int() }),
});

export const UpdateVariantSchema = z.strictObject({
  cost: Decimal.optional().describe("In the variant's currency"),
  barcode: z.string().trim().regex(/^[\x21-\x7E]{1,64}$/, "letters, digits and symbols, no spaces, up to 64").nullable().optional()
    .describe("Set here (Mizan owns it from then); null gives it back to the store's barcode"),
}).refine((b) => b.cost !== undefined || b.barcode !== undefined, { message: "nothing to change" });

export const ImportCostsSchema = z.strictObject({
  csv: z.string().min(1).max(2_000_000).describe("The file's text: a header row with SKU and cost and/or barcode; other columns are ignored"),
});

export const CostsImportedSchema = z.object({
  costs: z.number().int().describe("Variants whose cost was set"),
  barcodes: z.number().int().describe("Variants whose barcode was set"),
  skipped: z.number().int().describe("Rows with neither a cost nor a barcode"),
  missingCost: z.number().int(),
});
