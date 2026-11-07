import { r2, S as spr, spring, SPRING, type Attrs, type Spring } from "../spring";
import { advance, base, type InstrumentBase } from "./instrument";

/**
 * BULLSEYE (MERGE): a round spirit level reading two differences at once, x = cash Δ%, y = stock Δ%.
 * The inner ring is the tolerance (a prop, default ±2%, a store setting). Fix (bug 12): a reading
 * past the rim is clamped to it and reported as "off scale", never shown as a near miss.
 */
export const VIEW = [260, 260] as const;
const C = 130, RING = 24, RIM = 80;
export const DEFAULT_TOLERANCE = 2;

export interface BullseyeInput { x: number; y: number; tolerance?: number }
export interface BullseyeState extends InstrumentBase { p: { x: Spring; y: Spring }[] }

export type BullseyeVerdict = "level" | "inside" | "off" | "offScale";

/** The bubble's offset from the centre in view units, clamped to the rim. */
export function target({ x, y, tolerance = DEFAULT_TOLERANCE }: BullseyeInput) {
  const k = RING / Math.max(tolerance, 0.01);
  let tx = x * k, ty = -y * k;
  const r = Math.hypot(tx, ty);
  const clamped = r > RIM;
  if (clamped) { tx *= RIM / r; ty *= RIM / r; }
  return { tx, ty, clamped };
}

export function verdict(input: BullseyeInput): BullseyeVerdict {
  const d = Math.hypot(input.x, input.y);
  if (target(input).clamped) return "offScale";
  if (d < 0.05) return "level";
  return d <= (input.tolerance ?? DEFAULT_TOLERANCE) ? "inside" : "off";
}

export function init(input: BullseyeInput): BullseyeState {
  const { tx, ty } = target(input);
  return { ...base(), p: [0, 1, 2].map(() => ({ x: spr(tx), y: spr(ty) })) };
}

const frame = (S: BullseyeState): Attrs => Object.fromEntries(S.p.map((p, i) => [`b${i}`, { cx: r2(C + p.x.x), cy: r2(C + p.y.x) }]));

export function step(S: BullseyeState, dt: number, input: BullseyeInput, reduced = false): Attrs {
  advance(S, dt, reduced);
  const { tx, ty } = target(input), { massK, massZ } = SPRING.bullseye;
  S.p.forEach((p, i) => { spring(p.x, tx, dt, massK[i], massZ, reduced); spring(p.y, ty, dt, massK[i], massZ, reduced); });
  return frame(S);
}

export const rest = (input: BullseyeInput): Attrs => frame(init(input));
