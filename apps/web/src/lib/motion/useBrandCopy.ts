"use client";

import type { BreakevenCopy, BullseyeCopy, GaugeCopy, VesselsCopy } from "@mizan/design-system/react/motion/instruments";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

/**
 * The Brand 2.0 components hold no strings: their copy comes from next-intl (`motion.*` in
 * messages/{ar,en}.json) through this hook, in the reader's language.
 */
export function useBrandCopy() {
  const t = useTranslations("motion");
  return useMemo(() => {
    const gauge: GaugeCopy = {
      title: t("gauge.title"), labelA: t("gauge.labelA"), labelB: t("gauge.labelB"), balanced: t("gauge.balanced"),
      shortBy: (pct) => t("gauge.shortBy", { pct }), overBy: (pct) => t("gauge.overBy", { pct }), tilt: (deg) => t("gauge.tilt", { deg }),
      summary: (p) => t("gauge.summary", p),
    };
    const vessels: VesselsCopy = {
      title: t("vessels.title"), labelA: t("vessels.labelA"), labelB: t("vessels.labelB"), matched: t("vessels.matched"),
      gap: (pct) => t("vessels.gap", { pct }),
    };
    const breakeven: BreakevenCopy = {
      title: t("breakeven.title"), axis: t("breakeven.axis"), labelA: t("breakeven.labelA"), labelB: t("breakeven.labelB"),
      exact: t("breakeven.exact"), profitable: (p) => t("breakeven.profitable", p), below: (p) => t("breakeven.below", p), noSpend: t("breakeven.noSpend"),
    };
    const bullseye: BullseyeCopy = {
      title: t("bullseye.title"), labelX: t("bullseye.labelX"), labelY: t("bullseye.labelY"), level: t("bullseye.level"),
      tolerance: (tol) => t("bullseye.tolerance", { tol }), off: t("bullseye.off"), offScale: t("bullseye.offScale"),
    };
    const loader = {
      loading: t("loader.loading"), syncing: t("loader.syncing"), saving: t("loader.saving"), sending: t("loader.sending"),
      confirming: t("loader.confirming"), waitingReply: t("loader.waitingReply"), boot: t("boot"),
      syncingWith: (system: string) => t("loader.syncingWith", { system }),
      progress: (done: number | string, total: number | string) => t("loader.progress", { done: String(done), total: String(total) }),
      percent: (pct: number | string) => t("loader.percent", { pct: String(pct) }),
    };
    return { gauge, vessels, breakeven, bullseye, loader };
  }, [t]);
}
