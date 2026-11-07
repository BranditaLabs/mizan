import { clamp, r2, S as spr, spring, SPRING, type Attrs, type Spring } from "../spring";
import { advance, base, type InstrumentBase } from "./instrument";

/**
 * BREAK-EVEN (TIP): profit (liquid) and spend (hatch) push against one meniscus; the centre ticks are
 * break-even. Fixes: a loss (A < 0) empties the bar instead of drawing past it, no spend (B = 0)
 * fills it (bug 10), and the bubble is centred on the meniscus (bug 11).
 */
export const VIEW = [400, 108] as const;
const X0 = 24, W = 352, MID = 200;

export interface BreakevenInput { a: number; b: number }
export interface BreakevenState extends InstrumentBase { p: Spring }

/** The profit's share of the bar, 0..1 (a loss is 0, no spend is 1). */
export function share({ a, b }: BreakevenInput) {
  if (a <= 0) return 0;
  if (b <= 0) return 1;
  return clamp(a / (a + b), 0, 1);
}

export const init = (input: BreakevenInput): BreakevenState => ({ ...base(), p: spr(share(input)) });

function frame(S: BreakevenState, ambient: boolean): Attrs {
  const xi = X0 + S.p.x * W;
  let d = `M10 40 L${r2(xi)} 40`;
  for (let y = 42; y <= 88; y += 3) {
    const w = ambient ? S.wob * 4 * Math.sin(y * 0.3 + S.t * 9) + Math.sin(y * 0.22 + S.t * 2.4) * 1.3 : 0;
    d += ` L${r2(xi + w)} ${y}`;
  }
  const on = clamp(1 - Math.abs(xi - MID) / 6, 0, 1);
  return {
    f: { d: `${d} L10 90 Z` },
    bub: { x: r2(xi - 11) },
    k1: { opacity: r2(0.35 + 0.65 * on) },
    k2: { opacity: r2(0.35 + 0.65 * on) },
  };
}

export function step(S: BreakevenState, dt: number, input: BreakevenInput, reduced = false): Attrs {
  const ambient = advance(S, dt, reduced);
  spring(S.p, share(input), dt, SPRING.breakeven.k, SPRING.breakeven.z, reduced);
  return frame(S, ambient);
}

export const rest = (input: BreakevenInput): Attrs => frame(init(input), false);
