import type { ConfirmationService } from "../confirmation/confirmation.service.js";
import type { ShippingService } from "../shipping/shipping.service.js";

/**
 * Injection tokens between modules that would otherwise import each other (engine registry ↔
 * orders ↔ confirmation). Only symbols and types live here, so loading it loads nothing else.
 */
/** Where a store cancellation's outcome goes (E5-4: the bulk actions service), resolved lazily by the engine registry. */
export const CANCEL_RESULTS = Symbol("CANCEL_RESULTS");
/** Products made in Mizan (P3): the engine reads one when its publish job runs and reports the store's answer. */
export const PRODUCT_PUBLISH = Symbol("PRODUCT_PUBLISH");
export interface ProductPublishSink {
  loadDraft(tenantId: string, productId: string): Promise<import("@mizan/engine").ProductDraft | undefined>;
  recordPublished(tenantId: string, productId: string, result: import("@mizan/engine").ProductPublishOutcome): Promise<void>;
}
/** Order edits (O3): the engine reads an edit when its job runs and reports the store's answer. */
export const ORDER_EDITS = Symbol("ORDER_EDITS");
export interface OrderEditSink {
  loadPlan(tenantId: string, editId: string): Promise<import("@mizan/engine").OrderEditPlan | undefined>;
  recordResult(tenantId: string, editId: string, result: import("@mizan/engine").OrderEditOutcome): Promise<void>;
}
/** Confirmation's answer for an order (E5-4 bulk confirm), provided by the confirmation module. */
export const ORDER_ANSWERS = Symbol("ORDER_ANSWERS");
export type OrderAnswers = Pick<ConfirmationService, "liveRun" | "applyAnswer">;
/** Booking the courier for an order (E7-2 bulk ship), provided by the shipping module. */
export const ORDER_SHIPPING = Symbol("ORDER_SHIPPING");
export type OrderShipping = Pick<ShippingService, "book" | "courier">;
