"use client";
import * as bullseye from "../../../motion/physics/bullseye";
import { formatPct, isolate } from "../../../motion/format";
import { attrProps } from "../useMotionClock";
import { Frame, GooFilter, useInstrument, Verdict } from "./shared";

export interface BullseyeCopy {
  title: string;
  labelX: string;
  labelY: string;
  level: string;
  tolerance: (tol: string) => string;
  off: string;
  offScale: string;
}

export interface BullseyeProps {
  /** Cash difference in percent. */
  x: number;
  /** Stock difference in percent. */
  y: number;
  /** ± percent that still counts as level (store setting, default 2). */
  tolerance?: number;
  locale: string;
  copy: BullseyeCopy;
  className?: string;
}

const hair = { fill: "none", stroke: "currentColor", strokeWidth: 1, vectorEffect: "non-scaling-stroke" as const };
const degs: [string, string, string, string, boolean][] = [];
for (let a = 0; a < 360; a += 6) {
  const r = (a * Math.PI) / 180, l = a % 30 ? 4 : 9;
  degs.push([(130 + 106 * Math.cos(r)).toFixed(2), (130 + 106 * Math.sin(r)).toFixed(2), (130 + (106 + l) * Math.cos(r)).toFixed(2), (130 + (106 + l) * Math.sin(r)).toFixed(2), a % 30 === 0]);
}

/** BULLSEYE: cash and stock level at once (store health). The inner ring is the tolerance. */
export function Bullseye({ x, y, tolerance = bullseye.DEFAULT_TOLERANCE, locale, copy, className }: BullseyeProps) {
  const input = { x, y, tolerance };
  const category = bullseye.verdict(input);
  const tol = formatPct(tolerance, locale, tolerance % 1 ? 1 : 0);
  const verdict = category === "level" ? copy.level : category === "inside" ? copy.tolerance(isolate(tol)) : category === "off" ? copy.off : copy.offScale;
  const { svg, fid, goo, red, rest } = useInstrument(bullseye, input, category === "level");
  const p = (k: string) => attrProps(rest, k);
  const signed = (n: number) => `${n > 0 ? "+" : ""}${formatPct(n, locale, 1)}`;
  return (
    <Frame title={copy.title} className={className}>
      <div style={{ position: "relative" }}>
        <svg ref={svg} viewBox="0 0 260 260" role="img" aria-label={`${copy.labelX} ${signed(x)}, ${copy.labelY} ${signed(y)}, ${verdict}`} style={{ width: "100%", height: "auto", overflow: "visible", display: "block" }}>
          <defs>
            <GooFilter id={`${fid}g`} blur="bullseye" />
            <clipPath id={`${fid}c`}><circle cx={130} cy={130} r={96} /></clipPath>
          </defs>
          {degs.map(([x1, y1, x2, y2, major], i) => <line key={i} {...hair} opacity={major ? 0.32 : 0.16} x1={x1} y1={y1} x2={x2} y2={y2} />)}
          <circle {...hair} cx={130} cy={130} r={102} />
          <circle fill="currentColor" cx={130} cy={130} r={96} />
          <g clipPath={`url(#${fid}c)`}>
            {[24, 48, 72].map((r, i) => <circle key={r} cx={130} cy={130} r={r} fill="none" stroke="var(--mz-tick)" strokeLinecap="round" strokeWidth={i ? 0.8 : 1.6} opacity={i ? 0.35 : 0.9} strokeDasharray={i === 2 ? "2 5" : undefined} />)}
            <line stroke="var(--mz-tick)" strokeWidth={0.8} opacity={0.3} x1={34} x2={226} y1={130} y2={130} />
            <line stroke="var(--mz-tick)" strokeWidth={0.8} opacity={0.3} x1={130} x2={130} y1={34} y2={226} />
            <g filter={goo ? `url(#${fid}g)` : undefined}>{[11, 12.5, 10].map((r, i) => <circle key={i} fill={red ? "var(--mz-red)" : "var(--mz-tick)"} r={r} {...p(`b${i}`)} />)}</g>
          </g>
        </svg>
        {/* Axis labels: physical sides on purpose (a chart's x axis does not mirror), text in the page's language. */}
        <span className="mz-instrument-label" dir="auto" style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", fontSize: 10, opacity: 0.62 }}>{copy.labelY} +</span>
        <span className="mz-instrument-label" dir="auto" style={{ position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)", fontSize: 10, opacity: 0.62 }}>{copy.labelY} −</span>
        <span className="mz-instrument-label" dir="auto" style={{ position: "absolute", top: "50%", right: 0, transform: "translateY(-50%)", fontSize: 10, opacity: 0.62 }}>{copy.labelX} +</span>
        <span className="mz-instrument-label" dir="auto" style={{ position: "absolute", top: "50%", left: 0, transform: "translateY(-50%)", fontSize: 10, opacity: 0.62 }}>{copy.labelX} −</span>
      </div>
      <p className="mz-instrument-label" style={{ margin: 0, textAlign: "center", fontSize: 15 }}>
        {copy.labelX} <bdi className="mz-figure">{signed(x)}</bdi> · {copy.labelY} <bdi className="mz-figure">{signed(y)}</bdi>
      </p>
      <Verdict category={category} text={verdict} red={red} />
    </Frame>
  );
}
