import type { Money } from "@mizan/shared";

/** What a payment link is for (E14-2): the whole order, a deposit now, or the balance left. */
export type PaymentPurpose = "full" | "deposit" | "balance";

/**
 * A payment link to make on a gateway (E14-2), handed to the engine when its job runs
 * (`loadPaymentLink`): the customer's phone is personal data and never goes into a job.
 */
export interface PaymentLinkRequest {
  /** Mizan's link id (one job per link). */
  linkId: string;
  /** Mizan's order id and the number shown to the customer. */
  orderId: string;
  orderNumber: string;
  purpose: PaymentPurpose;
  /** What this link asks for, in the order's currency. */
  amount: Money;
  /** The gateway methods to offer, by Mizan's name for them ("card", "wallet", "kiosk", "valu"…). */
  methods: string[];
  customer: { phone: string; firstName?: string | undefined; lastName?: string | undefined };
  /** Where the gateway POSTs the transaction (the platform's per-connection webhook URL). */
  notificationUrl?: string | undefined;
  /** Where the customer lands after paying (card and wallet only). */
  redirectionUrl?: string | undefined;
}

/** A link the customer can pay, or why there is none (final: the team sends another way). */
export type PaymentLinkOutcome =
  | {
    ok: true;
    /** The hosted checkout page: card data never reaches Mizan. Holds a secret for this payment: keep it encrypted, never log it. */
    url: string;
    /** The gateway's own ids, to match its callbacks and re-read the payment. */
    intentionId: string;
    gatewayOrderId: string | null;
    /** The reference sent with it (`<order>:<purpose>:<attempt>`), echoed back as the merchant order id. */
    reference: string;
  }
  | { ok: false; reason: "validation" | "permission" | "failed"; message: string };

/** `<order>:<purpose>:<attempt>`: each attempt its own, so a retried create is never mistaken for an earlier one. */
export const paymentReference = (orderId: string, purpose: PaymentPurpose, attempt: number) => `${orderId}:${purpose}:${attempt}`;
