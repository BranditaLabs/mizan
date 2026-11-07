import { clamp, r2, SPRING, TAU, type Attrs } from "../spring";

/** LEVEL: a spirit-level vial. It tilts, the bubble runs uphill, then settles between the ticks (gallery only for now). */
export const VIEW = [120, 60] as const;
const REST = [4.2, 0, -4.2];

export interface LevelState { t: number; th: number; thv: number; m: number[]; v: number[]; aim: number | null; idle: number; offset: number }

export const init = (_input?: unknown): LevelState => ({ t: 0, th: 0, thv: 0, m: [0, 0, 0], v: [0, 0, 0], aim: null, idle: 9, offset: 0 });

function frame(S: LevelState): Attrs {
  const goal = clamp(-S.th * 5.2, -32, 32);
  const dir = Math.sign(goal - S.m[1]) || 1;
  const squash = clamp(Math.abs(S.v[1]) * 0.012, 0, 1.6);
  const out: Attrs = { g: { transform: `rotate(${r2(S.th)} 60 30)` } };
  for (let i = 0; i < 3; i++) out[`b${i}`] = { cx: r2(60 + S.m[i] + REST[i] * dir * (1 - squash * 0.25)), r: r2(7.6 - squash * (i === 1 ? 0.6 : 1.1)) };
  S.offset = S.m[1];
  const centred = clamp(1 - Math.abs(S.m[1]) / 3, 0, 1);
  out.tk0 = out.tk1 = { opacity: r2(0.42 + 0.58 * centred) };
  return out;
}

export function step(S: LevelState, dt: number, _input?: unknown, reduced = false): Attrs {
  if (reduced) {
    // reduced: the pointer sets the angle directly, no spring, no seeking loop
    S.th = S.aim ?? 0; S.thv = 0;
    const goal = clamp(-S.th * 5.2, -32, 32);
    S.m = [goal, goal, goal]; S.v = [0, 0, 0];
    return frame(S);
  }
  S.t += dt; S.idle += dt;
  let target: number;
  if (S.aim != null) target = S.aim;
  else if (S.idle < 1.6) target = 0; // let go → settle
  else { const k = (S.t * TAU) / 2.9; target = 6 * Math.sin(k) * (0.75 + 0.25 * Math.sin(k * 0.5)); }
  const { k: ka, z } = SPRING.level;
  S.thv += (ka * (target - S.th) - 2 * Math.sqrt(ka) * z * S.thv) * dt;
  S.th += S.thv * dt;
  const goal = clamp(-S.th * 5.2, -32, 32);
  for (let i = 0; i < 3; i++) {
    S.v[i] += (SPRING.level.massK[i] * (goal - S.m[i]) - SPRING.level.massC[i] * S.v[i]) * dt;
    S.m[i] += S.v[i] * dt;
  }
  return frame(S);
}

/** The still frame: centred. */
export const rest = (_input?: unknown): Attrs => frame(init());

export function aim(S: LevelState, a: number | null) { S.aim = a == null ? null : a * 9; S.idle = 0; }
