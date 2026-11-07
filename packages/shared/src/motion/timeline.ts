import type { DomainEventType } from "../events.js";
import type { Outcome } from "./model.js";

/**
 * The order timeline's row types: exactly the `type` values apps/api writes to `order_events`
 * (test/motion.test.ts scans apps/api/src and fails when a new one is not listed here).
 */
export const ORDER_EVENT_TYPES = [
  "created", "updated", "payment_changed", "awaiting_payment",
  "confirmation_started", "confirmed", "cancelled", "change_requested", "confirmation_escalated", "call_no_answer", "assigned",
  "after_confirmation_scheduled", "after_confirmation_released", "auto_book_blocked", "auto_book_skipped", "auto_cancel_scheduled",
  "change_note", "change_after_confirm", "location_shared", "whatsapp_opted_in", "whatsapp_opted_out",
  "offer_accepted", "offer_declined", "offer_expired", "offer_applied", "offer_failed",
  "duplicate_found", "duplicate_kept", "duplicate_merged",
  "tagged", "untagged", "note_added", "edit_requested", "edited", "edit_failed",
  "store_copy_created", "store_copy_failed", "store_copy_synced", "store_cancel_failed",
  "ship_requested", "shipped", "ship_failed", "cancel_requested", "shipment_status", "packed",
  "partially_delivered", "refused", "exchange_created",
  "conversion_offered", "conversion_paid",
] as const;

export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];

export interface TimelineRule {
  outcome: Outcome;
  /** The domain event that carries the same fact (its outcome is the row's). */
  twin?: DomainEventType;
  /** next-intl key, motion.timeline.<type>. */
  copy: `motion.timeline.${string}`;
}

const t = (outcome: Outcome, twin?: DomainEventType) => ({ outcome, ...(twin ? { twin } : {}) });

const SPECS = {
  created: t("settle", "order.created"),
  updated: t("settle"),
  payment_changed: t("settle", "order.payment_changed"),
  awaiting_payment: t("tip", "order.awaiting_payment"),
  confirmation_started: t("settle", "confirmation.started"),
  confirmed: t("drop", "order.confirmed"),
  cancelled: t("settle", "order.cancelled"),
  change_requested: t("settle"),
  confirmation_escalated: t("tip", "confirmation.escalated"),
  call_no_answer: t("tip", "confirmation.no_answer"),
  assigned: t("settle", "order.assigned"),
  after_confirmation_scheduled: t("settle"),
  after_confirmation_released: t("settle"),
  auto_book_blocked: t("tip", "order.auto_ship_blocked"),
  auto_book_skipped: t("settle"),
  auto_cancel_scheduled: t("tip"),
  change_note: t("settle"),
  change_after_confirm: t("tip"),
  location_shared: t("settle"),
  whatsapp_opted_in: t("settle"),
  whatsapp_opted_out: t("settle"),
  offer_accepted: t("merge", "offer.accepted"),
  offer_declined: t("settle", "offer.declined"),
  offer_expired: t("settle", "offer.expired"),
  offer_applied: t("merge", "offer.applied"),
  offer_failed: t("fail", "offer.failed"),
  duplicate_found: t("tip", "order.duplicate_found"),
  duplicate_kept: t("settle"),
  duplicate_merged: t("merge", "order.duplicate_resolved"),
  tagged: t("settle", "order.tagged"),
  untagged: t("settle", "order.untagged"),
  note_added: t("settle", "order.note_added"),
  edit_requested: t("settle"),
  edited: t("done", "order.edited"),
  edit_failed: t("fail", "order.edit_failed"),
  store_copy_created: t("done"),
  store_copy_failed: t("fail", "order.store_copy_failed"),
  store_copy_synced: t("done"),
  store_cancel_failed: t("fail", "order.store_cancel_failed"),
  ship_requested: t("settle"),
  shipped: t("done", "shipment.created"),
  ship_failed: t("fail", "shipment.booking_failed"),
  cancel_requested: t("settle"),
  shipment_status: t("settle", "shipment.status_changed"),
  packed: t("done", "order.packed"),
  partially_delivered: t("tip", "order.partially_delivered"),
  refused: t("fail", "order.refused"),
  exchange_created: t("done", "exchange.created"),
  conversion_offered: t("settle", "payment.link_sent"),
  conversion_paid: t("drop", "payment.link_paid"),
} satisfies Record<OrderEventType, Omit<TimelineRule, "copy">>;

/** Every order_events row type → its outcome and copy. Rows render static unless fresh (useFresh). */
export const TIMELINE_MOTION = Object.fromEntries(
  Object.entries(SPECS).map(([type, s]) => [type, { ...s, copy: `motion.timeline.${type}` } satisfies TimelineRule]),
) as Record<OrderEventType, TimelineRule>;

export const isOrderEventType = (v: string): v is OrderEventType => (ORDER_EVENT_TYPES as readonly string[]).includes(v);
