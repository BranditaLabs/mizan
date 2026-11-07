import { clamp, r2, TAU, type Attrs } from "../spring";

/** TRANSFER: two masses trade volume through a liquid bridge; equal volumes = balance (syncing two systems). */
export const VIEW = [120, 60] as const;
export const DROPLETS = 5;
const PERIOD = 3.2, R = 14.5;

export interface TransferState { t: number }
export const init = (_input?: unknown): TransferState => ({ t: 0 });

/** One frame at share m (volume on the right, 0..1) and flow dm (+ right, − left); t moves the droplets. */
function frame(m: number, dm: number, t: number, droplets: boolean): Attrs {
  const out: Attrs = {
    L: { r: r2(Math.max(5.5, R * Math.sqrt(2 * (1 - m)) * 0.86)) },
    R: { r: r2(Math.max(5.5, R * Math.sqrt(2 * m) * 0.86)) },
  };
  const flow = Math.abs(dm);
  for (let i = 0; i < DROPLETS; i++) {
    let s = (t * 1.1 + i / DROPLETS) % 1;
    if (dm < 0) s = 1 - s;
    out[`d${i}`] = { cx: r2(34 + s * 52), r: droplets ? r2(2.6 + 3.2 * flow * Math.sin(s * Math.PI)) : "0" };
  }
  out.thread = { "stroke-width": r2(3.4 + 2.6 * flow) };
  const bal = clamp(1 - Math.abs(m - 0.5) * 6, 0, 1);
  out.pivot = { rx: r2(4.2 + 1.6 * bal), ry: r2(3.1 + 1.0 * bal) };
  return out;
}

export function step(S: TransferState, dt: number, _input?: unknown, reduced = false): Attrs {
  if (reduced) return rest();
  S.t += dt;
  const ph = (S.t % PERIOD) / PERIOD;
  return frame(0.5 + 0.5 * Math.sin(ph * TAU), Math.cos(ph * TAU), S.t, true);
}

/** The still frame: equal volumes (m = 0.5), no droplets, the pivot balanced. */
export const rest = (_input?: unknown): Attrs => frame(0.5, 0, 0, false);
