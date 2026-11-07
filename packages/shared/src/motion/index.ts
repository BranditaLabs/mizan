/**
 * The event-motion catalogue: every domain event, order timeline row and engine event mapped to one
 * motion rule. Surfaces (apps/web lib/motion) look events up here; screens never pick an animation.
 * The physics and components that play the outcomes are in @mizan/design-system (motion, react/motion).
 */
export * from "./model.js";
export { EVENT_MOTION, DROP_ALLOWLIST, outcomesOf } from "./catalogue.js";
export { TIMELINE_MOTION, ORDER_EVENT_TYPES, isOrderEventType, type OrderEventType, type TimelineRule } from "./timeline.js";
export { ENGINE_MOTION, ENGINE_EVENT_TYPES, isEngineEventType, type EngineEventType, type EngineRule } from "./engine.js";
export { motionFor, timelineMotion, engineMotion } from "./resolve.js";
