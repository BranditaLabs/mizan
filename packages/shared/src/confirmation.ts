/**
 * Confirmation facts shared by the API and the dashboard (M2, E6-16a): the buyer's cancel codes
 * every store's own reasons map onto, the Arabic currency names the chat prints, and the buyer's
 * language read from a checkout or store locale.
 */

/** The canonical codes behind a buyer's cancel (analytics, events, filters). A store's reasons map onto these. */
export const BUYER_CANCEL_REASONS = ["changed_mind", "ordered_by_mistake", "found_cheaper", "delivery_too_late", "other"] as const;
export type BuyerCancelReason = (typeof BUYER_CANCEL_REASONS)[number];

/** WhatsApp allows 10 list rows; the fixed "keep my order" row takes one. */
export const MAX_BUYER_REASONS = 9;

/**
 * How Arabic text writes each currency. Not the new Saudi riyal sign (U+20C1): many WhatsApp
 * clients cannot show it yet.
 */
export const CURRENCY_AR: Readonly<Record<string, string>> = {
  EGP: "ج.م.", SAR: "ر.س", AED: "د.إ", KWD: "د.ك", QAR: "ر.ق", BHD: "د.ب", OMR: "ر.ع",
};

/** By prefix: "ar-EG", "ar" → ar; "en-US" → en; anything else (or nothing) → null. */
export function buyerLang(raw?: string | null): "ar" | "en" | null {
  const t = raw?.trim().toLowerCase() ?? "";
  if (t.startsWith("ar")) return "ar";
  if (t.startsWith("en")) return "en";
  return null;
}
