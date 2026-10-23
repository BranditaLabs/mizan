import { z } from "zod";

const Pct = z.string().regex(/^\d{1,2}(\.\d{1,2})?$/, "a percentage like 10 or 12.5").refine((v) => Number(v) <= 50, "at most 50%");

/**
 * A store's offer settings (E6-11), kept in tenants.settings.offers. Off until the owner turns it
 * on. Mode: the owner's rules, then recommendations (default); rules only; recommendations only.
 */
export const OfferSettingsSchema = z.object({
  enabled: z.boolean().describe("Offer one more item when a customer confirms"),
  mode: z.enum(["rules_then_auto", "rules", "auto"]).describe("rules_then_auto: the owner's rules first, else what is bought together"),
  maxDiscountPct: Pct.describe("No offer is ever discounted more than this"),
  autoDiscountPct: Pct.describe("Discount on recommended offers (rules carry their own)"),
  inWhatsApp: z.boolean().describe("Offer in the WhatsApp chat right after the customer confirms"),
  inCalls: z.boolean().describe("Show the offer in the team's call script"),
  ai: z.boolean().describe("Let Claude choose among Mizan's candidates and write the message (no customer data is sent)"),
}).refine((s) => Number(s.autoDiscountPct) <= Number(s.maxDiscountPct), { message: "the recommended discount cannot exceed the maximum", path: ["autoDiscountPct"] });
export type OfferSettings = z.infer<typeof OfferSettingsSchema>;

export const DEFAULT_OFFERS: OfferSettings = { enabled: false, mode: "rules_then_auto", maxDiscountPct: "15", autoDiscountPct: "10", inWhatsApp: true, inCalls: true, ai: false };

/** Stored settings over the defaults; a broken stored value never breaks confirmation (defaults win). */
export function offerSettings(settings: unknown): OfferSettings {
  const stored = (settings as { offers?: unknown } | null)?.offers;
  const parsed = OfferSettingsSchema.safeParse({ ...DEFAULT_OFFERS, ...(stored && typeof stored === "object" ? stored : {}) });
  return parsed.success ? parsed.data : DEFAULT_OFFERS;
}
