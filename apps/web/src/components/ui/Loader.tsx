"use client";

import { MizanLoader } from "@mizan/design-system/react/motion";
import type { ReactNode } from "react";
import { useBrandCopy } from "@/lib/motion/useBrandCopy";
import { GlassRoot } from "../GlassRoot";
import { BrandLockup } from "../Wordmark";

/**
 * The whole screen while the session and the store open (Brand 2.0): the 120 px pair loader in the
 * brand tone (the view's one red), the lockup and "Getting your store ready". Reduced motion shows
 * the pair at rest, level and apart, as in the mark. Every other wait goes through PageState
 * (QueryState.tsx), a busy Button or FillProgress: screens never draw their own spinner.
 */
export function BootLoader({ label }: { label?: ReactNode }) {
  const copy = useBrandCopy();
  return (
    <GlassRoot className="fixed inset-0 z-50">
      <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-text" data-testid="boot-loader">
        <MizanLoader kind="pair" size={120} tone="brand" label={typeof label === "string" ? label : copy.loader.boot} />
        <p className="text-body-sm text-text-2">{label ?? copy.loader.boot}</p>
        <BrandLockup tone="mono" className="opacity-70" height={22} />
      </div>
    </GlassRoot>
  );
}
