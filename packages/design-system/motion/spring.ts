import { motion } from "../dist/motion-tokens";

/** Motion constants from tokens.json (one source for web and Flutter). */
export const M = motion;
export const SPRING = motion.spring;
export const GOO = motion.goo;
export const TAU = Math.PI * 2;

export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
/** Rounded for an SVG attribute: 2 decimals, never "-0". */
export const r2 = (n: number) => { const v = Math.round(n * 100) / 100; return String(Object.is(v, -0) ? 0 : v); };

export interface Spring { x: number; v: number }
export const S = (x = 0): Spring => ({ x, v: 0 });

/** A damped spring toward `to` with stiffness k and damping ratio z. `snap` (reduced motion) jumps there. */
export function spring(s: Spring, to: number, dt: number, k: number, z: number, snap = false) {
  if (snap) { s.x = to; s.v = 0; return; }
  const c = 2 * z * Math.sqrt(k);
  s.v += (k * (to - s.x) - c * s.v) * dt;
  s.x += s.v * dt;
}

/** The same spring with an absolute damping coefficient c (the pack's pair and level masses). */
export function springC(s: Spring, to: number, dt: number, k: number, c: number, snap = false) {
  if (snap) { s.x = to; s.v = 0; return; }
  s.v += (k * (to - s.x) - c * s.v) * dt;
  s.x += s.v * dt;
}

/** Element attributes for one frame: { elementKey: { attribute: value } }. */
export type Attrs = Record<string, Record<string, string>>;

/** The goo filter's alpha matrix: α' = a·A + b. */
export const gooMatrix = (m: { a: number; b: number }) => `1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${m.a} ${m.b}`;
