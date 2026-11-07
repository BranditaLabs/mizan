"use client";

import { MizanLoader } from "@mizan/design-system/react/motion";
import { WAIT_MOTION, type Pending, type WaitMeaning } from "@mizan/shared/motion";
import { useState, type ReactNode } from "react";
import { cx } from "./logic";

/** A loader a busy control can play: a wait has no value, so never FILL (that is FillProgress). */
export type BusyKind = Exclude<Pending, "fill">;

/** The loader for what a busy control is doing (WAIT_MOTION): no default, never FILL. */
export const busyKind = (as: WaitMeaning): BusyKind => WAIT_MOTION[as];

/**
 * The loader inside a busy control: mono (currentColor), decorative (the control carries
 * aria-busy). `pending` is required: a busy control says what it is doing (Button `as`).
 */
export function BusyLoader({ pending, size }: { pending: BusyKind; size?: number }) {
  return <MizanLoader kind={pending} size={size ?? 24} tone="mono" decorative />;
}

/**
 * A control's label: transparent (keeping the width) while busy, settling back in when the work ends.
 * opacity, not visibility: a hidden label would leave the busy button with no accessible name.
 */
export function BusyLabel({ busy, children, className }: { busy: boolean; children: ReactNode; className?: string }) {
  const [prev, setPrev] = useState(busy);
  const [settle, setSettle] = useState(false);
  if (prev !== busy) { setPrev(busy); setSettle(prev && !busy); }
  return <span className={cx("inline-flex items-center gap-2", busy && "opacity-0", settle && "mz-settle-in", className)}>{children}</span>;
}
