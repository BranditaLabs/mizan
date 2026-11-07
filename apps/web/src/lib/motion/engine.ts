import { createScheduler, getReduced, type MotionDispatch, type MotionInput, type PushResult, type SchedulerOptions } from "@mizan/design-system/motion";
import type { EventData } from "@mizan/shared/motion";
import type { ReactNode } from "react";
import { eventMotion, resolveRule, toastsOnSuccess } from "./resolve";

export type Listener = (d: MotionDispatch) => void;

/** A toast confirming the viewer's own action (the ToastProvider's `toast.event`). */
export type EventToaster = (e: {
  type: string | null;
  data?: EventData;
  values?: Record<string, string | number>;
  message?: ReactNode;
  action?: { label: string; onClick(): void };
  /** The engine's decision when it differs from the catalogue (a DROP inside the 3 s gap shows "done"). */
  outcome?: "done";
}) => void;

/** What a mutation's success hands the motion engine (lib/api/query.tsx reads it from `meta.motion`). */
export interface OwnSuccess {
  type: string;
  entityId?: string;
  data?: EventData;
  values?: Record<string, string | number>;
  message?: ReactNode;
  /** false: the screen says nothing (it shows the result in place). */
  toast?: boolean;
  /** The screen asked for the toast itself (toast.event): it shows even for a type that does not toast by default. */
  explicit?: boolean;
  action?: { label: string; onClick(): void };
}

export interface EventMotion {
  /** A fact from a poll or (BR-4) the live stream: deduped, merged, rate-limited, then dispatched. */
  push(ev: MotionInput): PushResult;
  /** The viewer's own action succeeded: its toast now, the other surfaces through the scheduler. */
  ownSuccess(s: OwnSuccess): void;
  /** A surface listens while it is mounted (an unmounted surface drops its dispatches). */
  subscribe(surface: string, fn: Listener): () => void;
  /** The scheduler dispatched this id in the last 5 s: a row plays its glyph on mount. */
  isFresh(id: string): boolean;
  /** Bumps whenever a dispatch lands, so freshness re-reads. */
  version(): number;
  onVersion(fn: () => void): () => void;
  setToaster(t: EventToaster | null): void;
  setHidden(hidden: boolean): void;
  dispose(): void;
}

/**
 * The event-motion engine behind EventMotionProvider, plain TypeScript (tested without React): the
 * catalogue lookup (resolve.ts), the design system's scheduler and the surface registry.
 */
export function createEventMotion(opts: Partial<Pick<SchedulerOptions, "now" | "setTimer" | "clearTimer" | "isReduced">> = {}): EventMotion {
  const listeners = new Map<string, Set<Listener>>();
  const vlisteners = new Set<() => void>();
  let version = 0;
  let toaster: EventToaster | null = null;
  const scheduler = createScheduler({
    resolve: (type, data) => resolveRule(type, data as EventData | undefined),
    dispatch: (d) => {
      for (const s of d.surfaces) for (const fn of listeners.get(s) ?? []) fn(d);
      version++;
      for (const l of vlisteners) l();
    },
    isMounted: (s) => (listeners.get(s)?.size ?? 0) > 0,
    isReduced: opts.isReduced ?? getReduced,
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.setTimer ? { setTimer: opts.setTimer } : {}),
    ...(opts.clearTimer ? { clearTimer: opts.clearTimer } : {}),
  });
  return {
    push: (ev) => scheduler.push(ev),
    ownSuccess: ({ type, entityId, toast: say = true, explicit, data, values, message, action }) => {
      if (entityId) scheduler.recordLocalSuccess(type, entityId);
      // The viewer's own action is confirmed at once (not queued), but a DROP still keeps the 3 s
      // DROP gap (a second one settles as "done"); the rest of its surfaces (a card, a KPI, the
      // timeline) go through the scheduler like any other fact.
      if (say && (explicit || toastsOnSuccess(type) || message)) {
        const done = eventMotion(type, data).outcome === "drop" && !scheduler.claimDrop();
        toaster?.({ type, ...(data ? { data } : {}), ...(values ? { values } : {}), ...(message ? { message } : {}), ...(action ? { action } : {}), ...(done ? { outcome: "done" as const } : {}) });
      }
      scheduler.push({ type, entityId, at: Date.now(), source: "mutation", data });
    },
    subscribe: (surface, fn) => {
      const set = listeners.get(surface) ?? new Set<Listener>();
      set.add(fn);
      listeners.set(surface, set);
      return () => { set.delete(fn); };
    },
    isFresh: (id) => scheduler.isFresh(id),
    version: () => version,
    onVersion: (fn) => { vlisteners.add(fn); return () => { vlisteners.delete(fn); }; },
    setToaster: (t) => { toaster = t; },
    setHidden: (h) => scheduler.setHidden(h),
    dispose: () => scheduler.dispose(),
  };
}
