import { MoneySchema } from "@mizan/shared";
import { z } from "zod";
import { OfferSettingsSchema } from "./offer.settings.js";

const Pct = z.string().regex(/^\d{1,2}(\.\d{1,2})?$/, "a percentage like 10 or 12.5").refine((v) => Number(v) <= 50, "at most 50%");

export { OfferSettingsSchema };

/** An order's offer as screens show it. */
export const OfferViewSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  qty: z.number().int(),
  unitPrice: MoneySchema.describe("Before the discount"),
  offerPrice: MoneySchema.describe("For one, after the discount: what the customer was shown"),
  discountPct: z.string(),
  source: z.enum(["rule", "auto", "ai"]),
  status: z.enum(["proposed", "accepted", "declined", "expired", "applying", "applied", "failed"]),
  messageAr: z.string().nullable(),
  messageEn: z.string().nullable(),
  failure: z.enum(["not_in_store", "unavailable", "permission", "failed"]).nullable()
    .describe("Why it was not added to the store's order: not_in_store (manual order or unlinked product), unavailable (sold out, removed, order cancelled), permission (reconnect the store), failed"),
});

export const OfferDecisionSchema = z.strictObject({ decision: z.enum(["accept", "decline"]).describe("The customer's answer on the call") });
export const OfferDecidedSchema = z.object({ status: z.enum(["accepted", "declined", "expired"]) });

export const OfferRuleCreateSchema = z.strictObject({
  triggerVariantId: z.uuid().nullable().describe("When the order has this product; null = any order"),
  offerVariantId: z.uuid().describe("The product to offer"),
  discountPct: Pct.default("0"),
  priority: z.number().int().min(-100).max(100).default(0),
  messageAr: z.string().trim().min(1).max(300).optional().describe("Your wording (else Mizan writes it)"),
  messageEn: z.string().trim().min(1).max(300).optional(),
});
export const OfferRuleUpdateSchema = z.strictObject({ active: z.boolean() });
export const IdSchema = z.object({ id: z.uuid() });

export const OfferRuleListSchema = z.object({
  data: z.array(z.object({
    id: z.uuid(),
    trigger: z.object({ variantId: z.uuid(), title: z.string() }).nullable(),
    offer: z.object({ variantId: z.uuid(), title: z.string(), price: MoneySchema }),
    discountPct: z.string(),
    priority: z.number().int(),
    messageAr: z.string().nullable(),
    messageEn: z.string().nullable(),
    active: z.boolean(),
    createdAt: z.iso.datetime(),
  })),
});

export const OfferProductsQuerySchema = z.object({ q: z.string().trim().min(1).max(64).optional().describe("Product title or SKU") });
export const OfferProductsSchema = z.object({
  data: z.array(z.object({ variantId: z.uuid(), sku: z.string(), title: z.string(), price: MoneySchema, available: z.number().int().nullable() })),
});

export const OfferSummaryQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
export const OfferSummarySchema = z.object({
  days: z.number().int(),
  offered: z.number().int(),
  accepted: z.number().int(),
  declined: z.number().int(),
  added: z.array(MoneySchema).describe("What accepted offers added, per currency"),
});
