import { clamp, r2, S as spr, spring, SPRING, type Attrs, type Spring } from "../spring";
import { advance, base, type InstrumentBase } from "./instrument";

/**
 * VESSELS (MERGE): two connected vessels, one value each; a bracket measures the gap, and equal
 * values join into one horizon with the drop on it. Fix (bug 13): the scale is the real values
 * (scaleTop), not a fixed 0–100.
 */
export const VIEW = [400, 228] as const;
const FLOOR = 196, HEIGHT = 164;

export interface VesselsInput { a: number; b: number }
export interface VesselsState extends InstrumentBase { hA: Spring; hB: Spring }

/** The top of the scale in the values' own units (the taller vessel at 85% of the height). */
export const scaleTop = ({ a, b }: VesselsInput) => Math.max(a, b, 1) * 1.18;
/** The gap in percent of the larger value. */
export const gap = ({ a, b }: VesselsInput) => (Math.abs(a - b) / Math.max(a, b, 1)) * 100;
/** y of a scale mark at `value` (for the HTML labels beside the SVG). */
export const scaleY = (value: number, input: VesselsInput) => FLOOR - (value / scaleTop(input)) * HEIGHT;

export function init(input: VesselsInput): VesselsState {
  const max = scaleTop(input);
  return { ...base(), hA: spr(input.a / max), hB: spr(input.b / max) };
}

function surf(S: VesselsState, x0: number, x1: number, y: number, ph: number, ambient: boolean) {
  let d = `M${x0} ${r2(y)}`;
  for (let x = x0; x <= x1; x += 4) {
    const w = ambient ? S.wob * 3.2 * Math.sin(x * 0.11 + S.t * 7 + ph) * Math.sin(((x - x0) / (x1 - x0)) * Math.PI) + Math.sin(x * 0.05 + S.t * 1.6 + ph) * 0.5 : 0;
    d += ` L${x} ${r2(y + w)}`;
  }
  return `${d} L${x1} 200 L${x0} 200 Z`;
}

function frame(S: VesselsState, input: VesselsInput, ambient: boolean): Attrs {
  const yA = FLOOR - S.hA.x * HEIGHT, yB = FLOOR - S.hB.x * HEIGHT;
  const bal = clamp(1 - gap(input) / 0.6, 0, 1);
  const top = Math.min(yA, yB), bot = Math.max(yA, yB), yl = (yA + yB) / 2;
  return {
    fl: { d: surf(S, 98, 176, yA, 0, ambient) },
    fr: { d: surf(S, 226, 304, yB, 1.7, ambient) },
    hl: { y1: r2(yA), y2: r2(yA) },
    hr: { y1: r2(yB), y2: r2(yB) },
    br: { opacity: r2(1 - bal) },
    lv: { opacity: r2(bal) },
    bl: { y1: r2(top), y2: r2(bot) },
    bt: { y1: r2(top), y2: r2(top) },
    bb: { y1: r2(bot), y2: r2(bot) },
    hz: { y1: r2(yl), y2: r2(yl) },
    drop: { y: r2(yl - 7 - (1 - bal) * 20) },
  };
}

export function step(S: VesselsState, dt: number, input: VesselsInput, reduced = false): Attrs {
  const ambient = advance(S, dt, reduced);
  const max = scaleTop(input), { k, z } = SPRING.vessels;
  spring(S.hA, input.a / max, dt, k, z, reduced);
  spring(S.hB, input.b / max, dt, k, z, reduced);
  return frame(S, input, ambient);
}

export const rest = (input: VesselsInput): Attrs => frame(init(input), input, false);
