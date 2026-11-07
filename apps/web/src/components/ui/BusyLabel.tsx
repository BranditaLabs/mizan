"use client";

import { MizanLoader } from "@mizan/design-system/react/motion";
import type { Pending } from "@mizan/shared/motion";
import { useState, type ReactNode } from "react";
import { pendingFor } from "@/lib/motion/resolve";
import { cx } from "./logic";

/** The loader inside a busy control: mono (currentColor), decorative (the control carries aria-busy). */
export function BusyLoader({ event, pending, size }: { event?: string; pending?: Pending; size?: number }) {
  const kind = pending ?? pendingFor(event);
  return <MizanLoader kind={kind} size={size ?? (kind === "fill" ? 44 : 24)} tone="mono" decorative />;
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
