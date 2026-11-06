/**
 * The confirmation cascade as the studio edits it (E6-16b): pure operations on the steps, so the
 * drag and drop, the "more" menu and the palette all obey the same rules as the API
 * (confirmation.settings.ts): 1 to 6 steps, at most one team call, and the team call always last.
 */
export type Channel = "whatsapp" | "call_auto" | "call_team";
export interface FlowStep { id: string; channel: Channel; waitMinutes: number }

export const MAX_STEPS = 6;
export const MIN_WAIT = 10;
export const MAX_WAIT = 24 * 60;
export const DEFAULT_WAIT = 60;

const teamAt = (steps: readonly FlowStep[]) => steps.findIndex((s) => s.channel === "call_team");

/** The team call (if any) last, only one of it, never more than six. */
export function normalize(steps: readonly FlowStep[]): FlowStep[] {
  const team = steps.find((s) => s.channel === "call_team");
  const rest = steps.filter((s) => s.channel !== "call_team");
  return (team ? [...rest.slice(0, MAX_STEPS - 1), team] : rest.slice(0, MAX_STEPS));
}

/** Why a channel cannot be added now, or null when it can. */
export function cannotAdd(steps: readonly FlowStep[], channel: Channel): "full" | "team_exists" | null {
  if (steps.length >= MAX_STEPS) return "full";
  if (channel === "call_team" && teamAt(steps) >= 0) return "team_exists";
  return null;
}

/** The last index a movable step may take: just before the team call, or the end. */
export function lastMovable(steps: readonly FlowStep[]): number {
  const team = teamAt(steps);
  return team >= 0 ? team - 1 : steps.length - 1;
}

/**
 * A new step at `at` (default: before the team call, or at the end). A team call always goes last;
 * anything else is never placed after the team call.
 */
export function insertStep(steps: readonly FlowStep[], step: FlowStep, at?: number): FlowStep[] {
  if (cannotAdd(steps, step.channel)) return [...steps];
  if (step.channel === "call_team") return [...steps, step];
  const team = teamAt(steps);
  const max = team >= 0 ? team : steps.length;
  const i = Math.max(0, Math.min(at ?? max, max));
  return [...steps.slice(0, i), step, ...steps.slice(i)];
}

/** Move a step; the team call stays pinned last and nothing moves after it. */
export function moveStep(steps: readonly FlowStep[], from: number, to: number): FlowStep[] {
  const s = steps[from];
  if (!s || s.channel === "call_team" || from === to) return [...steps];
  const clamped = Math.max(0, Math.min(to, lastMovable(steps)));
  const out = steps.filter((_, i) => i !== from);
  out.splice(clamped, 0, s);
  return out;
}

/** Remove a step; the cascade always keeps at least one. */
export function removeStep(steps: readonly FlowStep[], index: number): FlowStep[] {
  if (steps.length <= 1) return [...steps];
  return steps.filter((_, i) => i !== index);
}

export function setWait(steps: readonly FlowStep[], index: number, minutes: number): FlowStep[] {
  return steps.map((s, i) => (i === index ? { ...s, waitMinutes: minutes } : s));
}

export const waitValid = (m: number) => Number.isInteger(m) && m >= MIN_WAIT && m <= MAX_WAIT;

/** The same rule as the API: 1..6 steps, the team call (if any) last and once, every wait in range. */
export function stepsValid(steps: readonly FlowStep[]): boolean {
  if (steps.length < 1 || steps.length > MAX_STEPS) return false;
  const teams = steps.filter((s) => s.channel === "call_team").length;
  if (teams > 1) return false;
  const team = teamAt(steps);
  if (team >= 0 && team !== steps.length - 1) return false;
  return steps.every((s) => waitValid(s.waitMinutes));
}

/** How far above the first step or below the last one a chip still drops into the lane (px). */
export const LANE_SLACK = 32;

/**
 * Where a palette chip lands among the steps, from the step cards only (never the tall branch grid
 * under the WhatsApp step): before the first card whose middle is below the chip's middle, clamped
 * to `max` (before the team call). null when the chip is outside the lane (`lane`: the steps' box).
 */
export function laneIndex(chipMiddle: number, cards: ReadonlyArray<{ top: number; bottom: number }>, lane: { top: number; bottom: number }, max: number): number | null {
  if (!cards.length || chipMiddle < lane.top - LANE_SLACK || chipMiddle > lane.bottom + LANE_SLACK) return null;
  const i = cards.findIndex((c) => chipMiddle < (c.top + c.bottom) / 2);
  return Math.min(i < 0 ? cards.length : i, max);
}

/** Stable ids for the sortable list: `s1`, `s2`… never reused within a draft. */
export function withIds(steps: ReadonlyArray<{ channel: Channel; waitMinutes: number }>, next: () => string): FlowStep[] {
  return steps.map((s) => ({ id: next(), channel: s.channel, waitMinutes: s.waitMinutes }));
}
export const withoutIds = (steps: readonly FlowStep[]) => steps.map(({ channel, waitMinutes }) => ({ channel, waitMinutes }));

/** A counter of ids with a prefix, skipping the ones already taken. */
export function idMaker(prefix: string, taken: Iterable<string> = []) {
  const used = new Set(taken);
  let n = 0;
  return () => {
    let id: string;
    do id = `${prefix}${++n}`; while (used.has(id));
    used.add(id);
    return id;
  };
}
