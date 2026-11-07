"use client";

import dynamic from "next/dynamic";
import { useLocale } from "next-intl";
import type { ComponentProps } from "react";
import { useBrandCopy } from "@/lib/motion/useBrandCopy";

/**
 * The Brand 2.0 balance instruments, loaded lazily (their own chunk) with their copy from next-intl.
 * One instrument per view. Each sits on figures the API already returns; money arrives as decimal
 * strings and only the geometry uses floats.
 *   VesselsMeter     two counts that should agree (ordered vs received, in the system vs counted)
 *   BreakevenMeter   gross profit against ad spend
 *   GaugeMeter       expected against collected (COD remittance, a settlement)
 *   BullseyeMeter    cash and stock off by a percentage, inside a tolerance
 */
const Vessels = dynamic(() => import("@mizan/design-system/react/motion/instruments").then((m) => m.Vessels), { ssr: false });
const Breakeven = dynamic(() => import("@mizan/design-system/react/motion/instruments").then((m) => m.Breakeven), { ssr: false });
const Gauge = dynamic(() => import("@mizan/design-system/react/motion/instruments").then((m) => m.Gauge), { ssr: false });
const Bullseye = dynamic(() => import("@mizan/design-system/react/motion/instruments").then((m) => m.Bullseye), { ssr: false });

type Without<T, K extends string> = Omit<T, K | "locale" | "copy">;
type VesselsProps = ComponentProps<typeof import("@mizan/design-system/react/motion/instruments").Vessels>;
type BreakevenProps = ComponentProps<typeof import("@mizan/design-system/react/motion/instruments").Breakeven>;
type GaugeProps = ComponentProps<typeof import("@mizan/design-system/react/motion/instruments").Gauge>;
type BullseyeProps = ComponentProps<typeof import("@mizan/design-system/react/motion/instruments").Bullseye>;

export function VesselsMeter({ labels, ...p }: Without<VesselsProps, never> & { labels?: { a: string; b: string; title?: string } }) {
  const copy = useBrandCopy().vessels;
  const locale = useLocale();
  return <Vessels {...p} locale={locale} copy={labels ? { ...copy, labelA: labels.a, labelB: labels.b, title: labels.title ?? copy.title } : copy} />;
}

export function BreakevenMeter(p: Without<BreakevenProps, never>) {
  const copy = useBrandCopy().breakeven;
  return <Breakeven {...p} locale={useLocale()} copy={copy} />;
}

export function GaugeMeter(p: Without<GaugeProps, never>) {
  const copy = useBrandCopy().gauge;
  return <Gauge {...p} locale={useLocale()} copy={copy} />;
}

export function BullseyeMeter(p: Without<BullseyeProps, never>) {
  const copy = useBrandCopy().bullseye;
  return <Bullseye {...p} locale={useLocale()} copy={copy} />;
}
