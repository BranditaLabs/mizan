import type { Plan } from "./plans.js";

/**
 * The subscription state machine (E12-2a1, docs/16 §7.3), as a table: each event names the states
 * it may start from and the state it leads to. SubscriptionService.transition() is the only caller
 * that writes; everything here is pure, so every edge is unit-tested.
 *
 *   (none) ─start_trial─► trialing ─trial_end─► expired (a new Free subscription opens: D3)
 *   incomplete (a checkout opened during the trial) ─trial_end─► expired: the trial still ends on time
 *   (none) ─start─► active                      trialing / past_due / restricted / incomplete ─pay_ok─► active
 *   active ─renewal_fail─► past_due ─grace_end─► restricted ─restricted_end─► expired
 *   active ─period_end_cancel─► cancelled       active ─pause─► paused ─resume─► active
 *   live ─checkout_open─► incomplete ─checkout_expired─► the state before
 *   trialing / active ─change_plan─► the same state, another plan; live ─staff_override─► active
 */
export const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "restricted", "paused", "cancelled", "expired", "incomplete"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Live = the store's one current subscription (a partial unique index holds it to one). */
export const LIVE_STATUSES: readonly SubscriptionStatus[] = ["trialing", "active", "past_due", "restricted", "paused", "incomplete"];
export const isLive = (s: SubscriptionStatus) => LIVE_STATUSES.includes(s);

export const SUBSCRIPTION_EVENTS = [
  "start_trial", "start", "trial_end", "pay_ok", "renewal_fail", "grace_end", "restricted_end",
  "cancel", "uncancel", "period_end_cancel", "pause", "resume", "checkout_open", "checkout_expired",
  "change_plan", "staff_override",
] as const;
export type SubscriptionEvent = (typeof SUBSCRIPTION_EVENTS)[number];

type From = "none" | readonly SubscriptionStatus[];
/** "same" keeps the status (a plan change, a cancel at period end); "previous" returns from incomplete. */
type To = SubscriptionStatus | "same" | "previous";

const RESTORABLE: readonly SubscriptionStatus[] = ["trialing", "active", "past_due", "restricted", "paused"];

export const TRANSITIONS: Record<SubscriptionEvent, { from: From; to: To }> = {
  start_trial: { from: "none", to: "trialing" },
  start: { from: "none", to: "active" },
  trial_end: { from: ["trialing", "incomplete"], to: "expired" }, // from incomplete only when the checkout opened during a trial
  pay_ok: { from: ["trialing", "past_due", "restricted", "incomplete"], to: "active" },
  renewal_fail: { from: ["active"], to: "past_due" },
  grace_end: { from: ["past_due"], to: "restricted" },
  restricted_end: { from: ["restricted"], to: "expired" },
  cancel: { from: ["active"], to: "same" },
  uncancel: { from: ["active"], to: "same" },
  period_end_cancel: { from: ["active"], to: "cancelled" },
  pause: { from: ["active"], to: "paused" },
  resume: { from: ["paused"], to: "active" },
  checkout_open: { from: RESTORABLE, to: "incomplete" },
  checkout_expired: { from: ["incomplete"], to: "previous" },
  change_plan: { from: ["trialing", "active"], to: "same" },
  staff_override: { from: RESTORABLE, to: "active" },
};

export class TransitionError extends Error {
  constructor(readonly event: SubscriptionEvent, readonly from: SubscriptionStatus | null) {
    super(`${event} is not allowed from ${from ?? "no subscription"}`);
    this.name = "TransitionError";
  }
}

/** Where `event` leads from `from` (null = no subscription yet). Throws TransitionError on an edge the table does not have. */
export function nextStatus(from: SubscriptionStatus | null, event: SubscriptionEvent, previous?: SubscriptionStatus | null): SubscriptionStatus {
  const t = TRANSITIONS[event];
  const allowed = t.from === "none" ? from === null : from !== null && t.from.includes(from);
  if (!allowed) throw new TransitionError(event, from);
  if (event === "trial_end" && from === "incomplete" && previous !== "trialing") throw new TransitionError(event, from);
  if (t.to === "same") return from!;
  if (t.to === "previous") {
    if (!previous || !RESTORABLE.includes(previous)) throw new TransitionError(event, from);
    return previous;
  }
  return t.to;
}

/**
 * The plan a subscription entitles (= tenants.plan). Trialing, active and past_due get their tier;
 * an open checkout keeps what the store had before; restricted, paused, cancelled and expired get Free.
 */
export function entitlementPlan(sub: { status: SubscriptionStatus; plan: Plan; previousStatus?: SubscriptionStatus | null }): Plan {
  const status = sub.status === "incomplete" ? (sub.previousStatus ?? "expired") : sub.status;
  return status === "trialing" || status === "active" || status === "past_due" ? sub.plan : "free";
}

const DAY = 86_400_000;

/** The calendar date (YYYY-MM-DD) of a moment in a time zone. */
export function localDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** The instant a local calendar date starts in a time zone (handles DST: the offset is read at that day). */
export function startOfLocalDay(date: string, timeZone: string): Date {
  const utc = Date.parse(`${date}T00:00:00Z`);
  // Two passes: the offset at a guess, then at the corrected instant.
  let t = utc;
  for (let i = 0; i < 2; i++) t = utc - offsetMs(new Date(t), timeZone);
  return new Date(t);
}

function offsetMs(at: Date, timeZone: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(at).map((x) => [x.type, x.value]));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - Math.floor(at.getTime() / 1000) * 1000;
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/**
 * When a trial that starts at `start` ends: 23:59:59 on day `days` in the store's time zone, the
 * start day being day 1. A 7-day trial started on a Monday afternoon in Cairo ends Sunday 23:59:59 Cairo.
 */
export function trialEndsAt(start: Date, timeZone: string, days: number): Date {
  return new Date(startOfLocalDay(addDays(localDate(start, timeZone), days), timeZone).getTime() - 1000);
}

/** Calendar days left in a trial, today included, in the store's time zone: 7 on day 1, 1 on the last day, 0 once over. */
export function trialDaysLeft(endsAt: Date, now: Date, timeZone: string): number {
  if (now >= endsAt) return 0;
  return Math.round((Date.parse(`${localDate(endsAt, timeZone)}T00:00:00Z`) - Date.parse(`${localDate(now, timeZone)}T00:00:00Z`)) / DAY) + 1;
}
