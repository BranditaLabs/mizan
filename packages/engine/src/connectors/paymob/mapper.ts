import { toMinor } from "@mizan/shared";
import type { DriftSink } from "../../adapt/drift.js";
import { Resolver } from "../../adapt/resolve.js";
import { IntegrationError } from "../../core/errors.js";
import { paymentReference, type PaymentLinkRequest } from "../../core/payment-link.js";

export interface PaymobMapCtx { drift: DriftSink; now: () => number }

/** A created intention, as Mizan keeps it (the client secret is a credential for this one payment). */
export interface PaymobIntention { intentionId: string; gatewayOrderId: string | null; clientSecret: string; reference: string }

/**
 * Mizan's link → the body of `POST /v1/intention/` (docs/06 §7 "Paymob in depth"). Amounts in the
 * currency's minor units (×100 for EGP, ×1000 for OMR and KWD), never a hard-coded ×100. One item,
 * the order's number, for the whole amount: no product data leaves Mizan and the items always add
 * up. Billing data is the phone and a name only (rule 12); "NA" where Paymob wants a value and
 * Mizan has none (confirm per region). Extras carry Mizan's ids only.
 */
export function intentionBody(req: PaymentLinkRequest, attempt: number, integrations: Record<string, number>) {
  const amount = toMinor(req.amount);
  if (amount <= 0n) throw new IntegrationError({ kind: "validation", connector: "paymob", message: "a payment link needs an amount above zero" });
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new IntegrationError({ kind: "validation", connector: "paymob", message: "amount too large" });
  const ids = req.methods.map((m) => integrations[m]);
  if (!ids.length || ids.some((x) => x === undefined)) {
    const missing = req.methods.filter((m) => integrations[m] === undefined);
    throw new IntegrationError({ kind: "validation", connector: "paymob", message: `no Paymob integration for ${missing.join(", ") || "any method"} on this connection` });
  }
  const minor = Number(amount);
  return {
    amount: minor,
    currency: req.amount.currency.toUpperCase(),
    payment_methods: ids as number[],
    items: [{ name: `Order ${req.orderNumber}`.slice(0, 50), amount: minor, quantity: 1 }],
    billing_data: {
      phone_number: req.customer.phone,
      first_name: req.customer.firstName?.trim() || "NA",
      last_name: req.customer.lastName?.trim() || "NA",
      email: "NA",
    },
    special_reference: paymentReference(req.orderId, req.purpose, attempt),
    ...(req.notificationUrl ? { notification_url: req.notificationUrl } : {}),
    ...(req.redirectionUrl ? { redirection_url: req.redirectionUrl } : {}),
    extras: { mizan_link: req.linkId, mizan_order: req.orderId, purpose: req.purpose },
  };
}

/** The create answer → Mizan's ids. The Paymob order id is `intention_order_id`, or the first payment key's. */
export function mapIntention(raw: unknown, ctx: PaymobMapCtx): PaymobIntention {
  const r = new Resolver(raw, { connector: "paymob", entity: "intention", drift: ctx.drift, now: ctx.now });
  return {
    intentionId: r.str("id", ["id", "intention_id"], { required: true })!,
    gatewayOrderId: r.str("orderId", ["intention_order_id", "payment_keys.0.order_id", "order_id"]) ?? null,
    clientSecret: r.str("clientSecret", ["client_secret", "clientSecret"], { required: true })!,
    reference: r.str("reference", ["special_reference", "merchant_order_id"]) ?? "",
  };
}
