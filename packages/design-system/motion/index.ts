/**
 * @mizan/design-system/motion: the Brand 2.0 motion core, plain TypeScript with no DOM access at
 * module scope. One clock, the reduced-motion store, the fluid physics of every loader and
 * instrument, the red budget, the event-motion scheduler and figure formatting.
 * The React components are in ./react/motion; the event catalogue is in @mizan/shared (motion).
 */
export { MotionClock, GOO_SLOTS, type Tick } from "./clock";
export { getReduced, getServerReduced, subscribeReduced, forceReduced } from "./reduced";
export { M as MOTION, SPRING, GOO, spring, springC, clamp, gooMatrix, type Attrs, type Spring } from "./spring";
export { RedBudget, RED_PRIORITY, defaultRedBudget } from "./red-budget";
export { createScheduler, LIMITS, BATCHED_COPY, type MotionDispatch, type MotionInput, type MotionScheduler, type MotionSource, type MergeKey, type PushResult, type ResolvedRule, type SchedulerOptions } from "./scheduler";
export { formatInt, formatMoney, formatPct, formatDeg, isolate, MINUS } from "./format";
export * as pair from "./physics/pair";
export * as level from "./physics/level";
export * as transfer from "./physics/transfer";
export * as drop from "./physics/drop";
export * as fill from "./physics/fill";
export * as gauge from "./physics/gauge";
export * as vessels from "./physics/vessels";
export * as breakeven from "./physics/breakeven";
export * as bullseye from "./physics/bullseye";

/** What a loader means (Brand 2.0): pair = page or data loading, transfer = syncing two systems, drop = saving, confirming or sending, fill = known progress. level is the gallery's spirit level. */
export type LoaderKind = "pair" | "transfer" | "drop" | "fill" | "level";
/** What an event's outcome renders as (the catalogue's Outcome). */
export type MotionOutcome = "quiet" | "settle" | "done" | "merge" | "tip" | "fail" | "drop";
