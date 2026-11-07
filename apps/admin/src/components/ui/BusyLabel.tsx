"use client";

import { MizanLoader } from "@mizan/design-system/react/motion";
import type { Pending } from "@mizan/shared/motion";
import { useState, type ReactNode } from "react";
import { cx } from "./logic";

/** The loader inside a busy control: mono (currentColor), decorative (the control carries aria-busy). */
export function BusyLoader({ pending = "drop", size }: { pending?: Pending; size?: number }) {
  return <MizanLoader kind={pending} size={size ?? (pending === "fill" ? 44 : 24)} tone="mono" decorative />;
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
