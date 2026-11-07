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
  // The rest frame is rendered once: afterwards the clock (or the still effect) owns the attributes,
  // so a new reading animates from where the spring is instead of React writing the target first.
  const [rest] = useState(() => physics.rest(input));
  return { svg, fid, goo, red, rest };
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
 * The verdict: the visible text is always the current one (read in place), and a separate polite
 * live region speaks it only when its category changes (balanced → short …), not on every new
 * figure. The red dot is the balanced verdict's claim on the view's red.
 */
export function Verdict({ category, text, red }: { category: string; text: string; red: boolean }) {
  const [last, setLast] = useState(category);
  const [spoken, setSpoken] = useState("");
  if (last !== category) { setLast(category); setSpoken(text); }
  useEffect(() => {
    if (!spoken) return;
    const t = setTimeout(() => setSpoken(""), 4000);
    return () => clearTimeout(t);
  }, [spoken]);
  return (
    <div className="mz-instrument-verdict" style={{ margin: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12 }}>
      {category === "balanced" || category === "level" || category === "matched" || category === "exact" ? (
        <span aria-hidden="true" data-mz-red={red ? "on" : "off"} style={{ inlineSize: 7, blockSize: 7, borderRadius: 9, background: red ? "var(--mz-red)" : "currentColor", flex: "none" }} />
      ) : null}
      <p style={{ margin: 0 }}>{text}</p>
      <span aria-live="polite" className="mz-sr">{spoken}</span>
    </div>
  );
}

/**
 * The readings above an instrument. The SVG draws A on the left and B on the right in every
 * language (one picture: the heavier pan is the heavier side), so the row is laid out left to right
 * too; each reading keeps the page's language for its own text.
 */
export function ReadingRow({ children, spread = "between" }: { children: ReactNode; spread?: "between" | "around" }) {
  return <div dir="ltr" style={{ display: "flex", justifyContent: spread === "around" ? "space-around" : "space-between", gap: 12 }}>{children}</div>;
}

/** A label above a figure (the HTML around the SVG; figures in <bdi> and Geist Mono). `side` is the pan it reads. */
export function Reading({ label, value, side = "a" }: { label: string; value: string; side?: "a" | "b" | "center" }) {
  return (
    <div dir="auto" style={{ textAlign: side === "a" ? "left" : side === "b" ? "right" : "center", display: "grid", gap: 2 }}>
      <span className="mz-instrument-label" style={{ fontSize: 11, opacity: 0.7 }}>{label}</span>
      <bdi className="mz-figure" style={{ fontSize: 15, fontWeight: 600 }}>{value}</bdi>
    </div>
  );
}

export function Frame({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return <figure className={`mz-instrument ${className ?? ""}`.trim()} aria-label={title} style={{ margin: 0, display: "grid", gap: 8 }}>{children}</figure>;
}
