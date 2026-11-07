import type { DomainEventType } from "../events.js";
import { LOADER_FOR, type EventData, type MergeKey, type MotionRule, type Outcome, type Pending, type RowAction, type Surface, type Variant } from "./model.js";

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

type Spec = Omit<MotionRule, "copy" | "audience" | "pending"> & { audience?: MotionRule["audience"] };

const btn = "button", tst = "toast", bell = "bell", tl = "timeline", card = "card", list = "list", kpi = "kpi", sync = "sync", q = "queue", inst = "instrument", ban = "banner";
const S = (...s: Surface[]) => s;

/**
 * A rule: what the viewer's action does (or null: the event comes from outside), outcome, surfaces,
 * extras. The pending loader is derived from the action (LOADER_FOR), never named here. A row has
 * no value, so it never names `progress`: FILL belongs to the screen's progress component.
 */
function m<A extends RowAction | null>(action: A, outcome: Outcome, surfaces: Surface[], extra: Partial<Spec> = {}): Spec & (A extends RowAction ? { action: A } : { action?: undefined }) {
  return { ...(action ? { action } : {}), outcome, surfaces, ...extra } as Spec & (A extends RowAction ? { action: A } : { action?: undefined });
}

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
  "tenant.created": m("write", "done", S(card)),
  "member.invited": m("write", "settle", S(btn, tst, list)),
  "member.joined": m(null, "settle", S(list, bell)),
  "member.updated": m("write", "settle", S(btn, tst, list)),
  "member.removed": m("write", "settle", S(btn, tst, list)),
  "privacy.requested": m(null, "settle", S(list, bell), { variant: overdue }),
  "privacy.completed": m("write", "done", S(tst, list)),
  "plan.limit_reached": m(null, "tip", S(bell, ban, kpi)),
  "plan.upgrade_requested": m("write", "settle", S(btn, tst)),
  // Subscriptions (E12-2a): platform events, never red. The trial and the plan show in the plan banner;
  // a trial ending into Free is a warning (orders still flow), a plan change settles.
  "subscription.trial_started": m(null, "settle", S(ban)),
  "subscription.trial_ended": m(null, "tip", S(ban, bell)),
  "subscription.plan_changed": m(null, "settle", S(ban, tst)),
  "automation.run_failed": m(null, "fail", S(list, bell), { mergeKey: "list" }),
  "automation.paused": m(null, "fail", S(list, bell)),
  "connection.connected": m("sync", "merge", S(btn, tst, sync)),
  "connection.disconnected": m("write", "fail", S(sync, bell), { variant: byUser }),
  "connection.needs_attention": m(null, "fail", S(sync, bell)),
  "connection.sync_completed": m("sync", "merge", S(sync, bell)),
  "connection.sync_failed": m(null, "fail", S(sync, bell)),
  "sync.recovered": m(null, "merge", S(sync, list)),

  // ── Orders ──
  "order.created": m("write", "settle", S(btn, tst, list, kpi, tl), { variant: manual, mergeKey: "list" }),
  "order.updated": m(null, "quiet", S(tl), { mergeKey: "entity" }),
  "order.cancelled": m("write", "settle", S(btn, tl, list, kpi)),
  "order.duplicate_found": m(null, "tip", S(ban, list, tl)),
  "order.duplicate_resolved": m("write", "merge", S(btn, tst)),
  "orders.reconciled": m("sync", "merge", S(sync, inst)),
  "orders.reconciliation_gap": m(null, "tip", S(sync, inst, bell)),
  "order.assigned": m("write", "settle", S(tl, q)),
  "order.tagged": m("write", "settle", S(btn, tl), { mergeKey: "entity" }),
  "order.untagged": m("write", "settle", S(btn, tl), { mergeKey: "entity" }),
  "order.note_added": m("write", "settle", S(btn, tl)),
  "order.edited": m("write", "done", S(btn, tst, card, tl)),
  "order.edit_failed": m(null, "fail", S(card, tl)),
  "order.store_cancel_failed": m(null, "fail", S(tl, card)),
  "order.store_copy_failed": m(null, "fail", S(tl)),
  "order.store_fulfilled": m(null, "done", S(tl)),
  "order.store_fulfillment_cancelled": m(null, "settle", S(tl)),
  "order.cancelled_after_shipping": m(null, "tip", S(q, tl, bell)),
  "order.payment_changed": m(null, "settle", S(card, tl, kpi), { variant: paymentState }),
  "order.awaiting_payment": m(null, "tip", S(card, list, tl)),
  "order.scored": m(null, "quiet", S(card, list)),
  "order.confirmed": m("write", "drop", S(btn, tst, card, tl, kpi, q)),
  "order.confirmation_failed": m(null, "fail", S(card, tl)),
  "confirmation.started": m("send", "settle", S(card, tl)),
  "confirmation.routed": m(null, "quiet", S(tl)),
  "confirmation.sent": m("send", "settle", S(card, tl)),
  "confirmation.escalated": m(null, "tip", S(card, q, tl)),
  "confirmation.no_answer": m(null, "tip", S(q, tl)),
  "order.ready_to_ship": m(null, "done", S(list, tl), { mergeKey: "list" }),
  "order.auto_ship_blocked": m(null, "tip", S(card, bell, tl)),
  "offer.proposed": m("write", "settle", S(btn, tst, card, tl)),
  "offer.accepted": m(null, "merge", S(card, tl)),
  "offer.declined": m(null, "settle", S(card, tl)),
  "offer.expired": m(null, "settle", S(card, tl)),
  "offer.applied": m("send", "merge", S(card, tl)),
  "offer.failed": m(null, "fail", S(card, tl)),
  "whatsapp.template_submitted": m("send", "settle", S(btn, tst)),
  "order.packed": m("write", "done", S(tl, list)),
  "order.partially_delivered": m(null, "tip", S(card, tl)),
  "order.refused": m(null, "fail", S(card, tl)),

  // ── Shipping ──
  "shipment.created": m("send", "done", S(btn, card, list, tl)),
  "shipment.booking_failed": m(null, "fail", S(card, list, tl)),
  "shipment.status_changed": m(null, "settle", S(list, tl), { mergeKey: "list" }),
  "shipment.needs_review": m(null, "tip", S(q)),
  "shipment.delivered": m(null, "done", S(list, tl, kpi, inst), { mergeKey: "list" }),
  "shipment.returned": m(null, "fail", S(list, tl, kpi), { mergeKey: "list" }),
  "picklist.created": m("write", "settle", S(btn, tst, list)),
  "picklist.closed": m("write", "done", S(btn, tst, list)),

  // ── Stock ──
  "stock.reserved": m(null, "quiet", S(card)),
  "stock.released": m(null, "quiet", S(card)),
  "stock.short": m(null, "tip", S(card, bell)),
  "stock.received": m("write", "done", S(tst, list, inst)),
  "stock.adjusted": m("write", "settle", S(btn, tst, inst), { variant: matched }),
  "stock.changed": m(null, "quiet", S()),
  "stock.low": m(null, "tip", S(list, bell), { mergeKey: "list" }),
  "stock.out": m(null, "tip", S(list, bell), { mergeKey: "list" }),
  "stock.reorder_suggested": m(null, "settle", S(list), { mergeKey: "list" }),

  // ── Profit and money ──
  "pnl.recomputed": m("read", "quiet", S(card, kpi), { variant: pnlFinal, mergeKey: "store" }),
  "costs.changed": m("write", "settle", S(btn, tst)),
  "fx.rate_overridden": m("write", "settle", S(btn, tst)),
  "ads.spend_changed": m("write", "settle", S(btn, tst, inst)),
  "payment.received": m("write", "drop", S(card, list, kpi, tst)),
  "payment.failed": m(null, "fail", S(card, list)),
  "payment.link_sent": m("write", "settle", S(btn, tst, card)),
  "payment.link_paid": m(null, "drop", S(card, tl, kpi)),
  "refund.created": m("write", "settle", S(btn, tst, list)),
  "refund.approved": m("write", "done", S(btn, tst, list)),
  "refund.rejected": m("write", "settle", S(btn, tst, list)),
  "refund.completed": m("write", "done", S(tst, card, kpi)),
  "dispute.opened": m(null, "tip", S(list, bell)),
  "dispute.evidence_submitted": m("write", "settle", S(btn, tst, list)),
  "dispute.closed": m(null, "settle", S(list), { variant: disputeResult }),
  "settlement.matched": m("sync", "merge", S(inst, list)),
  "settlement.gap_found": m(null, "tip", S(inst, bell)),

  // ── Returns, tickets, purchasing, catalogue, bulk ──
  "ticket.created": m("write", "settle", S(btn, tst, list, card)),
  "ticket.status_changed": m("write", "settle", S(btn, tst, card)),
  "ticket.assigned": m("write", "settle", S(card)),
  "return.inspected": m("write", "done", S(btn, tst, card, tl)),
  "exchange.created": m("write", "done", S(btn, tst, card, tl)),
  "exchange.returned": m(null, "merge", S(card)),
  "po.approved": m("write", "done", S(btn, tst, list)),
  "po.sent": m("write", "settle", S(btn, tst, list)),
  "po.cancelled": m("write", "settle", S(btn, tst, list)),
  "po.received": m("write", "done", S(tst, list, inst), { variant: poFull }),
  "product.created": m("write", "settle", S(btn, tst, list)),
  "product.updated": m("write", "settle", S(btn, tst)),
  "product.published": m("send", "done", S(card)),
  "product.publish_failed": m(null, "fail", S(card)),
  "orders.bulk_requested": m("write", "quiet", S(card)),
  "orders.bulk_continue": m("write", "quiet", S(card)),
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
  Object.entries(SPECS).map(([type, s]) => [type, {
    audience: "merchant", ...s, ...(s.action ? { pending: LOADER_FOR[s.action] as Pending } : {}), copy: hasCopy(s) ? `motion.event.${type}` : null,
  } satisfies MotionRule]),
) as Record<DomainEventType, MotionRule>;

/** Events the viewer's own action can start: they carry an action, so a pending loader. */
export type PendingEvent = { [K in keyof typeof SPECS]: (typeof SPECS)[K] extends { action: RowAction } ? K : never }[keyof typeof SPECS];

/**
 * Outbound-looking event names whose action is a write in Mizan, with the reason. test/motion.test.ts
 * checks that every other *_submitted, *_sent, .sent, .published, .connected, .applied or .synced
 * row sends or syncs, and pins the outbound rows a name cannot show (shipment.created and others).
 */
export const OUTBOUND_WRITE_EXCEPTIONS: Readonly<Record<string, string>> = {
  "dispute.evidence_submitted": "recorded in Mizan; the store submits the evidence on the gateway's own portal",
  "po.sent": "marks the purchase order sent in Mizan; the supplier gets it outside Mizan",
  "payment.link_sent": "creating a payment link is a write in Mizan (Brand 2.0: a payment link is DROP)",
};

/**
 * Waits that are not a domain event (a page or the session loading, the screens before a store):
 * what is happening, as an action. Loading, signing in and checking = pair (waiting for an answer);
 * syncing two systems and sending something out (a code, a link, a push) = transfer; saving and
 * creating = drop (a write in Mizan); known progress = FillProgress with a value, never a wait
 * meaning. The confirmed end (signed in) is DoneState.
 */
export const WAIT_ACTION = {
  loading: "read", signingIn: "read", checking: "read",
  syncing: "sync", sending: "send",
  saving: "write", creating: "write",
} as const satisfies Record<string, RowAction>;
export type WaitMeaning = keyof typeof WAIT_ACTION;
/** The loader each wait plays, derived from WAIT_ACTION through LOADER_FOR: both tables share one rule. */
export const WAIT_MOTION = Object.fromEntries(Object.entries(WAIT_ACTION).map(([k, a]) => [k, LOADER_FOR[a]])) as {
  readonly [K in WaitMeaning]: (typeof LOADER_FOR)[(typeof WAIT_ACTION)[K]];
};

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
