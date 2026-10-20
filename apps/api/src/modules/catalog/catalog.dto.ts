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
