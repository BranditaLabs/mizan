"use client";
import type { CSSProperties } from "react";
import { GOO, gooMatrix, M } from "../../motion/spring";
import { RED_PRIORITY } from "../../motion/red-budget";
import type { MotionOutcome } from "../../motion/index";
import { useSvgId } from "./useMotionClock";
import { useReducedMotion } from "./useReducedMotion";
import { useRed } from "./RedBudget";

/** What the mark can play once: arrive (SETTLE), a passing warning (TIP, then level), money or a sign-in landing (DROP). */
export type FluidBeat = Extract<MotionOutcome, "settle" | "tip" | "drop">;

export interface FluidMarkProps {
  /** The outcome to play once (from a surface's state, e.g. the auth stage's machine); null = the still mark. */
  beat?: FluidBeat | null;
  /** A new key replays the same beat (a second error tips again). */
  beatKey?: number;
  /** Rendered width in px; the height follows (7:4). */
  size?: number;
  /** Ask for the view's one red for the right ball (RED_PRIORITY.dot). false, or refused: the ball is currentColor. */
  claim?: boolean;
  /** Only when the mark stands alone; otherwise it is decorative. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/** The merged mark at level (the same geometry as DoneState's pair): centres 2.19r apart. */
const PAN = { l: 47.75, r: 72.25, cy: 50, rad: 11.2, travel: 8.75 } as const;

/**
 * The Brand 2.0 mark as live SVG: two balls under the goo filter, so the neck between them is
 * fluid, the start ball in currentColor and the end ball in the view's red while it holds the
 * budget (else currentColor, so a held red elsewhere never makes a second one). It is still unless a
 * beat plays: settle (the pans travel together and arrive), tip (off balance, held, then level:
 * motion.css mz-tip-settle), drop (the red ball falls into place and ripples). Each beat plays
 * once; nothing loops. Reduced motion: the still mark, every beat skipped (the copy beside it
 * carries the meaning).
 */
export function FluidMark({ beat = null, beatKey = 0, size = 64, claim = true, label, className = "", style }: FluidMarkProps) {
  const id = useSvgId("mzfm");
  const reduced = useReducedMotion();
  const red = useRed(id, RED_PRIORITY.dot, claim);
  const play = reduced ? null : beat;
  const ball = red ? "var(--mz-red)" : "currentColor";
  const pan = { "--_pan": `${PAN.travel}px` } as CSSProperties;
  const a11y = label ? { role: "img" as const, "aria-label": label } : { "aria-hidden": true as const };
  return (
    <svg
      viewBox="34 36 52 28" width={size} height={(size * 28) / 52} className={className}
      style={{ display: "block", overflow: "visible", flex: "none", ...style }}
      data-beat={play ?? "still"} data-mz-red={red ? "on" : "off"} focusable="false" {...a11y}
    >
      <defs>
        <filter id={id} x={14} y={0} width={92} height={84} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation={GOO.loader.pair} />
          <feColorMatrix values={gooMatrix(GOO.loaderMatrix)} />
        </filter>
      </defs>
      {/* Keyed by the beat: a new beat (or the same one again) restarts its classes. */}
      <g key={`${play ?? "still"}-${beatKey}`} className={play === "tip" ? "mz-tip-settle" : play === "settle" ? "mz-settle-in" : undefined}>
        <g filter={`url(#${id})`}>
          <circle cx={PAN.l} cy={PAN.cy} r={PAN.rad} fill="currentColor" className={play === "settle" ? "mz-pan-l" : undefined} style={play === "settle" ? pan : undefined} />
          <circle cx={PAN.r} cy={PAN.cy} r={PAN.rad} fill={ball} className={play === "settle" ? "mz-pan-r" : play === "drop" ? "mz-drop-fall" : undefined} style={play === "settle" ? pan : undefined} data-mz-ball="" />
        </g>
        {play === "drop" ? (
          <circle cx={PAN.r} cy={PAN.cy} r={PAN.rad} fill="none" stroke={ball} strokeWidth={1.2} className="mz-ripple" style={{ animationDelay: `${M.duration.fall}ms` }} />
        ) : null}
      </g>
    </svg>
  );
}
