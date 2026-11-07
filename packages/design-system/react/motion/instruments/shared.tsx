"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { fromMinor, toMinor } from "@mizan/shared/money";
import { GOO, gooMatrix } from "../../../motion/spring";
import { RED_PRIORITY } from "../../../motion/red-budget";
import { kick, type InstrumentBase } from "../../../motion/physics/instrument";
import { useMotionClock, useSvgId, type PhysicsModule } from "../useMotionClock";
import { useReducedMotion } from "../useReducedMotion";
import { useRed } from "../RedBudget";

/** Exact difference b − a of two decimal strings in `currency` (never floats for money). */
export function exactDelta(a: string, b: string, currency: string) {
  const minor = toMinor(b, currency) - toMinor(a, currency);
  return { minor, amount: fromMinor(minor < 0n ? -minor : minor, currency).amount, sign: minor === 0n ? 0 : minor < 0n ? -1 : 1 };
}

/** A decimal string as a float, for geometry only. */
export const geo = (decimal: string) => Number(decimal);

/**
 * Drives an instrument: the shared clock, a kick when the reading changes, the goo filter id and the
 * red for a balanced verdict (priority 2, refused → ink).
 */
export function useInstrument<St extends InstrumentBase, I>(physics: PhysicsModule<St, I>, input: I, balanced: boolean) {
  const svg = useRef<SVGSVGElement>(null);
  const fid = useSvgId("mzi");
  const reduced = useReducedMotion();
  const stateRef = useRef<St | null>(null);
  const { goo } = useMotionClock({ svg, physics, input, animate: true, reduced, stateRef });
  const key = JSON.stringify(input);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (stateRef.current) kick(stateRef.current);
  }, [key]);
  const red = useRed(fid, RED_PRIORITY.verdict, balanced);
  return { svg, fid, goo, red, rest: physics.rest(input) };
}

/** The goo filter for an instrument (instrument blur, α' = 22A − 10). */
export function GooFilter({ id, blur }: { id: string; blur: keyof typeof GOO.instrument }) {
  return (
    <filter id={id} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation={GOO.instrument[blur]} />
      <feColorMatrix values={gooMatrix(GOO.instrumentMatrix)} />
    </filter>
  );
}

/**
 * The verdict, announced politely and only when its category changes (balanced → short …), not on
 * every new figure. The red dot is the balanced verdict's claim on the view's red.
 */
export function Verdict({ category, text, red }: { category: string; text: string; red: boolean }) {
  const [spoken, setSpoken] = useState({ category, text });
  if (spoken.category !== category) setSpoken({ category, text });
  return (
    <p className="mz-instrument-verdict" style={{ margin: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12 }}>
      {category === "balanced" || category === "level" || category === "matched" || category === "exact" ? (
        <span aria-hidden="true" data-mz-red={red ? "on" : "off"} style={{ inlineSize: 7, blockSize: 7, borderRadius: 9, background: red ? "var(--mz-red)" : "currentColor", flex: "none" }} />
      ) : null}
      <span aria-hidden="true">{text}</span>
      <span aria-live="polite" className="mz-sr">{spoken.text}</span>
    </p>
  );
}

/** A label above a figure (the HTML around the SVG; figures in <bdi> and Geist Mono). */
export function Reading({ label, value, align = "start" }: { label: string; value: string; align?: "start" | "end" | "center" }) {
  return (
    <div style={{ textAlign: align, display: "grid", gap: 2 }}>
      <span className="mz-instrument-label" style={{ fontSize: 11, opacity: 0.7 }}>{label}</span>
      <bdi className="mz-figure" style={{ fontSize: 15, fontWeight: 600 }}>{value}</bdi>
    </div>
  );
}

export function Frame({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return <figure className={`mz-instrument ${className ?? ""}`.trim()} aria-label={title} style={{ margin: 0, display: "grid", gap: 8 }}>{children}</figure>;
}
