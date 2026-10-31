/**
 * Refunds (M15, E14-4): where money can go back and when a person must approve, free of the
 * database. docs/12 §5.3 and docs/modules/M06 "Refunds and exchanges by payment method".
 */
export const REFUND_DESTINATIONS = ["original_method", "store_credit", "bank_transfer", "cash"] as const;
export type RefundDestination = (typeof REFUND_DESTINATIONS)[number];
export const REFUND_STATUSES = ["requested", "approved", "completed", "rejected", "failed"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];
/** Money that came in online can go back the same way (card, wallet, Apple Pay, BNPL). */
export const ONLINE_METHODS: ReadonlySet<string> = new Set(["card", "wallet", "apple_pay", "bnpl"]);
/** Who approves refunds over the threshold, and completes them. */
export const APPROVERS: ReadonlySet<string> = new Set(["owner", "admin", "finance"]);

/**
 * Where this order's money can go back: the original method only if it came in online; store
 * credit only to a known customer; a bank transfer or cash always (a COD order that was delivered
 * is refunded this way).
 */
export function destinationsFor(o: { methods: readonly string[]; hasCustomer: boolean }): RefundDestination[] {
  return REFUND_DESTINATIONS.filter((d) => (d === "original_method" ? o.methods.some((m) => ONLINE_METHODS.has(m)) : d === "store_credit" ? o.hasCustomer : true));
}

/**
 * Whether a person must approve: over the store's threshold, or in a currency the threshold is not
 * in (no conversion is guessed).
 */
export function needsApproval(r: { amountMinor: bigint; currency: string }, s: { approveOverMinor: bigint; baseCurrency: string }): boolean {
  return r.currency !== s.baseCurrency || r.amountMinor > s.approveOverMinor;
}

/** The ledger method a completed refund is booked under. */
export function ledgerMethodFor(destination: RefundDestination, methods: readonly string[]): string {
  switch (destination) {
    case "original_method": return methods.find((m) => ONLINE_METHODS.has(m)) ?? "card";
    case "store_credit": return "store_credit";
    case "bank_transfer": return "bank_transfer";
    case "cash": return "cash_pos";
  }
}
