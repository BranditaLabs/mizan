import { toMinor } from "@mizan/shared";
import type { DriftSink } from "../../adapt/drift.js";
import { Resolver, SchemaDriftError } from "../../adapt/resolve.js";
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

/** A transaction as re-read (E14-2b): the flags that decide its state, and the cumulative amounts. */
export interface PaymobTransaction {
  id: string;
  parentId: string | null;
  /** Paymob says it has a parent (a refund, void or capture child), whether or not its id could be read. */
  hasParent: boolean;
  isCapture: boolean;
  isRefunded: boolean;
  reference: string | null;
  currency: string;
  amountMinor: bigint;
  success: boolean;
  pending: boolean;
  errorOccurred: boolean;
  isAuth: boolean;
  voided: boolean;
  capturedMinor: bigint;
  refundedMinor: bigint;
  method: string;
  occurredAt: string;
  kioskReference?: string | undefined;
}

/** Paymob's source types → Mizan's method names; one it adds later is `other` (and a drift note). */
const METHODS: Record<string, string> = {
  card: "card", wallet: "wallet", aggregator: "kiosk", kiosk: "kiosk", "cash present": "kiosk", apple_pay: "apple_pay", applepay: "apple_pay", google_pay: "google_pay",
  valu: "bnpl", sympl: "bnpl", souhoola: "bnpl", halan: "bnpl", tru: "bnpl", mogo: "bnpl", forsa: "bnpl", aman: "bnpl", tabby: "bnpl", tamara: "bnpl", premium: "bnpl", contact: "bnpl",
  "bank-installments": "bnpl", "card-installment": "bnpl", stcpay: "wallet",
};

/**
 * `GET /api/acceptance/transactions/{id}` → the facts Mizan acts on. Money only from the integer
 * cent fields (`data.*` carries major units on cards: never read). `captured_amount` is in cents,
 * `refunded_amount_cents` cumulative across partial refunds.
 */
export function mapTransaction(raw: unknown, ctx: PaymobMapCtx): PaymobTransaction {
  const r = new Resolver(raw, { connector: "paymob", entity: "transaction", drift: ctx.drift, now: ctx.now });
  const flag = (name: string, paths: string[]) => {
    const v = r.any(name, paths);
    return v === true || v === "true";
  };
  // Money: absent is 0 only where the field is optional; present but not a whole number of cents is drift, never 0.
  const cents = (name: string, paths: string[], required = false) => {
    const v = r.any(name, paths, { required });
    if (v === undefined || v === null) return 0n;
    const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,15}$/.test(v) ? Number(v) : NaN; // "1150.00" is major units, never cents
    if (!Number.isInteger(n) || n < 0) throw new SchemaDriftError("paymob", "transaction", name, paths);
    return BigInt(n);
  };
  const sourceType = (r.str("sourceType", ["source_data.type"]) ?? "").toLowerCase();
  const subType = (r.str("subType", ["source_data.sub_type"]) ?? "").toLowerCase();
  let method = METHODS[subType] ?? METHODS[sourceType];
  if (!method) {
    method = "other";
    ctx.drift.record({ connector: "paymob", entity: "transaction", kind: "unknown_status", field: "source_data.type", detail: `a payment method Mizan does not know: ${sourceType}/${subType}`, at: ctx.now() });
  }
  const parent = r.str("parentId", ["parent_transaction", "parent_transaction.id"]);
  const kiosk = r.str("kioskReference", ["data.bill_reference", "bill_reference"]);
  return {
    id: r.str("id", ["id"], { required: true })!,
    parentId: parent && parent !== "0" && parent !== "null" ? parent : null,
    hasParent: flag("hasParent", ["has_parent_transaction"]) || r.any("standalone", ["is_standalone_payment"]) === false,
    isCapture: flag("isCapture", ["is_capture"]),
    isRefunded: flag("isRefunded", ["is_refunded"]),
    reference: r.str("reference", ["order.merchant_order_id", "merchant_order_id"]) ?? null,
    currency: (r.str("currency", ["currency", "order.currency"], { required: true }) ?? "").toUpperCase(),
    amountMinor: cents("amount", ["amount_cents"], true),
    success: flag("success", ["success"]),
    pending: flag("pending", ["pending"]),
    errorOccurred: flag("errorOccurred", ["error_occured", "error_occurred"]),
    isAuth: flag("isAuth", ["is_auth"]),
    voided: flag("voided", ["is_voided"]),
    capturedMinor: cents("captured", ["captured_amount"]),
    refundedMinor: cents("refunded", ["refunded_amount_cents"]),
    method,
    occurredAt: r.str("createdAt", ["created_at"]) ?? new Date(ctx.now()).toISOString(),
    ...(kiosk ? { kioskReference: kiosk } : {}),
  };
}
