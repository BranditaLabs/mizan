"use client";

import type { MotionDispatch } from "@mizan/design-system/motion";
import { RedBudgetProvider } from "@mizan/design-system/react/motion";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useToast } from "@/components/ui/Toast";
import { createEventMotion, type EventMotion } from "./engine";

export type { EventMotion, OwnSuccess } from "./engine";

const Ctx = createContext<EventMotion | null>(null);

/** Outside the provider (a unit test, a page without the shell) nothing animates. */
const SILENT: EventMotion = {
  push: () => "unmounted", ownSuccess: () => undefined, subscribe: () => () => undefined,
  isFresh: () => false, version: () => 0, onVersion: () => () => undefined,
  setToaster: () => undefined, setHidden: () => undefined, dispose: () => undefined,
};

/**
 * The one place that turns facts into motion (docs/16 §2.x, Brand 2.0). Screens never pick an
 * animation: a mutation names its catalogue event (useEventMutation), a poll names the transition
 * it saw (usePollMotion), and this provider looks the event up in @mizan/shared's catalogue, runs
 * it through the scheduler (seen ids, echo, merge, rate limits, storm, hidden tab) and hands the
 * outcome to the surfaces that are mounted.
 *
 * Privacy: the scheduler keeps event ids, types and timestamps only; nothing goes to storage.
 */
export function EventMotionProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [motion] = useState(createEventMotion);
  useEffect(() => { motion.setToaster(toast.event); return () => motion.setToaster(null); }, [motion, toast]);

  // Hidden tab: nothing plays; on return the bell gets one summary.
  useEffect(() => {
    const sync = () => motion.setHidden(document.visibilityState === "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => { document.removeEventListener("visibilitychange", sync); };
  }, [motion]);
  useEffect(() => () => motion.dispose(), [motion]);

  return <Ctx.Provider value={motion}>{children}</Ctx.Provider>;
}

/** One red per view: the budget every red holder (toasts included) claims from, reset on each route. */
export function ViewRedBudget({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <RedBudgetProvider resetKey={pathname}>{children}</RedBudgetProvider>;
}

export function useEventMotion(): EventMotion {
  return useContext(Ctx) ?? SILENT;
}

/** The newest dispatch for one surface (one at a time: a newer one replaces the older). */
export function useSurface(surface: string, filter?: (d: MotionDispatch) => boolean): MotionDispatch | null {
  const motion = useEventMotion();
  const [last, setLast] = useState<MotionDispatch | null>(null);
  const keep = useRef(filter);
  useEffect(() => { keep.current = filter; }, [filter]);
  useEffect(() => motion.subscribe(surface, (d) => { if (!keep.current || keep.current(d)) setLast(d); }), [motion, surface]);
  return last;
}

/** True only when the scheduler dispatched this event id in the last 5 s (rows play their glyph then). */
export function useFresh(id: string | undefined): boolean {
  const motion = useEventMotion();
  const v = useSyncExternalStore(motion.onVersion, motion.version, () => 0);
  void v;
  return id ? motion.isFresh(id) : false;
}

/** Marks a surface as mounted (its rows read freshness with useFresh instead of a dispatch). */
export function useSurfaceMounted(surface: string) {
  const motion = useEventMotion();
  useEffect(() => motion.subscribe(surface, () => undefined), [motion, surface]);
}
