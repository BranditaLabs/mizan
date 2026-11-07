"use client";

import { MizanLoader } from "@mizan/design-system/react/motion";
import type { Pending } from "@mizan/shared/motion";
import type { ReactNode } from "react";
import { useBrandCopy } from "@/lib/motion/useBrandCopy";
import { GlassRoot } from "../GlassRoot";
import { BrandLockup } from "../Wordmark";

/**
 * The whole screen while the session and the store open (Brand 2.0): the 120 px pair loader in the
 * brand tone (the view's one red), the lockup and "Getting your store ready". Reduced motion shows
 * the pair at rest, the two drops met at level (the mark). Every other wait goes through PageState
 * (QueryState.tsx), a busy Button or FillProgress: screens never draw their own spinner.
 */
export function BootLoader({ label }: { label?: ReactNode }) {
  const copy = useBrandCopy();
  return (
    <GlassRoot className="fixed inset-0 z-50">
      <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-text" data-testid="boot-loader">
        <MizanLoader kind="pair" size={120} tone="brand" decorative />
        {/* The visible line is the status (announced once), not a second hidden copy of it. */}
        <p role="status" className="text-body-sm text-text-2">{label ?? copy.loader.boot}</p>
        <BrandLockup tone="mono" className="opacity-70" height={22} />
      </div>
    </GlassRoot>
  );
}

/** What a wait is, in the brand's words: the loader follows the meaning (docs/16, Brand 2.0 loaders). */
export type WaitMeaning = "loading" | "syncing" | "saving";
const KIND: Record<WaitMeaning, Pending> = { loading: "pair", syncing: "transfer", saving: "drop" };

/**
 * An inline wait next to its own words (a status line, a live mark): the surface picks the loader
 * from what is happening, never the screen. loading = pair, syncing between two systems = transfer,
 * saving or sending = drop. Mono and decorative: the line it sits in carries the text (role=status
 * when `live`). `still` shows the end frame (a live mark at rest).
 */
export function Waiting({ meaning = "loading", size = 28, still, live, children, className }: { meaning?: WaitMeaning; size?: number; still?: boolean; live?: boolean; children?: ReactNode; className?: string }) {
  const mark = <MizanLoader kind={KIND[meaning]} size={size} still={still} decorative />;
  if (children === undefined) return <span className={className} aria-hidden="true">{mark}</span>;
  return (
    <p role={live ? "status" : undefined} className={className ?? "flex items-center gap-2.5 text-body-sm text-text-2"}>
      {mark}
      {children}
    </p>
  );
}
