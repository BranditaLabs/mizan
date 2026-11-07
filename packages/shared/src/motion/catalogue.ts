import type { DomainEventType } from "../events.js";
import type { EventData, MergeKey, MotionRule, Outcome, Pending, Surface, Variant } from "./model.js";

/**
 * EVENT_MOTION: every domain event (DOMAIN_EVENT_TYPES) mapped to exactly one motion rule. Adding an
 * event type without a row fails typecheck (`satisfies Record<DomainEventType, …>`) and the tests.
 * Copy is `motion.event.<type>` in apps/web/messages (a `select` message when the rule has a
 * variant); a quiet rule without a variant has no copy.
 *
 * Red DROP is allowlisted (test/motion.test.ts): an order confirmed, a manual order created, and
 * money in (payment received or paid by link, an order paid, a dispute won, a payout received).
 * Money going out (a refund completed) is "done", never red.
 */

type Spec = Omit<MotionRule, "copy" | "audience"> & { audience?: MotionRule["audience"] };

const btn = "button", tst = "toast", bell = "bell", tl = "timeline", card = "card", list = "list", kpi = "kpi", sync = "sync", q = "queue", inst = "instrument", ban = "banner";
const S = (...s: Surface[]) => s;

/** A rule: pending loader (or none), outcome, surfaces, extras. */
const m = (pending: Pending | null, outcome: Outcome, surfaces: Surface[], extra: Partial<Spec> = {}): Spec => ({ ...(pending ? { pending } : {}), outcome, surfaces, ...extra });

// ── Variant readers: non-PII fields only, each checked against its emitter (test fixtures). ──
const field = (e: EventData, k: string) => (e.data && typeof e.data === "object" ? e.data[k] : undefined);
const variant = (arg: string, pick: (e: EventData) => string, outcomes: Variant["outcomes"]): Variant => ({ arg, pick, outcomes });

/** order.created: a person made it in Mizan (actor user) or it was ingested from a channel. order-projector.ts emits actor opts.actor ?? engine. */
const manual = variant("manual", (e) => (e.actor?.type === "user" ? "manual" : "other"), { manual: "drop", other: "settle" });
/** order.payment_changed data.to: a PaymentStatus (order-projector.ts, ledger.service.ts). */
const paymentState = variant("state", (e) => {
  const to = String(field(e, "to") ?? "");
  if (to === "paid") return "paid";
  if (to === "failed" || to === "unknown") return "failed";
  if (to === "refunded" || to === "partially_refunded" || to === "voided") return "refunded";
  return "other";
}, { paid: "drop", failed: "tip", refunded: "settle", other: "settle" });
/** dispute.closed data.outcome: won | lost | accepted (disputes.service.ts). */
const disputeResult = variant("result", (e) => { const o = String(field(e, "outcome") ?? ""); return o === "won" || o === "lost" ? o : "other"; }, { won: "drop", lost: "fail", other: "settle" });
/** pnl.recomputed data.isFinal (profit.service.ts). */
const pnlFinal = variant("final", (e) => (field(e, "isFinal") === true ? "final" : "other"), { final: "merge", other: "quiet" });
/** po.received data.complete (purchasing.service.ts). */
const poFull = variant("full", (e) => (field(e, "complete") === true ? "full" : "other"), { full: "merge", other: "done" });
/** orders.bulk_finished data.failed / data.total (bulk.service.ts returns the bulk_actions counts). */
const bulkFailed = variant("failed", (e) => {
  const failed = Number(field(e, "failed") ?? 0), total = Number(field(e, "total") ?? 0);
  return failed <= 0 ? "none" : total > 0 && failed >= total ? "all" : "some";
}, { none: "done", some: "tip", all: "fail", other: "done" });
/** connection.disconnected: actor user = the merchant disconnected it (connection-lifecycle.ts). */
const byUser = variant("byUser", (e) => (e.actor?.type === "user" ? "byUser" : "other"), { byUser: "settle", other: "fail" });
/** stock.adjusted data.items: variant → delta of the adjusted lines; none = the count matched (stock.service.ts). */
const matched = variant("matched", (e) => {
  const items = field(e, "items");
  return items && typeof items === "object" && Object.values(items as Record<string, unknown>).every((d) => Number(d) === 0) ? "matched" : "other";
}, { matched: "merge", other: "settle" });
/** privacy.requested data.dueAt (ISO): past due = overdue. The current emitter sends no due date, so it settles. */
const overdue = variant("overdue", (e) => {
  const due = field(e, "dueAt");
  return typeof due === "string" && Date.parse(due) < (e.now ?? Date.now()) ? "overdue" : "other";
}, { overdue: "tip", other: "settle" });

const SPECS = {
  // ── Platform and team ──
  "tenant.created": m("pair", "done", S(card)),
  "member.invited": m("drop", "settle", S(btn, tst, list)),
  "member.joined": m(null, "settle", S(list, bell)),
  "member.updated": m("drop", "settle", S(btn, tst, list)),
  "member.removed": m("drop", "settle", S(btn, tst, list)),
  "privacy.requested": m(null, "settle", S(list, bell), { variant: overdue }),
  "privacy.completed": m("drop", "done", S(tst, list)),
  "plan.limit_reached": m(null, "tip", S(bell, ban, kpi)),
  "plan.upgrade_requested": m("drop", "settle", S(btn, tst)),
  "automation.run_failed": m(null, "fail", S(list, bell), { mergeKey: "list" }),
  "automation.paused": m(null, "fail", S(list, bell)),
  "connection.connected": m("transfer", "merge", S(btn, tst, sync)),
  "connection.disconnected": m("drop", "fail", S(sync, bell), { variant: byUser }),
  "connection.needs_attention": m(null, "fail", S(sync, bell)),
  "connection.sync_completed": m("transfer", "merge", S(sync, bell)),
  "connection.sync_failed": m(null, "fail", S(sync, bell)),
  "sync.recovered": m(null, "merge", S(sync, list)),

  // ── Orders ──
  "order.created": m("drop", "settle", S(btn, tst, list, kpi, tl), { variant: manual, mergeKey: "list" }),
  "order.updated": m(null, "quiet", S(tl), { mergeKey: "entity" }),
  "order.cancelled": m("drop", "settle", S(btn, tl, list, kpi)),
  "order.duplicate_found": m(null, "tip", S(ban, list, tl)),
  "order.duplicate_resolved": m("drop", "merge", S(btn, tst)),
  "orders.reconciled": m("transfer", "merge", S(sync, inst)),
  "orders.reconciliation_gap": m(null, "tip", S(sync, inst, bell)),
  "order.assigned": m("drop", "settle", S(tl, q)),
  "order.tagged": m("drop", "settle", S(btn, tl), { mergeKey: "entity" }),
  "order.untagged": m("drop", "settle", S(btn, tl), { mergeKey: "entity" }),
  "order.note_added": m("drop", "settle", S(btn, tl)),
  "order.edited": m("drop", "done", S(btn, tst, card, tl)),
  "order.edit_failed": m(null, "fail", S(card, tl)),
  "order.store_cancel_failed": m(null, "fail", S(tl, card)),
  "order.store_copy_failed": m(null, "fail", S(tl)),
  "order.store_fulfilled": m(null, "done", S(tl)),
  "order.store_fulfillment_cancelled": m(null, "settle", S(tl)),
  "order.cancelled_after_shipping": m(null, "tip", S(q, tl, bell)),
  "order.payment_changed": m(null, "settle", S(card, tl, kpi), { variant: paymentState }),
  "order.awaiting_payment": m(null, "tip", S(card, list, tl)),
  "order.scored": m(null, "quiet", S(card, list)),
  "order.confirmed": m("drop", "drop", S(btn, tst, card, tl, kpi, q)),
  "order.confirmation_failed": m(null, "fail", S(card, tl)),
  "confirmation.started": m("transfer", "settle", S(card, tl)),
  "confirmation.routed": m(null, "quiet", S(tl)),
  "confirmation.sent": m("drop", "settle", S(card, tl)),
  "confirmation.escalated": m(null, "tip", S(card, q, tl)),
  "confirmation.no_answer": m(null, "tip", S(q, tl)),
  "order.ready_to_ship": m(null, "done", S(list, tl), { mergeKey: "list" }),
  "order.auto_ship_blocked": m(null, "tip", S(card, bell, tl)),
  "offer.proposed": m("drop", "settle", S(btn, tst, card, tl)),
  "offer.accepted": m(null, "merge", S(card, tl)),
  "offer.declined": m(null, "settle", S(card, tl)),
  "offer.expired": m(null, "settle", S(card, tl)),
  "offer.applied": m("transfer", "merge", S(card, tl)),
  "offer.failed": m(null, "fail", S(card, tl)),
  "whatsapp.template_submitted": m("drop", "settle", S(btn, tst)),
  "order.packed": m("fill", "done", S(tl, list)),
  "order.partially_delivered": m(null, "tip", S(card, tl)),
  "order.refused": m(null, "fail", S(card, tl)),

  // ── Shipping ──
  "shipment.created": m("transfer", "done", S(btn, card, list, tl)),
  "shipment.booking_failed": m(null, "fail", S(card, list, tl)),
  "shipment.status_changed": m(null, "settle", S(list, tl), { mergeKey: "list" }),
  "shipment.needs_review": m(null, "tip", S(q)),
  "shipment.delivered": m(null, "done", S(list, tl, kpi, inst), { mergeKey: "list" }),
  "shipment.returned": m(null, "fail", S(list, tl, kpi), { mergeKey: "list" }),
  "picklist.created": m("drop", "settle", S(btn, tst, list)),
  "picklist.closed": m("drop", "done", S(btn, tst, list)),

  // ── Stock ──
  "stock.reserved": m(null, "quiet", S(card)),
  "stock.released": m(null, "quiet", S(card)),
  "stock.short": m(null, "tip", S(card, bell)),
  "stock.received": m("drop", "done", S(tst, list, inst)),
  "stock.adjusted": m("drop", "settle", S(btn, tst, inst), { variant: matched }),
  "stock.changed": m(null, "quiet", S()),
  "stock.low": m(null, "tip", S(list, bell), { mergeKey: "list" }),
  "stock.out": m(null, "tip", S(list, bell), { mergeKey: "list" }),
  "stock.reorder_suggested": m(null, "settle", S(list), { mergeKey: "list" }),

  // ── Profit and money ──
  "pnl.recomputed": m("transfer", "quiet", S(card, kpi), { variant: pnlFinal, mergeKey: "store" }),
  "costs.changed": m("drop", "settle", S(btn, tst)),
  "fx.rate_overridden": m("drop", "settle", S(btn, tst)),
  "ads.spend_changed": m("drop", "settle", S(btn, tst, inst)),
  "payment.received": m("drop", "drop", S(card, list, kpi, tst)),
  "payment.failed": m(null, "fail", S(card, list)),
  "payment.link_sent": m("drop", "settle", S(btn, tst, card)),
  "payment.link_paid": m(null, "drop", S(card, tl, kpi)),
  "refund.created": m("drop", "settle", S(btn, tst, list)),
  "refund.approved": m("drop", "done", S(btn, tst, list)),
  "refund.rejected": m("drop", "settle", S(btn, tst, list)),
  "refund.completed": m("drop", "done", S(tst, card, kpi)),
  "dispute.opened": m(null, "tip", S(list, bell)),
  "dispute.evidence_submitted": m("drop", "settle", S(btn, tst, list)),
  "dispute.closed": m(null, "settle", S(list), { variant: disputeResult }),
  "settlement.matched": m("transfer", "merge", S(inst, list)),
  "settlement.gap_found": m(null, "tip", S(inst, bell)),

  // ── Returns, tickets, purchasing, catalogue, bulk ──
  "ticket.created": m("drop", "settle", S(btn, tst, list, card)),
  "ticket.status_changed": m("drop", "settle", S(btn, tst, card)),
  "ticket.assigned": m("drop", "settle", S(card)),
  "return.inspected": m("drop", "done", S(btn, tst, card, tl)),
  "exchange.created": m("drop", "done", S(btn, tst, card, tl)),
  "exchange.returned": m(null, "merge", S(card)),
  "po.approved": m("drop", "done", S(btn, tst, list)),
  "po.sent": m("drop", "settle", S(btn, tst, list)),
  "po.cancelled": m("drop", "settle", S(btn, tst, list)),
  "po.received": m("drop", "done", S(tst, list, inst), { variant: poFull }),
  "product.created": m("drop", "settle", S(btn, tst, list)),
  "product.updated": m("drop", "settle", S(btn, tst)),
  "product.published": m("transfer", "done", S(card)),
  "product.publish_failed": m(null, "fail", S(card)),
  "orders.bulk_requested": m("fill", "quiet", S(card)),
  "orders.bulk_continue": m("fill", "quiet", S(card)),
  "orders.bulk_finished": m(null, "done", S(card, tst), { variant: bulkFailed }),

  // ── Registered, no emitter yet (mapped so they work when emitters land) ──
  "channel.order_received": m(null, "settle", S(list, kpi), { mergeKey: "list" }),
  "channel.payout_received": m(null, "drop", S(list, kpi, inst)),
  "conversation.created": m(null, "settle", S(list), { mergeKey: "list" }),
  "conversation.sla_breached": m(null, "tip", S(list, bell)),
  "einvoice.rejected": m(null, "fail", S(list, bell)),
  "listing.error": m(null, "fail", S(list, bell), { mergeKey: "list" }),
  "metric.threshold_crossed": m(null, "tip", S(kpi, bell)),
  "period.closed": m(null, "merge", S(inst, list)),
} satisfies Record<DomainEventType, Spec>;

/** A quiet rule without a variant has nothing to say; every other rule has motion.event.<type>. */
const hasCopy = (s: Spec) => s.outcome !== "quiet" || Boolean(s.variant);

export const EVENT_MOTION = Object.fromEntries(
  Object.entries(SPECS).map(([type, s]) => [type, { audience: "merchant", ...s, copy: hasCopy(s) ? `motion.event.${type}` : null } satisfies MotionRule]),
) as Record<DomainEventType, MotionRule>;

/** Events whose rule may play a red DROP (the checked-in allowlist, with the branch when it is a variant). */
export const DROP_ALLOWLIST = [
  "order.confirmed", "order.created:manual", "payment.received", "payment.link_paid",
  "order.payment_changed:paid", "dispute.closed:won", "channel.payout_received",
] as const;

/** Every outcome a rule can play (its own, or each variant branch's). */
export function outcomesOf(rule: Pick<MotionRule, "outcome" | "variant">): { branch: string | null; outcome: Outcome }[] {
  if (!rule.variant) return [{ branch: null, outcome: rule.outcome }];
  return Object.entries(rule.variant.outcomes).map(([branch, outcome]) => ({ branch, outcome }));
}

export type { MergeKey };
