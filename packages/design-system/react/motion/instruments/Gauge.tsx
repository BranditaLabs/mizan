"use client";
import * as gauge from "../../../motion/physics/gauge";
import { formatDeg, formatMoney, formatPct } from "../../../motion/format";
import { attrProps } from "../useMotionClock";
import { exactDelta, Frame, geo, GooFilter, Reading, useInstrument, Verdict } from "./shared";

export interface GaugeCopy {
  title: string;
  labelA: string;
  labelB: string;
  balanced: string;
  shortBy: (pct: string) => string;
  overBy: (pct: string) => string;
  tilt: (deg: string) => string;
  summary: (p: { labelA: string; a: string; labelB: string; b: string; verdict: string }) => string;
}

export interface GaugeProps {
  /** Expected, as a decimal string ("184250.00"). */
  a: string;
  /** Collected. */
  b: string;
  /** The store's currency (never assumed). */
  currency: string;
  locale: string;
  copy: GaugeCopy;
  className?: string;
}

const ticks: [number, number, number, number, boolean][] = [];
for (let x = 30; x <= 370; x += 10) ticks.push([x, 176, x, x % 50 ? 180 : 184, x % 50 === 0]);
const arc: [number, number, number, number, boolean][] = [];
for (let d = -14; d <= 14; d += 2) {
  const r = (d * Math.PI) / 180, R2 = d % 10 ? 60 : 64;
  arc.push([200 + 56 * Math.sin(r), 100 + 56 * Math.cos(r), 200 + R2 * Math.sin(r), 100 + R2 * Math.cos(r), d === 0]);
}
const hair = { fill: "none", stroke: "currentColor", strokeWidth: 1, vectorEffect: "non-scaling-stroke" as const };

/** GAUGE: expected against collected (COD remittance, a settlement). Tips toward the heavier side. */
export function Gauge({ a, b, currency, locale, copy, className }: GaugeProps) {
  const d = exactDelta(a, b, currency);
  const pct = formatPct((Math.abs(geo(b) - geo(a)) / Math.max(Math.abs(geo(a)), 1)) * 100, locale, 2);
  const category = d.sign === 0 ? "balanced" : d.sign < 0 ? "short" : "over";
  const verdict = category === "balanced" ? copy.balanced : category === "short" ? copy.shortBy(pct) : copy.overBy(pct);
  const input = { a: geo(a), b: geo(b) };
  const { svg, fid, goo, red, rest } = useInstrument(gauge, input, category === "balanced");
  const p = (k: string) => attrProps(rest, k);
  const fa = formatMoney(a, currency, locale), fb = formatMoney(b, currency, locale);
  return (
    <Frame title={copy.title} className={className}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <Reading label={copy.labelA} value={fa} />
        <Reading label={copy.labelB} value={fb} align="end" />
      </div>
      <svg ref={svg} viewBox="0 30 400 160" role="img" aria-label={copy.summary({ labelA: copy.labelA, a: fa, labelB: copy.labelB, b: fb, verdict })} style={{ width: "100%", height: "auto", overflow: "visible" }}>
        <defs>
          <GooFilter id={`${fid}g`} blur="gauge" />
          <clipPath id={`${fid}c`}><rect x={76} y={86} width={248} height={28} rx={14} /></clipPath>
        </defs>
        <line {...hair} opacity={0.32} x1={30} x2={370} y1={176} y2={176} />
        {ticks.map(([x1, y1, x2, y2, major]) => <line key={x1} {...hair} opacity={major ? 0.32 : 0.16} x1={x1} x2={x2} y1={y1} y2={y2} />)}
        <line {...hair} x1={195} x2={195} y1={170} y2={186} /><line {...hair} x1={205} x2={205} y1={170} y2={186} />
        {arc.map(([x1, y1, x2, y2, zero], i) => <line key={i} {...hair} opacity={zero ? 0.32 : 0.16} x1={x1.toFixed(2)} y1={y1.toFixed(2)} x2={x2.toFixed(2)} y2={y2.toFixed(2)} />)}
        <line {...hair} x1={200} y1={100} {...p("needle")} />
        <g {...p("rot")}>
          <line {...hair} opacity={0.16} strokeDasharray="3 4" x1={24} x2={376} y1={100} y2={100} />
          <rect {...hair} x={70} y={80} width={260} height={40} rx={20} />
          <rect fill="currentColor" x={76} y={86} width={248} height={28} rx={14} />
          <g clipPath={`url(#${fid}c)`}>
            <line stroke="var(--mz-tick)" strokeLinecap="round" strokeWidth={2.4} x1={178} x2={178} y1={91} y2={109} {...p("t1")} />
            <line stroke="var(--mz-tick)" strokeLinecap="round" strokeWidth={2.4} x1={222} x2={222} y1={91} y2={109} {...p("t2")} />
            <g filter={goo ? `url(#${fid}g)` : undefined}>{[0, 1, 2].map((i) => <circle key={i} fill={red ? "var(--mz-red)" : "var(--mz-tick)"} cy={100} {...p(`b${i}`)} />)}</g>
          </g>
        </g>
      </svg>
      <div style={{ textAlign: "center", display: "grid", gap: 2 }}>
        <bdi className="mz-figure" style={{ fontSize: 19 }}>{`Δ ${d.sign < 0 ? "−" : d.sign > 0 ? "+" : ""}${formatMoney(d.amount, currency, locale)}`}</bdi>
        <span className="mz-instrument-label" style={{ fontSize: 11, opacity: 0.7 }}>{copy.tilt(formatDeg(gauge.tilt(input), locale))}</span>
        <Verdict category={category} text={verdict} red={red} />
      </div>
    </Frame>
  );
}
