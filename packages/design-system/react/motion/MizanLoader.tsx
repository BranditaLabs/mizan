"use client";
import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from "react";
import { GOO, gooMatrix, M } from "../../motion/spring";
import { RED_PRIORITY } from "../../motion/red-budget";
import * as pair from "../../motion/physics/pair";
import * as level from "../../motion/physics/level";
import * as transfer from "../../motion/physics/transfer";
import * as drop from "../../motion/physics/drop";
import * as fill from "../../motion/physics/fill";
import type { LoaderKind } from "../../motion/index";
import { attrProps, useMotionClock, useSvgId, type PhysicsModule } from "./useMotionClock";
import { useReducedMotion } from "./useReducedMotion";
import { useRed } from "./RedBudget";

const PHYSICS = { pair, level, transfer, drop, fill } as unknown as Record<LoaderKind, PhysicsModule<unknown, fill.FillInput>>;
const VIEW: Record<LoaderKind, readonly [number, number]> = { pair: pair.VIEW, level: level.VIEW, transfer: transfer.VIEW, drop: drop.VIEW, fill: fill.VIEW };

export interface MizanLoaderProps {
  /** What is happening (picked by a surface from the catalogue or state, never by a screen). */
  kind?: LoaderKind;
  /** Rendered width in px; the height follows the kind's aspect. */
  size?: number;
  /** fill: progress 0..1 (omit for an indeterminate loop). */
  value?: number | null;
  /** mono (default): red becomes currentColor. brand: claims the view's one red; refused → mono. */
  tone?: "brand" | "mono";
  /** Inside a busy button or a row: aria-hidden, the host carries the state. */
  decorative?: boolean;
  /** Required unless decorative (role="status" / progressbar / slider label). */
  label?: string;
  /** fill with a value: the spoken and shown value ("3 of 10", "30%"). */
  valueText?: string;
  /** Landing hero only (pair, level): the pointer and arrow keys tip the balance. */
  interactive?: boolean;
  /** A list row, a bell item: the still frame, no clock. */
  still?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * <MizanLoader>: the Brand 2.0 loaders as one SSR-safe component. The server renders the still
 * frame as plain SVG; the client hydrates the same markup and then joins the shared clock. Reduced
 * motion shows each kind's deliberate still frame (pair: level and apart; transfer: equal volumes;
 * drop: at rest on the surface; fill: the width with its value as text; level: centred).
 */
export function MizanLoader({ kind = "pair", size = 96, value, tone = "mono", decorative, label, valueText, interactive, still, className, style }: MizanLoaderProps) {
  const svg = useRef<SVGSVGElement>(null);
  const fid = useSvgId();
  const reduced = useReducedMotion();
  const red = useRed(fid, RED_PRIORITY.pageLoader, tone === "brand");
  const physics = PHYSICS[kind];
  const input = { value: kind === "fill" ? value ?? null : null };
  const stateRef = useRef<unknown>(null);
  const { goo } = useMotionClock({ svg, physics, input, animate: !still, reduced, stateRef });
  const [w, h] = VIEW[kind];
  const at = physics.rest(input);
  const p = (k: string) => attrProps(at, k);
  const canAim = interactive && (kind === "pair" || kind === "level");

  // Interactive: listeners attached once and removed on cleanup; reduced sets the angle directly.
  useEffect(() => {
    const el = svg.current;
    if (!canAim || !el) return;
    const aimer = kind === "pair" ? pair.aim : level.aim;
    const st = () => stateRef.current as pair.PairState & level.LevelState;
    const at = (x: number | null) => { if (st()) aimer(st(), x); };
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
    const s = stateRef.current as pair.PairState | null;
    if (!s) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); (kind === "pair" ? pair.aim : level.aim)(s as never, e.key === "ArrowLeft" ? -0.9 : 0.9); }
  };
  const onKeyUp = () => { const s = stateRef.current; if (s) (kind === "pair" ? pair.aim : level.aim)(s as never, null); };

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
        ? { role, "aria-label": label, "aria-valuemin": -M.angle.tip, "aria-valuemax": M.angle.tip, "aria-valuenow": 0, tabIndex: 0, onKeyDown: onKey, onKeyUp }
        : { role, "aria-label": label };

  return (
    <span className={className} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 4, lineHeight: 0, verticalAlign: "middle", ...style }} data-mz-red={tone === "brand" ? (red ? "on" : "off") : undefined}>
      <svg ref={svg} viewBox={`0 0 ${w} ${h}`} style={{ width: size, height: "auto", overflow: "visible", display: "block", touchAction: canAim ? "pan-y" : undefined, cursor: canAim ? "ew-resize" : undefined }} {...a11y}>
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
