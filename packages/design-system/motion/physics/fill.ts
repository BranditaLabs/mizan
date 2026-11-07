import { clamp, r2, SPRING, type Attrs } from "../spring";

/**
 * FILL: known progress. Liquid fills the track with a living meniscus and the red bubble rides the
 * front. Fixes from the pack: at value 1 the bubble leaves past the track end and fades over 150ms
 * (it never parks in the middle), and a new value animates from the current one, not from 0.
 */
export const VIEW = [240, 30] as const;
export const MENISCUS = 5;
const X0 = 4, W = 232, FADE = 0.15;

export interface FillInput { value?: number | null }
export interface FillState { t: number; v: number; o: number }

/** Without a value the loader is indeterminate: a believable demo loop, then a drain. */
export function demo(t: number) {
  const T = 4.6, c = t % T, k = clamp(c / 3.6, 0, 1);
  if (c >= 3.6) return 1 - clamp((c - 3.9) / 0.6, 0, 1);
  return k < 0.35 ? (k / 0.35) * 0.42 : k < 0.7 ? 0.42 + ((k - 0.35) / 0.35) * 0.16 : 0.58 + ((k - 0.7) / 0.3) * 0.42;
}

const target = (input: FillInput | undefined, t: number) => (input?.value == null ? demo(t) : clamp(input.value, 0, 1));
const bubbleOn = (v: number) => v > 0.04 && v < 0.999;

export const init = (input?: FillInput): FillState => {
  const v = input?.value == null ? 0.5 : clamp(input.value, 0, 1);
  return { t: 0, v, o: bubbleOn(v) ? 1 : 0 };
};

function frame(S: FillState, wobble: boolean): Attrs {
  const xf = X0 + W * S.v;
  const out: Attrs = { rect: { width: r2(Math.max(0, xf + 8)) } };
  for (let i = 0; i < MENISCUS; i++) {
    const wob = wobble ? Math.sin(S.t * 7 + i * 1.3) * 1.6 + Math.sin(S.t * 4.1 + i) * 0.8 : 0;
    out[`m${i}`] = { cx: r2(xf + wob), cy: r2(9 + i * 3) };
  }
  // At the end the bubble keeps riding past the track end (clipped) while it fades out.
  const done = clamp((S.v - 0.985) / 0.015, 0, 1);
  out.bub = { cx: r2(Math.max(12, xf - 9 + 30 * done)), opacity: r2(S.o) };
  return out;
}

export function step(S: FillState, dt: number, input?: FillInput, reduced = false): Attrs {
  if (reduced) { S.v = input?.value == null ? 0.5 : clamp(input.value, 0, 1); S.o = bubbleOn(S.v) ? 1 : 0; return frame(S, false); }
  S.t += dt;
  S.v += (target(input, S.t) - S.v) * Math.min(1, dt * SPRING.fill.smoothing || 1);
  const want = bubbleOn(S.v) ? 1 : 0;
  S.o = want > S.o ? Math.min(1, S.o + dt / FADE) : Math.max(0, S.o - dt / FADE);
  return frame(S, true);
}

/** The still frame: the bar at its value (indeterminate: half), no wobble. */
export const rest = (input?: FillInput): Attrs => frame(init(input), false);
