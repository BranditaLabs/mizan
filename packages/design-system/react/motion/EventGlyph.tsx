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

// merge and done animate their parts (the pans travel, the neck grows), not the whole glyph.
const ANIM: Partial<Record<MotionOutcome, string>> = { settle: "mz-settle-in", tip: "mz-tip-hold", fail: "mz-fail" };
const PAN = { "--_pan": "2.5px" } as CSSProperties;

/**
 * A small two-ball glyph that plays one outcome once (motion.css keyframes, token durations):
 * settle rises with overshoot; merge brings the two balls together and the neck grows between them
 * (nothing snaps); done merges then draws a check; tip tilts to 8° and holds; fail tips twice, damps
 * out and rests level in ink (the row's danger text or badge carries the error); drop lets the
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
      style={{ flex: "none", overflow: "visible", ...style }}
      data-outcome={outcome} data-mz-red={outcome === "drop" ? (red ? "on" : "off") : undefined} {...a11y}
    >
      <g transform={tilt}>
        {merged ? (
          <>
            <circle cx={8} cy={12} r={4.5} fill={ink} className={play ? "mz-pan-l" : undefined} style={play ? PAN : undefined} />
            <circle cx={16} cy={12} r={4.5} fill={ink} className={play ? "mz-pan-r" : undefined} style={play ? PAN : undefined} />
            <rect x={8} y={8.6} width={8} height={6.8} fill={ink} className={play ? "mz-neck" : undefined} data-neck="" />
          </>
        ) : (
          <>
            <circle cx={7.5} cy={12} r={4.5} fill={ink} />
            <circle cx={16.5} cy={12} r={4.5} fill={outcome === "drop" ? (red ? "var(--mz-red)" : ink) : ink} className={outcome === "drop" && play ? "mz-drop-fall" : undefined} />
          </>
        )}
        {outcome === "done" && (
          <path d="M8.4 12.2l2.3 2.3 4.9-4.9" fill="none" stroke="var(--mz-tick)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" pathLength={1} className={play ? "mz-draw" : undefined} style={play && !reduced ? { animationDelay: `${M.duration.merge}ms` } : undefined} />
        )}
        {outcome === "drop" && play && !reduced && (
          <circle cx={16.5} cy={12} r={4.5} fill="none" stroke={red ? "var(--mz-red)" : ink} strokeWidth={1} className="mz-ripple" style={{ animationDelay: `${M.duration.fall}ms` }} />
        )}
      </g>
    </svg>
  );
}
