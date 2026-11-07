"use client";
import * as vessels from "../../../motion/physics/vessels";
import { formatInt, formatPct, isolate } from "../../../motion/format";
import { attrProps } from "../useMotionClock";
import { Frame, GooFilter, Reading, ReadingRow, useInstrument, Verdict } from "./shared";

export interface VesselsCopy {
  title: string;
  labelA: string;
  labelB: string;
  matched: string;
  gap: (pct: string) => string;
  /** "{n} pcs" in the store's words; omit for a bare number. */
  unit?: (n: string) => string;
}

export interface VesselsProps { a: number; b: number; locale: string; copy: VesselsCopy; className?: string }

const hair = { fill: "none", stroke: "currentColor", strokeWidth: 1, vectorEffect: "non-scaling-stroke" as const };
const vessel = (x: number) => `M${x} 22 V178 Q${x} 196 ${x + 18} 196 H${x + 62} Q${x + 80} 196 ${x + 80} 178 V22`;
const inner = (x: number) => `M${x + 4} 22 V176 Q${x + 4} 192 ${x + 20} 192 H${x + 60} Q${x + 76} 192 ${x + 76} 176 V22 Z`;

/** VESSELS: in the system against counted (a stock count, a PO received). Equal counts join into one horizon. */
export function Vessels({ a, b, locale, copy, className }: VesselsProps) {
  const input = { a, b };
  const category = a === b ? "matched" : "gap";
  const pct = isolate(formatPct(vessels.gap(input), locale, 1));
  const verdict = category === "matched" ? copy.matched : copy.gap(pct);
  const { svg, fid, goo, red, rest } = useInstrument(vessels, input, category === "matched");
  const p = (k: string) => attrProps(rest, k);
  const n = (v: number) => (copy.unit ? copy.unit(formatInt(v, locale)) : formatInt(v, locale));
  const top = vessels.scaleTop(input);
  // The scale shows the real values (bug 13): 0, half and the top of the scale, in the values' units.
  // Physical left on purpose: the scale and its ticks are drawn at x=40..52 and do not mirror.
  const marks = [0, top / 2, top];
  return (
    <Frame title={copy.title} className={className}>
      <div style={{ position: "relative" }}>
        <svg ref={svg} viewBox="0 16 400 212" role="img" aria-label={`${copy.labelA} ${n(a)}, ${copy.labelB} ${n(b)}, ${verdict}`} style={{ width: "100%", height: "auto", overflow: "visible", display: "block" }}>
          <defs>
            <GooFilter id={`${fid}g`} blur="vessels" />
            <clipPath id={`${fid}cl`}><path d={inner(96)} /></clipPath>
            <clipPath id={`${fid}cr`}><path d={inner(224)} /></clipPath>
          </defs>
          <line {...hair} opacity={0.32} x1={52} x2={52} y1={32} y2={196} />
          {Array.from({ length: 11 }, (_, i) => { const y = 196 - i * 16.4; return <line key={i} {...hair} opacity={i % 5 ? 0.16 : 0.32} x1={i % 5 ? 46 : 40} x2={52} y1={y.toFixed(1)} y2={y.toFixed(1)} />; })}
          <path {...hair} d={vessel(96)} /><path {...hair} d={vessel(224)} />
          <path fill="currentColor" d="M129 196 V211 Q129 219 137 219 H263 Q271 219 271 211 V196 H261 V205 Q261 209 257 209 H143 Q139 209 139 205 V196 Z" />
          <path {...hair} d="M126 196 V212 Q126 222 136 222 H264 Q274 222 274 212 V196" />
          <path {...hair} d="M142 196 V204 Q142 206 144 206 H256 Q258 206 258 204 V196" />
          <path fill="currentColor" clipPath={`url(#${fid}cl)`} {...p("fl")} />
          <path fill="currentColor" clipPath={`url(#${fid}cr)`} {...p("fr")} />
          <line {...hair} opacity={0.32} strokeDasharray="3 4" x1={52} x2={100} {...p("hl")} />
          <line {...hair} opacity={0.32} strokeDasharray="3 4" x1={52} x2={228} {...p("hr")} />
          <g {...p("br")}>
            <line {...hair} x1={200} x2={200} {...p("bl")} />
            <line {...hair} x1={195} x2={205} {...p("bt")} />
            <line {...hair} x1={195} x2={205} {...p("bb")} />
          </g>
          <g {...p("lv")}>
            <line {...hair} x1={92} x2={308} {...p("hz")} />
            <g filter={goo ? `url(#${fid}g)` : undefined}><rect fill={red ? "var(--mz-red)" : "currentColor"} x={188} width={24} height={14} rx={7} {...p("drop")} /></g>
          </g>
        </svg>
        {marks.map((v) => (
          <bdi key={v} className="mz-figure" aria-hidden="true" style={{ position: "absolute", left: 0, top: `${((vessels.scaleY(v, input) - 16) / 212) * 100}%`, transform: "translateY(-50%)", fontSize: 10, opacity: 0.62 }}>{formatInt(v, locale)}</bdi>
        ))}
      </div>
      <ReadingRow spread="around">
        <Reading label={copy.labelA} value={n(a)} side="center" />
        <Reading label={copy.labelB} value={n(b)} side="center" />
      </ReadingRow>
      <Verdict category={category} text={verdict} red={red} />
    </Frame>
  );
}
