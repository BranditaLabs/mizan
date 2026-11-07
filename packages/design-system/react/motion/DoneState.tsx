"use client";
import type { ReactNode } from "react";
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

/**
 * The end of a flow (sign-up done, order confirmed by the customer): a 96 px pair that MERGEs, then
 * the red DROPs once. Claims the view's red for the drop and releases it after the ripple. Reduced
 * motion: the merged pair with the red at rest, no travel.
 */
export function DoneState({ label, children, size = 96, testId, className = "" }: DoneStateProps) {
  const id = useSvgId("mzdone");
  const reduced = useReducedMotion();
  const red = useRed(id, RED_PRIORITY.drop, true, M.duration.merge + M.duration.fall + M.duration.ripple);
  const redFill = red ? "var(--mz-red)" : "currentColor";
  const fall = { animationDelay: reduced ? undefined : `${M.duration.merge}ms` };
  return (
    <div role="status" aria-label={label} data-testid={testId} className={className} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <svg viewBox="0 0 120 84" style={{ width: size, height: "auto", overflow: "visible" }} aria-hidden="true" data-mz-red={red ? "on" : "off"}>
        <defs>
          <filter id={id} x={-20} y={-40} width={160} height={164} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation={GOO.loader.pair} />
            <feColorMatrix values={gooMatrix(GOO.loaderMatrix)} />
          </filter>
        </defs>
        <g filter={`url(#${id})`} fill="currentColor" className="mz-merge">
          <circle cx={47} cy={50} r={11} />
          <circle cx={73} cy={50} r={11} />
        </g>
        <g filter={`url(#${id})`} fill={redFill}>
          <circle cx={60} cy={34} r={7} className="mz-drop-fall" style={fall} />
        </g>
        {!reduced && <circle cx={60} cy={50} r={14} fill="none" stroke={redFill} strokeWidth={1.2} className="mz-ripple" style={{ animationDelay: `${M.duration.merge + M.duration.fall}ms` }} />}
      </svg>
      {children}
    </div>
  );
}
