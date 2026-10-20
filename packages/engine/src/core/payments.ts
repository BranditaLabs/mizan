import { IntegrationError } from "./errors.js";
import { fromMinor, toMinor, type CanonicalOrder, type Money, type PaymentMode } from "@mizan/shared";

/**
 * Payment rules shared by every courier connector.
 *
 * The courier must collect exactly what the customer still owes — never the
 * order total by default. A prepaid order ships with nothing to collect; a
 * deposit order ships with the balance; an unpaid bank transfer does not ship.
 * When the engine cannot tell, it refuses to guess: shipping an order with the
 * wrong cash amount loses money silently.
 */

export type ShipBlockReason = "awaiting_payment" | "payment_failed" | "payment_mode_unknown" | "refunded";

export class ShipBlockedError extends IntegrationError {
  constructor(readonly reason: ShipBlockReason, orderNumber: string, detail: string) {
    super({ kind: "validation", connector: "engine", message: `order ${orderNumber} cannot ship: ${reason} (${detail})`, details: { reason } });
    this.name = "ShipBlockedError";
  }
}

/** Modes where the courier collects cash on delivery. */
export const COLLECTS_ON_DELIVERY: ReadonlySet<PaymentMode> = new Set(["cod", "partial"]);

/**
 * Cash the courier must collect for this order.
 * Throws ShipBlockedError when the order must not ship yet.
 */
export function cashToCollect(order: CanonicalOrder): Money {
  const cur = order.total.currency || order.currency;
  const zero = fromMinor(0n, cur);
  const outstanding = order.outstanding ? toMinor({ ...order.outstanding, currency: cur }) : undefined;
  const received = order.received ? toMinor({ ...order.received, currency: cur }) : undefined;
  const total = toMinor({ ...order.total, currency: cur });

  if (order.paymentStatus === "refunded" || order.paymentStatus === "voided") {
    throw new ShipBlockedError("refunded", order.number, `payment ${order.paymentStatus}`);
  }

  switch (order.paymentMode) {
    case "cod": {
      const due = outstanding ?? total - (received ?? 0n);
      return fromMinor(due > 0n ? due : 0n, cur);
    }
    case "partial": {
      const due = outstanding ?? (received !== undefined ? total - received : undefined);
      if (due === undefined) throw new ShipBlockedError("payment_mode_unknown", order.number, "deposit order without outstanding or received amount");
      return fromMinor(due > 0n ? due : 0n, cur);
    }
    case "prepaid":
    case "bnpl":
    case "bank_transfer": {
      if (order.paymentStatus === "failed") throw new ShipBlockedError("payment_failed", order.number, order.financialStatus ?? "failed");
      const paidEnough = order.paymentStatus === "paid" || order.paymentStatus === "authorized" || order.paymentStatus === "partially_refunded";
      if (!paidEnough) {
        throw new ShipBlockedError("awaiting_payment", order.number, `${order.paymentMode} is ${order.paymentStatus}`);
      }
      return zero;
    }
    default:
      throw new ShipBlockedError("payment_mode_unknown", order.number, `gateways: ${order.gateways.join(", ") || "none"}`);
  }
}

/** Whether delivery means the customer has now paid in full (so the store can be marked paid). */
export const deliveryCompletesPayment = (order: CanonicalOrder) => COLLECTS_ON_DELIVERY.has(order.paymentMode);
