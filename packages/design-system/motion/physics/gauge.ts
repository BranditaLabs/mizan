import { clamp, r2, S as spr, spring, SPRING, type Attrs, type Spring } from "../spring";
import { advance, base, type InstrumentBase } from "./instrument";

/**
 * GAUGE (TIP): a level vial tips toward the heavier value and the bubble runs to the light side.
 * Fix (bug 9): one denominator, max(|A|, 1), for both short and over, so "short by 1.3%" and
 * "over by 1.3%" mean the same distance.
 */
export const VIEW = [400, 200] as const;
const REST = [5, 0, -5];

export interface GaugeInput { a: number; b: number }
export interface GaugeState extends InstrumentBase { th: Spring; m: Spring[] }

/** The relative difference (B − A) / max(|A|, 1). */
export const relative = ({ a, b }: GaugeInput) => (b - a) / Math.max(Math.abs(a), 1);

/** The settled tilt in degrees: sensitive near zero, like a real level, capped at 11°. */
export function tilt(input: GaugeInput) {
  const rel = relative(input);
  return Math.sign(rel) * Math.min(11, Math.sqrt(Math.abs(rel)) * 45);
}

export function init(input: GaugeInput): GaugeState {
  const th = tilt(input), goal = clamp(-th * 9, -100, 100);
  return { ...base(), th: spr(th), m: [spr(goal), spr(goal), spr(goal)] };
}

function frame(S: GaugeState): Attrs {
  const th = S.th.x, r = (th * Math.PI) / 180;
  const out: Attrs = {
    rot: { transform: `rotate(${r2(th)} 200 100)` },
    needle: { x2: r2(200 - 50 * Math.sin(r)), y2: r2(100 + 50 * Math.cos(r)) },
  };
  const goal = clamp(-th * 9, -100, 100);
  const sp = Math.max(...S.m.map((s) => Math.abs(s.v)));
  const dir = Math.sign(goal - S.m[1].x) || 1, sq = clamp(sp * 0.01, 0, 1.4);
  S.m.forEach((s, i) => { out[`b${i}`] = { cx: r2(200 + s.x + REST[i] * dir * (1 - sq * 0.3)), r: r2(8.6 - sq * (i === 1 ? 0.5 : 1.2)) }; });
  const on = clamp(1 - Math.abs(S.m[1].x) / 4, 0, 1);
  out.t1 = out.t2 = { opacity: r2(0.45 + 0.55 * on) };
  return out;
}

export function step(S: GaugeState, dt: number, input: GaugeInput, reduced = false): Attrs {
  advance(S, dt, reduced);
  const { k, z, massK, massZ } = SPRING.gauge;
  spring(S.th, tilt(input), dt, k, z, reduced);
  const goal = clamp(-S.th.x * 9, -100, 100);
  S.m.forEach((s, i) => spring(s, goal, dt, massK[i], massZ, reduced));
  return frame(S);
}

/** Settled on the reading, computed directly (no warm-up ticks). */
export const rest = (input: GaugeInput): Attrs => frame(init(input));
