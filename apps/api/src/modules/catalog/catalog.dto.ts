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
  options: z.array(z.object({ name: z.string(), value: z.string() })).describe("Its value for each of the product's options (P1)"),
  imageId: z.uuid().nullable().describe("The product picture shown for this variant"),
});

export const ProductImageSchema = z.object({
  id: z.uuid(),
  url: z.url().describe("The store's CDN address, or Mizan's for a picture uploaded here (P3)"),
  thumbUrl: z.url().nullable().describe("A 400 px copy, for pictures uploaded to Mizan (P3)"),
  alt: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  isMain: z.boolean(),
});
export const ProductOptionSchema = z.object({ name: z.string(), values: z.array(z.string()) });
const ProductStoreSchema = z.object({ connectionId: z.uuid(), provider: z.string(), name: z.string() });

export const CatalogProductSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  status: z.enum(["active", "draft", "archived"]),
  store: ProductStoreSchema.nullable().describe("The store it syncs from; null = added in Mizan"),
  mainImage: ProductImageSchema.nullable().describe("The product's main picture (P1); null = none"),
  imageCount: z.number().int(),
  vendor: z.string().nullable(),
  productType: z.string().nullable(),
  tags: z.array(z.string()),
  options: z.array(ProductOptionSchema),
  variants: z.array(CatalogVariantSchema),
});

export const ProductDetailSchema = CatalogProductSchema.omit({ mainImage: true, imageCount: true }).extend({
  handle: z.string().nullable(),
  description: z.string().describe("The store's description as plain text (paragraphs on new lines); never HTML"),
  images: z.array(ProductImageSchema).describe("In the store's order; one isMain"),
  storeUrl: z.url().nullable().describe("Where to edit it in the store's admin"),
  publish: z.object({
    status: z.enum(["publishing", "published", "failed"]),
    connectionId: z.uuid().nullable(),
    error: z.string().nullable().describe("The store's words when it refused the product"),
  }).nullable().describe("A product made in Mizan, on its way to a store (P3); null for a store's product or one never published"),
  updatedAt: z.iso.datetime(),
  totals: z.object({
    variants: z.number().int(),
    available: z.number().int().nullable().describe("Sum of known stock; null when no variant's stock is known"),
    priceMin: MoneySchema.nullable(),
    priceMax: MoneySchema.nullable(),
    missingCost: z.number().int(),
    missingBarcode: z.number().int(),
  }),
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

// ───────────── P2: edit a product, pushed to its store ─────────────

/** Up to 3 decimals (KWD, BHD, OMR); the currency's own decimals are checked when saving. */
const PriceAmount = z.string().trim().regex(/^\d{1,9}(\.\d{1,3})?$/, "an amount like 150 or 150.50");
export const ProductUpdateSchema = z.strictObject({
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().max(20000).optional().describe("Plain text: paragraphs by blank lines (the store's formatting is replaced)"),
  status: z.enum(["active", "draft", "archived"]).optional(),
  tags: z.array(z.string().trim().min(1).max(255)).max(50).optional(),
  vendor: z.string().trim().max(255).optional().describe("Shopify only"),
  productType: z.string().trim().max(255).optional().describe("Shopify only"),
  images: z.strictObject({
    order: z.array(z.uuid()).min(1).max(250).describe("Every picture of the product, in the new order"),
    main: z.uuid().optional().describe("The main picture (moved first); else the first of the order"),
  }).optional(),
  variants: z.array(z.strictObject({
    id: z.uuid(),
    price: PriceAmount.optional(),
    compareAtPrice: PriceAmount.nullable().optional().describe("Higher than the price: shown struck through; null removes it"),
  })).max(250).optional(),
}).refine((b) => Object.values(b).some((v) => v !== undefined), { message: "change something" });

// ───────────── P3: products made in Mizan ─────────────

const Name = z.string().trim().min(1).max(60);
const Sku = z.string().trim().regex(/^[\x21-\x7E]{1,64}$/, "letters, digits and symbols, no spaces, up to 64");
export const NewProductSchema = z.strictObject({
  title: z.string().trim().min(1).max(255),
  description: z.string().max(20000).optional().describe("Plain text: paragraphs by blank lines"),
  status: z.enum(["active", "draft", "archived"]).default("draft"),
  vendor: z.string().trim().max(255).optional(),
  productType: z.string().trim().max(255).optional(),
  tags: z.array(z.string().trim().min(1).max(255)).max(50).default([]),
  options: z.array(z.strictObject({ name: Name, values: z.array(Name).min(1).max(100) })).max(3).default([])
    .describe("Up to three options (Size, Color…) and their values, in order"),
  variants: z.array(z.strictObject({
    options: z.array(z.strictObject({ name: Name, value: Name })).max(3).default([]).describe("One value of each option; none without options"),
    sku: Sku,
    price: PriceAmount,
    compareAtPrice: PriceAmount.optional(),
    barcode: z.string().trim().regex(/^[\x21-\x7E]{1,64}$/).optional(),
    cost: PriceAmount.optional().describe("What one piece costs (profit)"),
  })).min(1).max(100).describe("A product without options has exactly one"),
});
export const ProductCreatedSchema = z.object({ id: z.uuid() });
export const PublishProductSchema = z.strictObject({ connectionId: z.uuid().describe("A connected Shopify or WooCommerce store") });
export const PublishStartedSchema = z.object({ status: z.literal("publishing") });

