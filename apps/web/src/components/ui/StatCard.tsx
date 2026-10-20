import type { ReactNode } from "react";
import { Bdi } from "../Bdi";
import { cx, sparklinePath } from "./logic";

/**
 * KPI tile (components.md §5, `.mz-kpi`): label → big tabular value (unit small) → delta with the
 * comparison period, optional sparkline. `hero` is the ink tile for the number the screen exists for.
 * `good` says whether the delta is good news (a falling return rate is good): colour follows meaning,
 * the arrow follows the number.
 */
export function StatCard({ label, value, unit, delta, good, period, trend, trendLabel, hero = false, className }: {
  label: ReactNode; value: ReactNode; unit?: ReactNode; delta?: string; good?: boolean; period?: ReactNode;
  trend?: readonly number[]; trendLabel?: string; hero?: boolean; className?: string;
}) {
  const up = delta !== undefined && !delta.trim().startsWith("-") && !delta.trim().startsWith("−");
  return (
    <div className={cx("mz-card mz-kpi", hero && "mz-kpi--hero", className)}>
      <p className="mz-kpi__label">{label}</p>
      <p className="mz-kpi__value">
        <Bdi>{value}</Bdi>
        {unit ? <small>{unit}</small> : null}
      </p>
      {delta !== undefined || trend ? (
        <div className="flex items-end justify-between gap-3">
          {delta !== undefined ? (
            <p className="mz-kpi__delta">
              <b className={good === undefined ? undefined : good ? "up" : "down"}>
                <span aria-hidden="true">{up ? "↑" : "↓"}</span>
                <Bdi>{delta}</Bdi>
              </b>
              {period}
            </p>
          ) : <span />}
          {trend && trend.length > 1 ? <Sparkline values={trend} label={trendLabel} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Tiny trend line in the current text colour; time runs left to right in both languages (SVG is never mirrored). */
export function Sparkline({ values, label, width = 88, height = 28 }: { values: readonly number[]; label?: string; width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className="shrink-0 opacity-80">
      <path d={sparklinePath(values, width, height)} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
