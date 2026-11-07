import { clamp, M, r2, type Attrs } from "../spring";

/**
 * DROP: one red drop falls into a level surface (duration.fall) and the ripple dies out flat
 * (duration.ripple). Used while the viewer's own save, confirmation or payment link is on its way.
 */
export const VIEW = [120, 84] as const;
export const SURFACE = 62;
export const SURFACE_X: number[] = [];
for (let x = 12; x <= 108; x += 6) SURFACE_X.push(x);
export const PERIOD = 2.4;
const FALL = M.duration.fall / 1000, Y0 = 4;

export interface DropState { t: number }
export const init = (_input?: unknown): DropState => ({ t: 0 });

/** The surface lift at distance d from the impact, tau seconds after it (0 before it). */
export function ripple(d: number, tau: number) {
  if (tau <= 0 || d >= tau * 70) return 0;
  return 7.5 * Math.exp(-tau * 2.6) * Math.cos(d * 0.17 - tau * 15) * Math.exp(-d * 0.02);
}

/** The drop's centre y at cycle time c (it reaches the surface at duration.fall). */
export function dropY(c: number) {
  if (c < FALL) { const k = c / FALL; return Y0 + (SURFACE - 4 - Y0) * k * k; }
  const k = clamp((c - FALL) / 0.5, 0, 1);
  return SURFACE - 2 + 8 * (1 - (1 - k) ** 3) - 1.2 * Math.sin(k * 9) * (1 - k);
}

function frame(c: number, settled: boolean): Attrs {
  const out: Attrs = {};
  if (!settled && c < FALL) {
    const k = c / FALL, y = dropY(c), stretch = 1 + k * 0.35;
    out.drop = { cy: r2(y), rx: r2(5.4 / Math.sqrt(stretch)), ry: r2(6 * stretch), opacity: "1" };
    out.tail = { cy: r2(y - 7 * stretch), r: r2(2.6 * k) };
  } else {
    const k = settled ? 1 : clamp((c - FALL) / 0.5, 0, 1);
    const fade = settled ? 1 : 1 - clamp((c - (PERIOD - 0.35)) / 0.3, 0, 1);
    out.drop = { cy: r2(settled ? SURFACE + 6 : dropY(c)), rx: r2(5.4 + 1.4 * k), ry: r2(6.6 - 2.6 * k), opacity: r2(fade) };
    out.tail = { cy: r2(SURFACE - 8), r: "0" };
  }
  const tau = settled ? 0 : c - FALL;
  SURFACE_X.forEach((x, i) => { out[`s${i}`] = { cy: r2(SURFACE - ripple(Math.abs(x - 60), tau)) }; });
  for (let i = 0; i < 2; i++) {
    if (!settled && tau > 0 && tau < 0.55) {
      const k = tau / 0.55, dir = i ? 1 : -1;
      out[`sp${i}`] = { cx: r2(60 + dir * 16 * k), cy: r2(SURFACE - 4 - 22 * Math.sin(k * Math.PI)), r: r2(3.2 * (1 - k * 0.4)) };
    } else out[`sp${i}`] = { cx: "60", cy: r2(SURFACE - 2), r: "0" };
  }
  return out;
}

export function step(S: DropState, dt: number, _input?: unknown, reduced = false): Attrs {
  if (reduced) return rest();
  S.t += dt;
  return frame(S.t % PERIOD, false);
}

/** The still frame: the drop resting on the surface, the ripple flat. */
export const rest = (_input?: unknown): Attrs => frame(0, true);
