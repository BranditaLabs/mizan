import type { ConfirmationService } from "../confirmation/confirmation.service.js";
import type { ShippingService } from "../shipping/shipping.service.js";

/**
 * Injection tokens between modules that would otherwise import each other (engine registry ↔
 * orders ↔ confirmation). Only symbols and types live here, so loading it loads nothing else.
 */
/** Where a store cancellation's outcome goes (E5-4: the bulk actions service), resolved lazily by the engine registry. */
export const CANCEL_RESULTS = Symbol("CANCEL_RESULTS");
/** Confirmation's answer for an order (E5-4 bulk confirm), provided by the confirmation module. */
export const ORDER_ANSWERS = Symbol("ORDER_ANSWERS");
export type OrderAnswers = Pick<ConfirmationService, "liveRun" | "applyAnswer">;
/** Booking the courier for an order (E7-2 bulk ship), provided by the shipping module. */
export const ORDER_SHIPPING = Symbol("ORDER_SHIPPING");
export type OrderShipping = Pick<ShippingService, "book" | "courier">;
