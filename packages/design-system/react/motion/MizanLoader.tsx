"use client";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { clamp, GOO, gooMatrix, M } from "../../motion/spring";
import { RED_PRIORITY } from "../../motion/red-budget";
import * as pair from "../../motion/physics/pair";
import * as level from "../../motion/physics/level";
import * as transfer from "../../motion/physics/transfer";
import * as drop from "../../motion/physics/drop";
import * as fill from "../../motion/physics/fill";
import type { LoaderKind } from "../../motion/index";
import { attrProps, useMotionClock, useSvgId, writeFrame, type PhysicsModule } from "./useMotionClock";
import { useReducedMotion } from "./useReducedMotion";
import { useRed } from "./RedBudget";

const warned = new Set<string>();
const dev = () => { try { return process.env.NODE_ENV !== "production"; } catch { return false; } };
const warnOnce = (msg: string) => { if (!warned.has(msg)) { warned.add(msg); console.warn(msg); } };

const PHYSICS = { pair, level, transfer, drop, fill } as unknown as Record<LoaderKind, PhysicsModule<unknown, fill.FillInput>>;
const VIEW: Record<LoaderKind, readonly [number, number]> = { pair: pair.VIEW, level: level.VIEW, transfer: transfer.VIEW, drop: drop.VIEW, fill: fill.VIEW };

interface LoaderCommon {
  /** Rendered width in px; the height follows the kind's aspect. */
  size?: number;
  /** mono (default): red becomes currentColor. brand: claims the view's one red; refused → mono. */
  tone?: "brand" | "mono";
  /** Inside a busy button or a row: aria-hidden, the host carries the state. */
  decorative?: boolean;
  /** Required unless decorative (role="status" / progressbar / slider label). */
  label?: string;
  /** Landing hero only (pair, level): the pointer and arrow keys tip the balance. */
  interactive?: boolean;
  /** A list row, a bell item: the still frame, no clock. */
  still?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * What is happening (picked by a surface from the catalogue or state, never by a screen). FILL is
 * known progress with a real value: `kind="fill"` requires `value` (0..1) and `valueText` ("3 of
 * 10", "30%"), so an indeterminate fill is a type error. A wait with no value is pair, transfer or drop.
 */
export type MizanLoaderProps = LoaderCommon & (
  | { kind?: Exclude<LoaderKind, "fill">; value?: undefined; valueText?: undefined }
  | { kind: "fill"; value: number; valueText: string }
);

/**
 * <MizanLoader>: the Brand 2.0 loaders as one SSR-safe component. The server renders the still
 * frame as plain SVG; the client hydrates the same markup and then joins the shared clock. Reduced
 * motion shows each kind's deliberate still frame (pair: merged at level, the mark; transfer: equal volumes;
 * drop: at rest on the surface; fill: the width with its value as text; level: centred).
 */
export function MizanLoader(props: MizanLoaderProps) {
  const { kind = "pair", size = 96, value, tone = "mono", decorative, label, valueText, interactive, still, className, style } = props;
  if (kind === "fill" && typeof value !== "number" && dev()) warnOnce("[mizan motion] <MizanLoader kind=\"fill\"> needs a real value: an indeterminate wait is pair, transfer or drop");
  const svg = useRef<SVGSVGElement>(null);
  const fid = useSvgId();
  const reduced = useReducedMotion();
  const red = useRed(fid, RED_PRIORITY.pageLoader, tone === "brand");
  const physics = PHYSICS[kind];
  const input = { value: kind === "fill" ? value ?? null : null };
  const stateRef = useRef<unknown>(null);
  const { goo } = useMotionClock({ svg, physics, input, animate: !still, reduced, stateRef });
  const [w, h] = VIEW[kind];
  // The rest frame is rendered once per kind: afterwards the clock or the still effect owns the
  // attributes, so a new value animates from the current one (React never writes the target first).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const at = useMemo(() => physics.rest(input), [kind]);
  const p = (k: string) => attrProps(at, k);
  const canAim = interactive && (kind === "pair" || kind === "level");
  // The slider's value: the beam angle in whole degrees (aria-valuenow follows it).
  const [angle, setAngle] = useState(0);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  /** Aim the beam; reduced motion has no clock, so the frame is written here at once. */
  const aimAt = useRef<(a: number | null) => void>(() => undefined);
  aimAt.current = (a: number | null) => {
    const s = stateRef.current as (pair.PairState & level.LevelState) | null;
    if (!s) return;
    (kind === "pair" ? pair.aim : level.aim)(s, a);
    const deg = a == null ? 0 : kind === "pair" ? clamp(a * 9 * 2.2, -M.angle.tip, M.angle.tip) : a * 9;
    setAngle(Math.round(deg));
    if (reducedRef.current && svg.current) writeFrame(svg.current, physics.step(s, 0, input, true));
  };

  // Interactive: listeners attached once and removed on cleanup; reduced sets the angle directly.
  useEffect(() => {
    const el = svg.current;
    if (!canAim || !el) return;
    const at = (x: number | null) => aimAt.current(x);
    const move = (e: globalThis.PointerEvent) => { const r = el.getBoundingClientRect(); at(Math.max(-1.4, Math.min(1.4, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)))); };
    const leave = () => at(null);
    const up = (e: globalThis.PointerEvent) => { if (e.pointerType !== "mouse") at(null); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerdown", move);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("pointerup", up);
    return () => {
      el.removeEventListener("pointermove", move); el.removeEventListener("pointerdown", move);
      el.removeEventListener("pointerleave", leave); el.removeEventListener("pointerup", up);
    };
  }, [canAim, kind]);

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); aimAt.current(e.key === "ArrowLeft" ? -0.9 : 0.9); }
  };
  const onKeyUp = () => aimAt.current(null);

  const redFill = red ? "var(--mz-red)" : "currentColor";
  const filter = goo ? `url(#${fid})` : undefined;
  const blur = GOO.loader[kind];
  const pct = value == null ? undefined : Math.round(Math.max(0, Math.min(1, value)) * 100);

  const role = decorative ? undefined : kind === "fill" && value != null ? "progressbar" : canAim ? "slider" : "status";
  const a11y = decorative
    ? { "aria-hidden": true as const }
    : role === "progressbar"
      ? { role, "aria-label": label, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": pct, "aria-valuetext": valueText }
      : role === "slider"
        ? { role, "aria-label": label, "aria-valuemin": -M.angle.tip, "aria-valuemax": M.angle.tip, "aria-valuenow": angle, "aria-valuetext": `${angle}°`, tabIndex: 0, onKeyDown: onKey, onKeyUp }
        : { "aria-hidden": true as const };
  // A status loader: live regions announce their text, not an aria-label, so the label is a
  // visually hidden text node inside the status wrapper (the SVG itself is hidden).
  const status = role === "status";

  return (
    <span className={className} role={status ? "status" : undefined} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 4, lineHeight: 0, verticalAlign: "middle", ...style }} data-loader={kind} data-mz-red={tone === "brand" ? (red ? "on" : "off") : undefined}>
      {status && label ? <span className="mz-sr">{label}</span> : null}
      <svg ref={svg} viewBox={`0 0 ${w} ${h}`} className={kind === "fill" ? "mz-fill-track" : undefined} style={{ width: size, height: "auto", overflow: "visible", display: "block", touchAction: canAim ? "pan-y" : undefined, cursor: canAim ? "ew-resize" : undefined }} {...a11y}>
        <defs>
          <filter id={fid} x={-20} y={-40} width={w + 40} height={h + 80} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation={blur} />
            <feColorMatrix values={gooMatrix(GOO.loaderMatrix)} />
          </filter>
          {(kind === "fill" || kind === "level") && (
            <clipPath id={`${fid}c`}>{kind === "fill" ? <rect x={4} y={7} width={232} height={16} rx={8} /> : <rect x={6} y={11} width={108} height={38} rx={19} />}</clipPath>
          )}
        </defs>
        {kind === "pair" && (
          <g filter={filter}>
            <circle fill="currentColor" {...p("L0")} /><circle fill="currentColor" {...p("L1")} />
            <circle fill={redFill} {...p("R0")} /><circle fill={redFill} {...p("R1")} />
          </g>
        )}
        {kind === "level" && (
          <g {...p("g")}>
            <rect fill="currentColor" x={6} y={11} width={108} height={38} rx={19} />
            <g clipPath={`url(#${fid}c)`}>
              <path d="M28 16.5H92" stroke="var(--mz-tick)" strokeWidth={1.2} strokeLinecap="round" opacity={0.16} fill="none" />
              <line x1={43} x2={43} y1={19} y2={41} stroke="var(--mz-tick)" strokeWidth={2.6} strokeLinecap="round" {...p("tk0")} />
              <line x1={77} x2={77} y1={19} y2={41} stroke="var(--mz-tick)" strokeWidth={2.6} strokeLinecap="round" {...p("tk1")} />
              <g filter={filter}>{[0, 1, 2].map((i) => <circle key={i} fill={redFill} cy={30} {...p(`b${i}`)} />)}</g>
            </g>
          </g>
        )}
        {kind === "transfer" && (
          <>
            <g filter={filter} fill="currentColor">
              <line x1={34} x2={86} y1={30} y2={30} stroke="currentColor" strokeLinecap="round" {...p("thread")} />
              <circle cx={34} cy={30} {...p("L")} /><circle cx={86} cy={30} {...p("R")} />
              {Array.from({ length: transfer.DROPLETS }, (_, i) => <circle key={i} cy={30} {...p(`d${i}`)} />)}
            </g>
            <ellipse fill={redFill} cx={60} cy={30} {...p("pivot")} />
          </>
        )}
        {kind === "drop" && (
          <>
            <g filter={filter} fill="currentColor">
              <rect x={8} y={62} width={104} height={12} rx={6} />
              {drop.SURFACE_X.map((x, i) => <circle key={x} cx={x} r={4.6} {...p(`s${i}`)} />)}
              <circle {...p("sp0")} /><circle {...p("sp1")} />
            </g>
            <g filter={filter} fill={redFill}>
              <ellipse cx={60} {...p("drop")} /><circle cx={60} {...p("tail")} />
            </g>
          </>
        )}
        {kind === "fill" && (
          <>
            <rect fill="currentColor" opacity={0.14} x={4} y={7} width={232} height={16} rx={8} />
            <g clipPath={`url(#${fid}c)`}>
              <g filter={filter} fill="currentColor">
                <rect x={-10} y={4} height={22} {...p("rect")} />
                {Array.from({ length: fill.MENISCUS }, (_, i) => <circle key={i} r={3.4} {...p(`m${i}`)} />)}
              </g>
              <ellipse fill={redFill} cy={15} rx={4.2} ry={3} {...p("bub")} />
            </g>
          </>
        )}
      </svg>
      {kind === "fill" && reduced && valueText ? <bdi className="mz-figure" style={{ lineHeight: 1.2, fontSize: 12 }} aria-hidden="true">{valueText}</bdi> : null}
    </span>
  );
}
