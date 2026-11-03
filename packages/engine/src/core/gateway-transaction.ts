/**
 * A gateway payment as the platform's ledger takes it (E14-2b). The engine re-reads the
 * transaction (never trusting a callback body) and turns what changed since it last saw it into
 * lines: a sale or an authorization once, then each increase of what was captured or refunded, a
 * void once. Amounts are positive minor units; the ledger applies each kind's sign. Each line's
 * `externalRef` is unique for that change, so a repeat posts nothing.
 */
export type GatewayState = "pending" | "failed" | "succeeded" | "authorized" | "voided" | "unknown";

export interface GatewayLine {
  kind: "sale" | "authorization" | "capture" | "void" | "refund";
  amountMinor: bigint;
  externalRef: string;
  occurredAt: string;
}

export interface GatewayTransactionUpdate {
  gateway: "paymob";
  transactionId: string;
  /** The reference Mizan sent with the payment (`<order>:<purpose>:<attempt>`), when the gateway echoes it. */
  reference: string | null;
  state: GatewayState;
  /** card, wallet, kiosk, bnpl, apple_pay… (`other` when the gateway names something new). */
  method: string;
  currency: string;
  amountMinor: bigint;
  lines: GatewayLine[];
  /** A combination of flags Mizan does not know: nothing is guessed; a person looks. */
  needsReview: boolean;
  /** A cash payment's reference to show the customer (kiosk), when the gateway gives one. */
  kioskReference?: string | undefined;
}
