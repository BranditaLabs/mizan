"use client";
import * as breakeven from "../../../motion/physics/breakeven";
import { formatMoney } from "../../../motion/format";
import { attrProps } from "../useMotionClock";
import { exactDelta, Frame, geo, GooFilter, Reading, useInstrument, Verdict } from "./shared";

export interface BreakevenCopy {
  title: string;
  axis: string;
  labelA: string;
  labelB: string;
  exact: string;
  profitable: (p: { amount: string; ratio: string }) => string;
  below: (p: { amount: string }) => string;
  noSpend: string;
}

export interface BreakevenProps {
  /** Gross profit, decimal string (may be negative). */
  a: string;
  /** Ad spend, decimal string. */
  b: string;
  currency: string;
  locale: string;
  copy: BreakevenCopy;
  className?: string;
}

const hair = { fill: "none", stroke: "currentColor", strokeWidth: 1, vectorEffect: "non-scaling-stroke" as const };

/** BREAK-EVEN: gross profit against ad spend on one bar (ads and ROAS). */
export function Breakeven({ a, b, currency, locale, copy, className }: BreakevenProps) {
  const d = exactDelta(b, a, currency); // a − b
  const noSpend = geo(b) === 0;
  const category = noSpend ? "noSpend" : d.sign === 0 ? "exact" : d.sign > 0 ? "profitable" : "below";
  const amount = formatMoney(d.amount, currency, locale);
  const ratio = new Intl.NumberFormat(locale, { numberingSystem: "latn", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(noSpend ? 0 : geo(a) / geo(b));
  const verdict = category === "noSpend" ? copy.noSpend : category === "exact" ? copy.exact : category === "profitable" ? copy.profitable({ amount, ratio }) : copy.below({ amount });
  const input = { a: geo(a), b: geo(b) };
  const { svg, fid, goo, red, rest } = useInstrument(breakeven, input, category === "exact");
  const p = (k: string) => attrProps(rest, k);
  const fa = formatMoney(a, currency, locale), fb = formatMoney(b, currency, locale);
  return (
    <Frame title={copy.title} className={className}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <Reading label={copy.labelA} value={fa} />
        <Reading label={copy.labelB} value={fb} align="end" />
      </div>
      <svg ref={svg} viewBox="0 34 400 74" role="img" aria-label={`${copy.labelA} ${fa}, ${copy.labelB} ${fb}, ${verdict}`} style={{ width: "100%", height: "auto", overflow: "visible" }}>
        <defs>
          <GooFilter id={`${fid}g`} blur="breakeven" />
          <pattern id={`${fid}h`} width={7} height={7} patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1={0} y1={0} x2={0} y2={7} stroke="currentColor" strokeWidth={1} opacity={0.38} /></pattern>
          <clipPath id={`${fid}c`}><rect x={24} y={46} width={352} height={38} rx={19} /></clipPath>
        </defs>
        <g clipPath={`url(#${fid}c)`}>
          <rect x={24} y={46} width={352} height={38} fill={`url(#${fid}h)`} />
          <path fill="currentColor" {...p("f")} />
          <line stroke="var(--mz-tick)" strokeLinecap="round" strokeWidth={2} x1={194} x2={194} y1={52} y2={78} {...p("k1")} />
          <line stroke="var(--mz-tick)" strokeLinecap="round" strokeWidth={2} x1={206} x2={206} y1={52} y2={78} {...p("k2")} />
        </g>
        <rect {...hair} x={24} y={46} width={352} height={38} rx={19} />
        <line {...hair} opacity={0.32} strokeDasharray="3 4" x1={200} x2={200} y1={38} y2={104} />
        {Array.from({ length: 21 }, (_, i) => { const x = (24 + i * 17.6).toFixed(1); return <line key={i} {...hair} opacity={0.16} x1={x} x2={x} y1={94} y2={98} />; })}
        <g filter={goo ? `url(#${fid}g)` : undefined}><rect fill={red ? "var(--mz-red)" : "var(--mz-tick)"} y={58} width={22} height={14} rx={7} {...p("bub")} /></g>
      </svg>
      <span className="mz-instrument-label" style={{ textAlign: "center", fontSize: 11, opacity: 0.7 }}>{copy.axis}</span>
      <Verdict category={category} text={verdict} red={red} />
    </Frame>
  );
}
