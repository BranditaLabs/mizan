"use client";

import { MizanLoader } from "@mizan/design-system/react/motion";
import { WAIT_MOTION, type Pending, type WaitMeaning } from "@mizan/shared/motion";
import { useState, type ReactNode } from "react";
import { pendingFor } from "@/lib/motion/resolve";
import { cx } from "./logic";

/** A loader a busy control can play: a wait has no value, so never FILL (that is FillProgress). */
export type BusyKind = Exclude<Pending, "fill">;

/**
 * The loader for a busy control: the named meaning (WAIT_MOTION) wins, else the event's own pending
 * loader. Neither: undefined (no loader, and a dev warning), never a default animation.
 */
export function busyLoaderKind(as: WaitMeaning | undefined, event: string | undefined): BusyKind | undefined {
  const kind = as ? WAIT_MOTION[as] : pendingFor(event);
  if (kind === "fill") return undefined;
  if (!kind && process.env.NODE_ENV !== "production") console.warn(`[mizan motion] a busy control names no meaning (event ${event ?? "none"}): pass as=`);
  return kind;
}

/**
 * The loader inside a busy control: mono (currentColor), decorative (the control carries
 * aria-busy). Only components/ui pass a loader directly; screens name a meaning (Button `as`).
 */
export function BusyLoader({ pending, size }: { pending: BusyKind; size?: number }) {
  return <MizanLoader kind={pending} size={size ?? 24} tone="mono" decorative />;
}

/**
 * A control's label: transparent (keeping the width) while busy, settling back in when the work ends.
 * opacity, not visibility: a hidden label would leave the busy button with no accessible name.
 */
export function BusyLabel({ busy, children, className }: { busy: boolean; children: ReactNode; className?: string }) {
  // The label that returns after a busy spell settles in (state adjusted during render, no effect).
  const [prev, setPrev] = useState(busy);
  const [settle, setSettle] = useState(false);
  if (prev !== busy) { setPrev(busy); setSettle(prev && !busy); }
  return <span className={cx("inline-flex items-center gap-2", busy && "opacity-0", settle && "mz-settle-in", className)}>{children}</span>;
}
