"use client";
import type { CSSProperties } from "react";
import { M } from "../../motion/spring";
import { RED_PRIORITY } from "../../motion/red-budget";
import type { MotionOutcome } from "../../motion/index";
import { useSvgId } from "./useMotionClock";
import { useReducedMotion } from "./useReducedMotion";
import { useRed } from "./RedBudget";

export interface EventGlyphProps {
  outcome: MotionOutcome;
  /** 12–24 px. */
  size?: number;
  /** The end frame only: list, bell and timeline rows, unless the row is fresh. */
  static?: boolean;
  /** The glyph is decorative next to its copy; pass a label only when it stands alone. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

const ANIM: Partial<Record<MotionOutcome, string>> = { settle: "mz-settle-in", done: "mz-settle-in", merge: "mz-merge", tip: "mz-tip-hold", fail: "mz-fail" };

/**
 * A small two-ball glyph that plays one outcome once (motion.css keyframes, token durations):
 * settle rises with overshoot; done settles then draws a check; merge forms the neck; tip tilts to
 * 8° and holds; fail tips twice, damps out and rests ink-only in the danger text tone; drop lets the
 * red fall and ripple, and is the only outcome that claims the view's red (released after the ripple).
 */
export function EventGlyph({ outcome, size = 16, static: still, label, className = "", style }: EventGlyphProps) {
  const id = useSvgId("mzeg");
  const reduced = useReducedMotion();
  const play = !still;
  const red = useRed(id, RED_PRIORITY.drop, outcome === "drop" && play, M.duration.fall + M.duration.ripple);
  const anim = play ? ANIM[outcome] ?? "" : "";
  const ink = "currentColor";
  const merged = outcome === "done" || outcome === "merge";
  const tilt = outcome === "tip" && !play ? `rotate(${M.angle.tipHold} 12 12)` : undefined;
  const a11y = label ? { role: "img" as const, "aria-label": label } : { "aria-hidden": true as const };
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} className={`${anim} ${className}`.trim()}
      style={{ flex: "none", overflow: "visible", color: outcome === "fail" ? "var(--mz-danger-text)" : undefined, ...style }}
      data-outcome={outcome} data-mz-red={outcome === "drop" ? (red ? "on" : "off") : undefined} {...a11y}
    >
      <g transform={tilt}>
        {merged ? (
          <rect x={3.5} y={7.5} width={17} height={9} rx={4.5} fill={ink} />
        ) : (
          <>
            <circle cx={7.5} cy={12} r={4.5} fill={ink} />
            <circle cx={16.5} cy={12} r={4.5} fill={outcome === "drop" ? (red ? "var(--mz-red)" : ink) : ink} className={outcome === "drop" && play ? "mz-drop-fall" : undefined} />
          </>
        )}
        {outcome === "done" && (
          <path d="M8.4 12.2l2.3 2.3 4.9-4.9" fill="none" stroke="var(--mz-tick)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" pathLength={1} className={play ? "mz-draw" : undefined} style={play && !reduced ? { animationDelay: `${M.duration.settle * 0.6}ms` } : undefined} />
        )}
        {outcome === "drop" && play && !reduced && (
          <circle cx={16.5} cy={12} r={4.5} fill="none" stroke={red ? "var(--mz-red)" : ink} strokeWidth={1} className="mz-ripple" style={{ animationDelay: `${M.duration.fall}ms` }} />
        )}
      </g>
    </svg>
  );
}
