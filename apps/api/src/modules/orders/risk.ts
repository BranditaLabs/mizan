/**
 * Risk score v1 (M2, E6-1): how likely an order is not to end as a paid, delivered sale, from 0
 * (sure) to 100 (almost certainly not), with the reasons. One model with signals per payment
 * method (docs/modules/M02 "Verification by payment method"): cash orders worry about refusal at
 * the door, card and wallet orders about fraud, BNPL leaves the credit risk with the provider, a
 * bank transfer waits for its money. Pure and deterministic: the same facts give the same score.
 * Weights are starting points to tune per store on real delivery outcomes (E6-2 learns).
 */
export type RiskReason =
  | "delivered_before" | "refused_before" | "cancelled_before" | "first_order"
  | "duplicate" | "address_incomplete" | "no_city" | "phone_invalid"
  | "high_value" | "very_high_value" | "bulk_quantity"
  | "velocity" | "chargeback_before" | "bnpl" | "awaiting_transfer" | "paid";

export interface RiskFacts {
  paymentMode: string;
  /** Paid already (prepaid captured, or a deposit for partial). */
  paid: boolean;
  history: { delivered: number; refused: number; cancelled: number; chargebacks: number; last24h: number };
  duplicate: boolean;
  address: { line1Length: number; hasCity: boolean };
  phoneValid: boolean;
  /** This order's total ÷ the store's average order (same currency, last 90 days); null when no average yet. */
  valueRatio: number | null;
  totalQuantity: number;
}

export interface RiskScore { score: number; band: "low" | "medium" | "high" | "very_high"; reasons: Array<{ code: RiskReason; points: number }> }

const COLLECTS_CASH = new Set(["cod", "partial", "unknown"]);
const BANDS: Array<[number, RiskScore["band"]]> = [[25, "low"], [60, "medium"], [85, "high"]];

export function bandOf(score: number): RiskScore["band"] {
  for (const [max, band] of BANDS) if (score <= max) return band;
  return "very_high";
}

export function scoreOrder(f: RiskFacts): RiskScore {
  const parts: Array<{ code: RiskReason; points: number }> = [];
  const add = (code: RiskReason, points: number) => { if (points !== 0) parts.push({ code, points }); };
  const h = f.history;
  const known = h.delivered + h.refused + h.cancelled > 0;
  let base: number;

  if (COLLECTS_CASH.has(f.paymentMode)) {
    base = 20;
    // The customer at the door: their own track record weighs most.
    add("delivered_before", -Math.min(h.delivered * 10, 30));
    add("refused_before", Math.min(h.refused * 25, 50));
    add("cancelled_before", Math.min(h.cancelled * 5, 15));
    if (!known) add("first_order", 10);
    if (f.duplicate) add("duplicate", 15);
    if (!f.address.hasCity) add("no_city", 20);
    else if (f.address.line1Length < 8) add("address_incomplete", 10);
    if (!f.phoneValid) add("phone_invalid", 25);
    if (f.valueRatio !== null) add(f.valueRatio >= 4 ? "very_high_value" : "high_value", f.valueRatio >= 4 ? 20 : f.valueRatio >= 2.5 ? 10 : 0);
    if (f.totalQuantity >= 5) add("bulk_quantity", 10);
    if (f.paymentMode === "partial" && f.paid) add("paid", -15); // a deposit paid: the customer means it
  } else if (f.paymentMode === "bnpl") {
    base = 5;
    add("bnpl", 0);
    if (!f.address.hasCity) add("no_city", 20);
    else if (f.address.line1Length < 8) add("address_incomplete", 10);
  } else if (f.paymentMode === "bank_transfer") {
    base = 15;
    if (!f.paid) add("awaiting_transfer", 15);
    if (!f.address.hasCity) add("no_city", 20);
  } else {
    // Card, wallet, Apple Pay and other prepaid: fraud, not refusal.
    base = 10;
    add("chargeback_before", Math.min(h.chargebacks * 40, 60));
    if (h.last24h >= 3) add("velocity", 25);
    if (f.valueRatio !== null) add(f.valueRatio >= 4 ? "very_high_value" : "high_value", f.valueRatio >= 4 ? 20 : f.valueRatio >= 2.5 ? 10 : 0);
    if (f.duplicate) add("duplicate", 10);
    if (!f.phoneValid) add("phone_invalid", 10);
    add("delivered_before", -Math.min(h.delivered * 3, 9));
  }

  const score = Math.max(0, Math.min(100, base + parts.reduce((a, p) => a + p.points, 0)));
  // The three reasons that moved it most, biggest first (ties: the order above).
  const reasons = parts.map((p, i) => ({ p, i })).sort((a, b) => Math.abs(b.p.points) - Math.abs(a.p.points) || a.i - b.i).slice(0, 3).map(({ p }) => p);
  return { score, band: bandOf(score), reasons };
}
