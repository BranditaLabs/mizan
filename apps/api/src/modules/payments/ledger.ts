/**
 * The payment ledger's arithmetic (M15, E14-1; docs/12 §3), free of the database so it can be
 * property-tested. An order's money is the sum of its succeeded lines, signed: money in is
 * positive, money out negative, an authorization holds money without moving it.
 *
 *   paid        = Σ sale + capture + cod_collection + void   (a void takes back money received)
 *   refunded    = −Σ refund
 *   chargedBack = −Σ (chargeback + chargeback_reversal)
 *   net         = paid − refunded − chargedBack = Σ every succeeded line except authorizations
 *   balance     = max(total − paid, 0)                       (what the customer still owes)
 */
export const LEDGER_KINDS = ["authorization", "capture", "sale", "cod_collection", "refund", "chargeback", "chargeback_reversal", "void"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];
export const LEDGER_STATUSES = ["pending", "succeeded", "failed", "cancelled"] as const;
export type LedgerStatus = (typeof LEDGER_STATUSES)[number];
export const LEDGER_SOURCES = ["store", "gateway", "courier", "manual"] as const;
export type LedgerSource = (typeof LEDGER_SOURCES)[number];

const PAID = new Set<LedgerKind>(["sale", "capture", "cod_collection", "void"]);
/** Kinds whose amount is positive; every other kind is negative. */
export const POSITIVE = new Set<LedgerKind>(["authorization", "capture", "sale", "cod_collection", "chargeback_reversal"]);

export interface LedgerLine { kind: LedgerKind; status: LedgerStatus; amountMinor: bigint; source?: LedgerSource }
export interface LedgerTotals {
  paid: bigint;
  refunded: bigint;
  chargedBack: bigint;
  /** Authorized and not yet captured. */
  authorized: bigint;
  /** What the merchant holds: paid − refunded − chargedBack. */
  net: bigint;
}

export const ZERO: LedgerTotals = { paid: 0n, refunded: 0n, chargedBack: 0n, authorized: 0n, net: 0n };

/** Adds one line to running totals. Only succeeded lines count. */
export function add(t: LedgerTotals, line: LedgerLine): LedgerTotals {
  if (line.status !== "succeeded") return t;
  const a = line.amountMinor;
  const next = { ...t };
  if (PAID.has(line.kind)) next.paid += a;
  if (line.kind === "refund") next.refunded -= a;
  if (line.kind === "chargeback" || line.kind === "chargeback_reversal") next.chargedBack -= a;
  if (line.kind === "authorization") next.authorized += a;
  if (line.kind === "capture") next.authorized = next.authorized > a ? next.authorized - a : 0n;
  if (line.kind !== "authorization") next.net += a;
  return next;
}

export const totals = (lines: readonly LedgerLine[]): LedgerTotals => lines.reduce(add, ZERO);

export type Rejection = "zero_amount" | "wrong_sign" | "over_payment" | "over_refund" | "over_void" | "over_chargeback" | "over_reversal";

/**
 * Whether a new succeeded line keeps the ledger sound for an order of `total`: no line for zero,
 * the sign its kind needs, never more received than the order is worth, never more given back
 * than is held. Lines from the store's own totals skip this (the store is the record there).
 */
export function check(t: LedgerTotals, total: bigint, line: Pick<LedgerLine, "kind" | "amountMinor">): Rejection | null {
  const a = line.amountMinor;
  if (a === 0n) return "zero_amount";
  if (POSITIVE.has(line.kind) !== a > 0n) return "wrong_sign";
  switch (line.kind) {
    case "sale":
    case "cod_collection":
    case "capture": return t.paid + a > total ? "over_payment" : null;
    case "authorization": return t.paid + t.authorized + a > total ? "over_payment" : null;
    case "refund": return -a > t.net ? "over_refund" : null;
    case "void": return -a > t.net ? "over_void" : null;
    case "chargeback": return -a > t.net ? "over_chargeback" : null;
    case "chargeback_reversal": return a > t.chargedBack ? "over_reversal" : null;
  }
}

export type PaymentStatus = "unpaid" | "authorized" | "partially_paid" | "paid" | "partially_refunded" | "refunded" | "disputed" | "failed" | "voided";

/**
 * The order's payment status from its ledger. `previous` is kept when the ledger says nothing
 * (failed or voided with no money held stays so; otherwise unpaid).
 */
export function statusOf(t: LedgerTotals, total: bigint, previous: string): PaymentStatus {
  if (t.chargedBack > 0n) return "disputed";
  if (t.refunded > 0n) return t.refunded >= t.paid ? "refunded" : "partially_refunded";
  if (t.paid > 0n) return t.paid >= total ? "paid" : "partially_paid";
  if (t.authorized > 0n) return "authorized";
  return previous === "failed" || previous === "voided" ? previous : "unpaid";
}
