import { EVENT_MOTION } from "./catalogue.js";
import { ENGINE_MOTION, type EngineEventType } from "./engine.js";
import { TIMELINE_MOTION, type OrderEventType } from "./timeline.js";
import type { EventData, MotionRule, Outcome, ResolvedMotion, Variant } from "./model.js";
import type { DomainEventType } from "../events.js";

const warned = new Set<string>();
const dev = () => { try { return process.env.NODE_ENV !== "production"; } catch { return false; } };

function pickVariant(v: Variant | undefined, data: EventData | undefined): { outcome?: Outcome; select?: { arg: string; value: string } } {
  if (!v) return {};
  const branch = v.pick(data ?? {});
  const outcome = v.outcomes[branch] ?? v.outcomes.other;
  return { outcome, select: { arg: v.arg, value: branch in v.outcomes ? branch : "other" } };
}

/**
 * The one lookup surfaces use: an event type (and its non-PII facts) → what it plays, where, with
 * which copy. A variant picks its branch; an unknown type settles quietly (and warns in development).
 */
export function motionFor(type: string, data?: EventData): ResolvedMotion {
  const rule = (EVENT_MOTION as Record<string, MotionRule>)[type];
  if (!rule) {
    if (dev() && !warned.has(type)) { warned.add(type); console.warn(`[mizan motion] no catalogue row for "${type}": settle`); }
    return { type, outcome: "settle", surfaces: [], audience: "merchant", copy: null, red: false, unknown: true };
  }
  const v = pickVariant(rule.variant, data);
  const outcome = v.outcome ?? rule.outcome;
  return {
    type, outcome, surfaces: rule.surfaces, audience: rule.audience, copy: rule.copy, red: outcome === "drop",
    ...(rule.pending ? { pending: rule.pending } : {}), ...(v.select ? { select: v.select } : {}), ...(rule.mergeKey ? { mergeKey: rule.mergeKey } : {}),
  };
}

/** A timeline row's outcome and copy key. */
export function timelineMotion(type: OrderEventType) {
  return TIMELINE_MOTION[type];
}

/** An engine event's outcome on the staff surfaces (static glyphs). */
export function engineMotion(type: EngineEventType, data?: EventData): { outcome: Outcome; twin?: DomainEventType } {
  const rule = ENGINE_MOTION[type];
  const v = pickVariant("variant" in rule ? rule.variant : undefined, data);
  return { outcome: v.outcome ?? rule.outcome, ...("twin" in rule && rule.twin ? { twin: rule.twin } : {}) };
}
