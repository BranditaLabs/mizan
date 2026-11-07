import type { ResolvedRule } from "@mizan/design-system/motion";
import { EVENT_MOTION, ENGINE_MOTION, TIMELINE_MOTION, engineMotion, isEngineEventType, isOrderEventType, motionFor, type EventData, type Outcome, type Pending } from "@mizan/shared/motion";

/**
 * The surfaces' side of the catalogue (@mizan/shared motion): one lookup for every kind of fact.
 *   "order.confirmed"        a domain event (EVENT_MOTION, variants applied)
 *   "timeline.<type>"        an order_events row (TIMELINE_MOTION), shown on the timeline only
 *   "engine.<type>"          an engine event (ENGINE_MOTION), staff surfaces only, never animated for merchants
 *   "bell.<type>"            a new notification row reporting that domain event, shown in the bell only
 * The toast is never a scheduled surface: it confirms the viewer's own action (ownSuccess), at once.
 */
export const isDomainEvent = (type: string): type is keyof typeof EVENT_MOTION => Object.hasOwn(EVENT_MOTION, type);

export function resolveRule(type: string, data?: EventData): ResolvedRule {
  if (type.startsWith("timeline.")) {
    const row = type.slice("timeline.".length);
    if (!isOrderEventType(row)) return { outcome: "quiet", surfaces: [], copy: null };
    const rule = TIMELINE_MOTION[row];
    return { outcome: rule.outcome, surfaces: ["timeline"], copy: rule.copy, mergeKey: "list" };
  }
  if (type.startsWith("engine.")) {
    const e = type.slice("engine.".length);
    if (!isEngineEventType(e)) return { outcome: "quiet", surfaces: [], copy: null };
    return { outcome: engineMotion(e, data).outcome, surfaces: [], copy: null };
  }
  if (type.startsWith("bell.")) {
    const e = type.slice("bell.".length);
    const outcome = isDomainEvent(e) ? motionFor(e, data).outcome : "settle";
    return { outcome: outcome === "quiet" ? "settle" : outcome, surfaces: ["bell"], copy: null, mergeKey: "store" };
  }
  if (!isDomainEvent(type)) return { outcome: "quiet", surfaces: [], copy: null };
  const m = motionFor(type, data);
  return {
    outcome: m.outcome, surfaces: m.surfaces.filter((s) => s !== "toast"), copy: m.copy,
    ...(m.mergeKey ? { mergeKey: m.mergeKey } : {}), ...(m.select ? { select: m.select.value } : {}),
  };
}

/** What a domain event plays and says, for a toast or a row (unknown → a neutral settle, no copy). */
export function eventMotion(type: string, data?: EventData): { outcome: Outcome; copy: string | null; values: Record<string, string>; pending?: Pending } {
  if (!isDomainEvent(type)) return { outcome: "settle", copy: null, values: {} };
  const m = motionFor(type, data);
  return { outcome: m.outcome, copy: m.copy, values: m.select ? { [m.select.arg]: m.select.value } : {}, ...(m.pending ? { pending: m.pending } : {}) };
}

/**
 * The loader a busy control shows for its event: the catalogue's `pending`, derived from what the
 * action does. An event with no action (it comes from outside), an unknown type or none: undefined.
 * Never a default: the control must then name a meaning (Button `as`).
 */
export function pendingFor(type: string | undefined): Pending | undefined {
  if (!type || !isDomainEvent(type)) return undefined;
  return motionFor(type).pending;
}

/** A timeline row's outcome (exhaustive over order_events types; an unknown row settles). */
export const timelineOutcome = (type: string): Outcome => (isOrderEventType(type) ? TIMELINE_MOTION[type].outcome : "settle");

/** An engine event's outcome on a staff list (static glyph). */
export const engineOutcome = (type: string): Outcome => (isEngineEventType(type) ? ENGINE_MOTION[type].outcome : "settle");

/**
 * A notification's source → the domain event it reports (the bell's rows are written by
 * notify.team and the alerts, whose `source` is the event type or a short alert name).
 */
export function bellEvent(source: string, text: string): string | null {
  if (isDomainEvent(source)) return source;
  if (source === "plan.limit") return "plan.limit_reached";
  if (source === "after_confirmation") {
    const kind = text.split("|")[0] ?? "";
    if (kind === "blocked") return "order.auto_ship_blocked";
    if (kind === "confirmed") return "order.confirmed";
    if (kind === "cancelled" || kind === "auto_cancelled") return "order.cancelled";
    if (kind === "no_answer" || kind === "followup_dead") return "confirmation.no_answer";
    return "confirmation.escalated";
  }
  return null;
}

/** Whether the viewer's own success of this event confirms in a toast (the catalogue's "toast" surface). */
export const toastsOnSuccess = (type: string): boolean => isDomainEvent(type) && motionFor(type).surfaces.includes("toast");
