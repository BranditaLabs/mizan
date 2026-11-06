import type { AfterConfirmation } from "@mizan/shared";

/** A release that waited this many times for an offer or edit to settle goes on without booking. */
export const MAX_DEFERRALS = 12;
export const DEFER_MINUTES = 5;

export type ReleaseDecision =
  | { kind: "skip"; code: "order_moved" | "held_by_customer" }
  | { kind: "defer" }
  | { kind: "released"; code: "released" | "setting_off" | "offer_settling" }
  | { kind: "blocked"; code: "payment_mode_not_allowed" | "stock_short" | "duplicate_suspected" }
  | { kind: "book"; expireOffer: boolean };

/**
 * When a confirmed order's follow-up fires (the grace window ended, or at once when auto-book is
 * on): let it go, wait for an offer or edit in flight, refuse to book, or hand it to shipping.
 * The live settings decide, so a setting turned off since wins. Booking itself checks again
 * (cashToCollect decides the money, rule 13).
 */
export function decideRelease(i: {
  order: { status: string; paymentMode: string; stockStatus: string | null; duplicateStatus: string | null; holdReason: string | null };
  autoBook: boolean; deferrals: number; settling: boolean; offerProposed: boolean; settings: AfterConfirmation;
}): ReleaseDecision {
  if (i.order.status !== "confirmed") return { kind: "skip", code: "order_moved" };
  if (i.order.holdReason === "customer_message") return { kind: "skip", code: "held_by_customer" };
  if (i.settling) return i.deferrals < MAX_DEFERRALS ? { kind: "defer" } : { kind: "released", code: "offer_settling" };
  if (!i.autoBook) return { kind: "released", code: "released" };
  const ab = i.settings.confirmed.autoBook;
  if (!ab.enabled) return { kind: "released", code: "setting_off" };
  if (i.order.paymentMode === "unknown" || !ab.paymentModes.includes(i.order.paymentMode)) return { kind: "blocked", code: "payment_mode_not_allowed" };
  if (i.order.stockStatus === "short") return { kind: "blocked", code: "stock_short" };
  if (i.order.duplicateStatus === "suspected") return { kind: "blocked", code: "duplicate_suspected" };
  return { kind: "book", expireOffer: i.offerProposed };
}

/** Run reasons that mean a person decides, never an automatic cancel. */
const PERSON_DECIDES = new Set(["hold", "high_risk", "change_requested", "customer_message", "manual"]);

export type NoAnswerDecision = { cancel: true } | { cancel: false; code: string };

/**
 * Cancel an order nobody answered, only when every guard holds: the setting is on now, the run
 * is still waiting with no answer, nothing asks for a person, the order is not past confirmation,
 * no money was paid, and (unless the store says so) nobody on the team has taken it.
 */
export function decideNoAnswerCancel(i: {
  settings: AfterConfirmation;
  run: { status: string; outcome: string | null; reason: string | null } | null;
  order: { status: string; paidMinor: bigint; assignedTo: string | null };
}): NoAnswerDecision {
  const ac = i.settings.noAnswer.autoCancel;
  if (!ac.enabled) return { cancel: false, code: "setting_off" };
  if (!i.run || !["running", "needs_agent"].includes(i.run.status)) return { cancel: false, code: "run_finished" };
  if (i.run.outcome !== null && i.run.outcome !== "no_reply") return { cancel: false, code: "answered" };
  if (i.run.reason && PERSON_DECIDES.has(i.run.reason)) return { cancel: false, code: "person_decides" };
  if (!["new", "pending_confirmation"].includes(i.order.status)) return { cancel: false, code: "order_moved" };
  if (i.order.paidMinor > 0n) return { cancel: false, code: "paid" };
  if (i.order.assignedTo && !ac.cancelIfAssigned) return { cancel: false, code: "assigned" };
  return { cancel: true };
}

/** Whether a confirmation should book by itself (when the store turned auto-book on). */
export function autoBookIntent(s: AfterConfirmation, channel: string, changed: boolean): boolean {
  const ab = s.confirmed.autoBook;
  return ab.enabled && (ab.channels as readonly string[]).includes(channel) && (!changed || ab.afterChange);
}
