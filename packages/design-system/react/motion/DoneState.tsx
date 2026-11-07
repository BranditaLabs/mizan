"use client";
import type { CSSProperties, ReactNode } from "react";
import { GOO, gooMatrix, M } from "../../motion/spring";
import { RED_PRIORITY } from "../../motion/red-budget";
import { useSvgId } from "./useMotionClock";
import { useReducedMotion } from "./useReducedMotion";
import { useRed } from "./RedBudget";

export interface DoneStateProps {
  /** The status read out (role="status"). */
  label: string;
  /** Copy under the mark. */
  children?: ReactNode;
  size?: number;
  testId?: string;
  className?: string;
}

/** The merged mark at level (pair physics, kiss 1): centres 2.19r apart, r 11.2. */
const PAN = { l: 47.75, r: 72.25, cy: 50, rad: 11.2, travel: 8.75 } as const;

/**
 * The end of a flow (sign-up done, order confirmed by the customer): a 96 px pair whose pans travel
 * together and MERGE (the goo forms the neck, nothing snaps), then the red DROPs into the merged
 * pans and floats there as the bubble. Claims the view's red for the drop and releases it after the
 * ripple; the bubble then rests in the paper tone, so the end frame is the merged mark with its
 * bubble. Reduced motion: that end frame, the bubble faded in, no travel.
 */
export function DoneState({ label, children, size = 96, testId, className = "" }: DoneStateProps) {
  const id = useSvgId("mzdone");
  const reduced = useReducedMotion();
  const red = useRed(id, RED_PRIORITY.drop, true, M.duration.merge + M.duration.fall + M.duration.ripple);
  const bubble = red ? "var(--mz-red)" : "var(--mz-tick)";
  const fall = { animationDelay: reduced ? undefined : `${M.duration.merge}ms`, "--_drop-from": `${-(PAN.cy - 14)}px` } as CSSProperties;
  const pan = { "--_pan": `${PAN.travel}px` } as CSSProperties;
  return (
    <div role="status" aria-label={label} data-testid={testId} className={className} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <svg viewBox="0 0 120 84" style={{ width: size, height: "auto", overflow: "visible" }} aria-hidden="true" data-mz-red={red ? "on" : "off"}>
        <defs>
          <filter id={id} x={-20} y={-40} width={160} height={164} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation={GOO.loader.pair} />
            <feColorMatrix values={gooMatrix(GOO.loaderMatrix)} />
          </filter>
        </defs>
        <g filter={`url(#${id})`} fill="currentColor" data-mz-pans="">
          <circle cx={PAN.l} cy={PAN.cy} r={PAN.rad} className="mz-pan-l" style={pan} />
          <circle cx={PAN.r} cy={PAN.cy} r={PAN.rad} className="mz-pan-r" style={pan} />
        </g>
        <circle cx={60} cy={PAN.cy} r={5} fill={bubble} className="mz-drop-in" style={fall} data-mz-bubble="" />
        {!reduced && <circle cx={60} cy={PAN.cy} r={14} fill="none" stroke={red ? "var(--mz-red)" : "currentColor"} strokeWidth={1.2} className="mz-ripple" style={{ animationDelay: `${M.duration.merge + M.duration.fall}ms` }} />}
      </svg>
      {children}
    </div>
  );
}
