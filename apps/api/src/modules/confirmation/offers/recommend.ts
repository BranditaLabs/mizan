import { fromMinor, percentOf, toMinor } from "@mizan/shared";

/**
 * Which offer to make at confirmation (E6-11), as a pure function: no database, no clock, no
 * floats. The owner's rules first; without one that fits, what customers of this store buy
 * together. Never something already in the order, sold out, archived, more than 60% of the order
 * (an upsell, not a second order), or sold at a loss after the discount when its cost is known.
 */
export type OfferMode = "rules_then_auto" | "rules" | "auto";

export interface Candidate {
  variantId: string;
  title: string;
  /** Price in the order's currency (minor units). */
  priceMinor: bigint;
  /** Unit cost when known (minor units, same currency), else null. */
  costMinor: bigint | null;
  /** Stock as the store reported it; null = unknown (offered). */
  available: number | null;
  active: boolean;
}

export interface Rule {
  id: string;
  triggerVariantId: string | null;
  offerVariantId: string;
  discountPct: string;
  priority: number;
  messageAr: string | null;
  messageEn: string | null;
}

export interface RecommendInput {
  mode: OfferMode;
  /** The store's cap on any discount ("15"). */
  maxDiscountPct: string;
  /** Discount on recommended (not rule) offers ("10"). */
  autoDiscountPct: string;
  currency: string;
  orderTotalMinor: bigint;
  /** Variants in the order (linked lines only). */
  orderVariantIds: string[];
  rules: Rule[];
  /** Everything that could be offered, by variant id. */
  candidates: Map<string, Candidate>;
  /** How often a candidate was bought with any of the order's items (recent orders). */
  boughtWith: Map<string, number>;
  /** How many recent orders each candidate was in (popularity, the tie-break and fallback). */
  popularity: Map<string, number>;
}

export interface Offer {
  variantId: string;
  title: string;
  qty: 1;
  unitPriceMinor: bigint;
  discountPct: string;
  offerPriceMinor: bigint;
  source: "rule" | "auto";
  ruleId: string | null;
  messageAr: string | null;
  messageEn: string | null;
}

/** Share of the order total an offer may cost at most. */
export const MAX_SHARE_PCT = "60";

const minPct = (a: string, b: string) => (Number(a) <= Number(b) ? a : b);

/** The price for one after the discount, rounded half-even like every money amount. */
export function discounted(priceMinor: bigint, pct: string, currency: string): bigint {
  if (Number(pct) === 0) return priceMinor;
  return priceMinor - toMinor(percentOf(fromMinor(priceMinor, currency), pct));
}

/** Whether an item may be offered on this order at this discount (the guards above). */
export function isOfferable(i: Pick<RecommendInput, "orderVariantIds" | "orderTotalMinor" | "currency">, c: Candidate | undefined, pct: string): c is Candidate {
  if (!c || !c.active || i.orderVariantIds.includes(c.variantId)) return false;
  if (c.available !== null && c.available <= 0) return false;
  if (c.priceMinor <= 0n) return false;
  const price = discounted(c.priceMinor, pct, i.currency);
  if (price > toMinor(percentOf(fromMinor(i.orderTotalMinor, i.currency), MAX_SHARE_PCT))) return false;
  return c.costMinor === null || price > c.costMinor; // never at a loss
}

export interface Ranked { candidate: Candidate; together: number; popular: number }

/**
 * Items customers want with this order, best first: bought with these items, then popular in the
 * store, then what the store earns on it. Only offerable items at the suggestion discount.
 */
export function shortlist(i: RecommendInput, n = 5): Ranked[] {
  const pct = minPct(i.autoDiscountPct, i.maxDiscountPct);
  const out: Array<Ranked & { key: [number, number, bigint] }> = [];
  for (const c of i.candidates.values()) {
    if (!isOfferable(i, c, pct)) continue;
    const together = i.boughtWith.get(c.variantId) ?? 0;
    const popular = i.popularity.get(c.variantId) ?? 0;
    if (together === 0 && popular === 0) continue; // nothing says customers want it
    const price = discounted(c.priceMinor, pct, i.currency);
    out.push({ candidate: c, together, popular, key: [together, popular, c.costMinor === null ? price : price - c.costMinor] });
  }
  out.sort((a, b) => (same(a.key, b.key) ? a.candidate.variantId.localeCompare(b.candidate.variantId) : better(a.key, b.key) ? -1 : 1));
  return out.slice(0, n).map(({ candidate, together, popular }) => ({ candidate, together, popular }));
}

export function recommend(i: RecommendInput): Offer | null {
  const inOrder = new Set(i.orderVariantIds);
  const make = (c: Candidate, pct: string, source: Offer["source"], rule: Rule | null): Offer => ({
    variantId: c.variantId, title: c.title, qty: 1, unitPriceMinor: c.priceMinor, discountPct: pct,
    offerPriceMinor: discounted(c.priceMinor, pct, i.currency), source, ruleId: rule?.id ?? null,
    messageAr: rule?.messageAr ?? null, messageEn: rule?.messageEn ?? null,
  });

  if (i.mode !== "auto") {
    const fitting = i.rules
      .filter((r) => r.triggerVariantId === null || inOrder.has(r.triggerVariantId))
      // A rule for this order's items beats a rule for any order; then the owner's priority.
      .sort((a, b) => Number(b.triggerVariantId !== null) - Number(a.triggerVariantId !== null) || b.priority - a.priority || a.id.localeCompare(b.id));
    for (const r of fitting) {
      const pct = minPct(r.discountPct, i.maxDiscountPct);
      const c = i.candidates.get(r.offerVariantId);
      if (isOfferable(i, c, pct)) return make(c, pct, "rule", r);
    }
    if (i.mode === "rules") return null;
  }

  const best = shortlist(i, 1)[0];
  return best ? make(best.candidate, minPct(i.autoDiscountPct, i.maxDiscountPct), "auto", null) : null;
}

const better = (a: [number, number, bigint], b: [number, number, bigint]) => a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
const same = (a: [number, number, bigint], b: [number, number, bigint]) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
