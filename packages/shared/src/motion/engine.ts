import type { DomainEventType } from "../events.js";
import type { Outcome, Variant } from "./model.js";

/**
 * The integration engine's own events (packages/engine/src/engine/engine.ts `this.emit(…)`). The
 * engine re-exports EngineEventType and types its emit with it; an engine test checks every literal.
 * Engine events never animate on merchant surfaces in BR-1: they show as static glyphs on the staff
 * surfaces (admin Health, Settings → Engine health). `twin` names the domain event that already
 * carries the merchant's motion; `bridge` events reach merchants only after BR-5.
 */
export const ENGINE_EVENT_TYPES = [
  "job.dead", "connection.needs_attention", "connection.uninstalled", "drift", "webhook.rejected",
  "backfill.progress", "backfill.completed", "backfill.failed",
  "catalog.refreshed", "product.pushed", "product.ingested", "stock.pushed", "stock.push_skipped", "store_order.synced",
  "shopify.webhooks_synced", "woocommerce.webhooks_synced", "order.progress",
  "order.ingested", "order.paid", "payment.ingested", "order.payment_changed",
  "order.fulfilled", "order.deleted", "order.cancel_failed", "order.cancelled_in_store",
  "order_edit.applied", "order_edit.failed", "order.awaiting_payment", "order.cancelled_after_shipping",
  "shipment.created", "shipment.failed", "shipment.status", "shipment.status_ignored", "shipment.needs_review",
  "shipment.missing", "shipment.orphan", "shipment.cancelled", "shipment.cancel_refused",
  "product.conflict", "product.missing", "product.published", "product.publish_failed",
  "store_order.created", "store_order.failed", "store_copy.repaired", "store_fulfillment.cancelled",
  "payment_link.created", "payment_link.failed", "offer.applied", "offer.failed",
  "orders.reconciled", "bosta.access_checked",
] as const;

export type EngineEventType = (typeof ENGINE_EVENT_TYPES)[number];

export interface EngineRule {
  outcome: Outcome;
  variant?: Variant;
  audience: "staff";
  /** The domain event that already carries this fact to merchants. */
  twin?: DomainEventType;
  /** Reaches merchants only through the engine bridge (BR-5), as this domain event or the timeline. */
  bridge?: DomainEventType | "timeline" | "review_queue" | "notification";
}

const e = (outcome: Outcome, extra: Omit<EngineRule, "outcome" | "audience"> = {}): EngineRule => ({ outcome, audience: "staff", ...extra });
const accessOk: Variant = { arg: "ok", pick: (x) => (x.data && x.data.ok === true ? "ok" : "other"), outcomes: { ok: "merge", other: "fail" } };

export const ENGINE_MOTION = {
  "job.dead": e("fail", { bridge: "notification" }),
  "connection.needs_attention": e("fail", { twin: "connection.needs_attention" }),
  "connection.uninstalled": e("fail", { bridge: "connection.disconnected" }),
  drift: e("tip"),
  "webhook.rejected": e("fail"),
  "backfill.progress": e("quiet"),
  "backfill.completed": e("merge", { twin: "connection.sync_completed" }),
  "backfill.failed": e("fail", { twin: "connection.sync_failed" }),
  "catalog.refreshed": e("quiet"),
  "product.pushed": e("quiet"),
  "product.ingested": e("quiet"),
  "stock.pushed": e("quiet"),
  "stock.push_skipped": e("quiet"),
  "store_order.synced": e("quiet"),
  "shopify.webhooks_synced": e("quiet"),
  "woocommerce.webhooks_synced": e("quiet"),
  "order.progress": e("quiet"),
  "order.ingested": e("quiet", { twin: "order.created" }),
  "order.paid": e("quiet", { twin: "order.payment_changed" }),
  "payment.ingested": e("quiet", { twin: "payment.received" }),
  "order.payment_changed": e("quiet", { twin: "order.payment_changed" }),
  "order.fulfilled": e("done", { twin: "order.store_fulfilled" }),
  "order.deleted": e("settle", { bridge: "timeline" }),
  "order.cancel_failed": e("fail", { twin: "order.store_cancel_failed" }),
  "order.cancelled_in_store": e("settle", { twin: "order.cancelled" }),
  "order_edit.applied": e("done", { twin: "order.edited" }),
  "order_edit.failed": e("fail", { twin: "order.edit_failed" }),
  "order.awaiting_payment": e("tip", { twin: "order.awaiting_payment" }),
  "order.cancelled_after_shipping": e("tip", { twin: "order.cancelled_after_shipping" }),
  "shipment.created": e("done", { twin: "shipment.created" }),
  "shipment.failed": e("fail", { twin: "shipment.booking_failed" }),
  "shipment.status": e("settle", { twin: "shipment.status_changed" }),
  "shipment.status_ignored": e("tip"),
  "shipment.needs_review": e("tip", { twin: "shipment.needs_review" }),
  "shipment.missing": e("tip", { bridge: "review_queue" }),
  "shipment.orphan": e("tip", { bridge: "review_queue" }),
  "shipment.cancelled": e("done", { bridge: "timeline" }),
  "shipment.cancel_refused": e("fail", { bridge: "timeline" }),
  "product.conflict": e("tip", { bridge: "notification" }),
  "product.missing": e("tip"),
  "product.published": e("done", { twin: "product.published" }),
  "product.publish_failed": e("fail", { twin: "product.publish_failed" }),
  "store_order.created": e("done"),
  "store_order.failed": e("fail", { twin: "order.store_copy_failed" }),
  "store_copy.repaired": e("done"),
  "store_fulfillment.cancelled": e("settle", { twin: "order.store_fulfillment_cancelled" }),
  "payment_link.created": e("quiet", { twin: "payment.link_sent" }),
  "payment_link.failed": e("fail", { bridge: "notification" }),
  "offer.applied": e("merge", { twin: "offer.applied" }),
  "offer.failed": e("fail", { twin: "offer.failed" }),
  "orders.reconciled": e("merge", { twin: "orders.reconciled" }),
  "bosta.access_checked": e("fail", { variant: accessOk }),
} satisfies Record<EngineEventType, EngineRule>;

export const isEngineEventType = (v: string): v is EngineEventType => (ENGINE_EVENT_TYPES as readonly string[]).includes(v);
