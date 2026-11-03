/**
 * A gateway payment as the platform's ledger takes it (E14-2b). The engine re-reads the
 * transaction (never trusting a callback body) and hands over two things:
 * - `lines` that happen once per transaction (a sale, an authorization, a void), each with a
 *   reference that never changes, so handing them over again posts nothing;
 * - `totals`: what the gateway says was captured and refunded so far. Partial captures and
 *   refunds are posted by `gatewayDeltaLines`, as the difference from what the ledger already
 *   holds for this transaction, inside the platform's transaction with that payment's rows locked.
 *   The ledger is the record: a snapshot kept beside it could go stale between a retry or two
 *   workers and post the same refund twice.
 * Amounts are positive minor units; the ledger applies each kind's sign.
 */
export type GatewayState = "pending" | "failed" | "succeeded" | "authorized" | "voided" | "unknown";

export interface GatewayLine {
  kind: "sale" | "authorization" | "capture" | "void" | "refund";
  amountMinor: bigint;
  externalRef: string;
  occurredAt: string;
}

export interface GatewayTotals {
  /** Captured so far: authorizations only (a sale's own `captured_amount` is the sale, never a second line). */
  capturedMinor: bigint;
  refundedMinor: bigint;
  /**
   * When each change was made: the capture or refund child's time when one came with this update,
   * else when Mizan saw it. Several refunds found at once are one line on the later date.
   */
  capturedAt: string;
  refundedAt: string;
}

export interface GatewayTransactionUpdate {
  gateway: "paymob";
  /** The payment itself (the root of a refund, void or capture). */
  transactionId: string;
  /** The reference Mizan sent with the payment (`<order>:<purpose>:<attempt>`), when the gateway echoes it. */
  reference: string | null;
  state: GatewayState;
  /** card, wallet, kiosk, bnpl, apple_pay… (`other` when the gateway names something new). */
  method: string;
  currency: string;
  amountMinor: bigint;
  /** Once-only lines: sale, authorization, void. */
  lines: GatewayLine[];
  totals: GatewayTotals;
  /** A combination Mizan does not know: nothing is guessed, nothing is posted; a person looks. */
  needsReview: boolean;
  /** A cash payment's reference to show the customer (kiosk), when the gateway gives one. */
  kioskReference?: string | undefined;
}

/**
 * The capture and refund lines still to post: the totals less what the ledger already holds for
 * this transaction (by kind). Call it with those rows locked, in the transaction that posts the
 * lines. Each reference names the total it brings the ledger to, so a repeat after a crash posts
 * nothing.
 */
export function gatewayDeltaLines(update: GatewayTransactionUpdate, held: { capturedMinor: bigint; refundedMinor: bigint }): GatewayLine[] {
  if (update.needsReview) return [];
  const out: GatewayLine[] = [];
  // Money moves back or in only on a payment that happened.
  if (update.state !== "succeeded" && update.state !== "authorized" && update.state !== "voided") return [];
  const { capturedMinor, refundedMinor, capturedAt, refundedAt } = update.totals;
  if (capturedMinor > held.capturedMinor) out.push({ kind: "capture", amountMinor: capturedMinor - held.capturedMinor, externalRef: `${update.transactionId}:capture:${capturedMinor}`, occurredAt: capturedAt });
  if (refundedMinor > held.refundedMinor) out.push({ kind: "refund", amountMinor: refundedMinor - held.refundedMinor, externalRef: `${update.transactionId}:refund:${refundedMinor}`, occurredAt: refundedAt });
  return out;
}
