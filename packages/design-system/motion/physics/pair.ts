import { clamp, M, r2, SPRING, TAU, type Attrs } from "../spring";

/**
 * PAIR, the mark in motion (TIP + MERGE): two fluid balls are the pans of a scale. They tip like a
 * beam (±angle.tip over duration.tip) and every time they pass level they flow into one drop.
 * Interactive: the pointer aims the beam; released, it springs back and merges at rest.
 */
export const VIEW = [120, 72] as const;
const CX = 60, CY = 36;

export interface PairState { t: number; aim: number | null; idle: number; ang: { x: number; v: number }; trail: { x: number; y: number; vx: number; vy: number }[]; phi: number; kiss: number }

export function init(_input?: unknown): PairState {
  return { t: 0, aim: null, idle: 9, ang: { x: 0, v: 0 }, trail: [{ x: CX - 21, y: CY, vx: 0, vy: 0 }, { x: CX + 21, y: CY, vx: 0, vy: 0 }], phi: 0, kiss: 0 };
}

/** The loop's beam angle (degrees) and merge amount (0..1) at time t. */
export function loop(t: number) {
  const w = TAU / (M.duration.tip / 1000);
  return { phi: M.angle.tip * Math.sin(w * t), kiss: Math.abs(Math.cos(w * t)) ** 6 };
}

function frame(S: PairState, phi: number, kiss: number, dt: number): Attrs {
  S.phi = phi; S.kiss = kiss;
  const r = (phi * Math.PI) / 180, D = 21 - 8.75 * kiss;
  const pts = [[CX - D * Math.cos(r), CY - D * Math.sin(r)], [CX + D * Math.cos(r), CY + D * Math.sin(r)]];
  const out: Attrs = {};
  const rad = 10.5 + 0.7 * kiss;
  pts.forEach(([x, y], i) => {
    const tr = S.trail[i];
    if (dt > 0) {
      tr.vx += (SPRING.pair.k * (x - tr.x) - SPRING.pair.c * tr.vx) * dt; tr.vy += (SPRING.pair.k * (y - tr.y) - SPRING.pair.c * tr.vy) * dt;
      tr.x += tr.vx * dt; tr.y += tr.vy * dt;
    } else { tr.x = x; tr.y = y; tr.vx = 0; tr.vy = 0; } // reduced: the trailing ball snaps
    const side = i ? "R" : "L";
    out[`${side}0`] = { cx: r2(x), cy: r2(y), r: r2(rad) };
    out[`${side}1`] = { cx: r2(tr.x), cy: r2(tr.y), r: r2(7.5 * clamp(Math.hypot(tr.vx, tr.vy) / 40, 0.5, 1)) };
  });
  return out;
}

export function step(S: PairState, dt: number, _input?: unknown, reduced = false): Attrs {
  if (reduced) return frame(S, S.aim != null ? clamp(S.aim * 2.2, -M.angle.tip, M.angle.tip) : 0, 0, 0);
  S.t += dt; S.idle += dt;
  if (S.aim != null || S.idle < 1.8) {
    // hand-driven: spring the beam toward the pointer, merge when it rests level
    const target = S.aim != null ? S.aim * 2.2 : 0;
    S.ang.v += (70 * (target - S.ang.x) - 2 * Math.sqrt(70) * 0.45 * S.ang.v) * dt;
    S.ang.x += S.ang.v * dt;
    const kiss = clamp(1 - Math.abs(S.ang.x) / 3 - Math.abs(S.ang.v) / 40, 0, 1) * (S.aim == null ? 1 : 0.4);
    return frame(S, S.ang.x, kiss, dt);
  }
  const { phi, kiss } = loop(S.t);
  S.ang.x = phi; S.ang.v = 0;
  return frame(S, phi, kiss, dt);
}

/** The still frame: two balls level and apart, as in the mark. */
export const rest = (_input?: unknown): Attrs => frame(init(), 0, 0, 0);

/** Pointer or key aim, -1.4..1.4 of the half width (null = released). */
export function aim(S: PairState, a: number | null) { S.aim = a == null ? null : a * 9; S.idle = 0; }
