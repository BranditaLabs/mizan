"use client";

import type { ReactNode } from "react";
import { GlassRoot } from "../GlassRoot";
import { ThemedWordmark } from "../Wordmark";

/**
 * Mizan's loaders, from Mizan Glass (packages/design-system/docs/glass.md "Loaders").
 *
 * - `<ScaleLoader>`: the scale (Mizan means "the scale") weighing, the pans level, the red point the
 *   fulcrum. For profit, reconciliation, reports and the app's first load.
 * - `<BootLoader>`: the whole screen while the session and the store open: the scale over the light
 *   fields, the wordmark and a sync rail.
 * - `<LedgerBars>`: three weights settling, inline (buttons, cells, chips).
 *
 * Reduced motion keeps them moving slowly rather than freezing (a wait still reads as a wait).
 */
export function ScaleLoader({ label, size = 1 }: { label?: ReactNode; size?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-5">
      <div className="ld-scale" aria-hidden="true" style={size !== 1 ? { transform: `scale(${size})` } : undefined}>
        <div className="post" />
        <div className="base" />
        <div className="beam">
          <div className="pan l"><i /><i /><b /></div>
          <div className="pan r"><i /><i /><b /></div>
        </div>
        <div className="pivot" />
      </div>
      {label ? <p className="text-body-sm text-text-2">{label}</p> : null}
    </div>
  );
}

export function BootLoader({ label }: { label: ReactNode }) {
  return (
    <GlassRoot className="fixed inset-0 z-50">
      <div className="ld-rail fixed inset-x-0 top-0" aria-hidden="true" />
      <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
        <ScaleLoader label={label} />
        <ThemedWordmark className="opacity-70" />
      </div>
    </GlassRoot>
  );
}

export function LedgerBars() {
  return <span className="ld-bars" aria-hidden="true"><i /><i /><i /></span>;
}
