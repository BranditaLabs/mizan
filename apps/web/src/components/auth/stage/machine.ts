/**
 * The auth stage's state machine (pure, no DOM): the stage is part of the page, not a player.
 * It plays a short intro (INTRO_MS, under WCAG 2.2.2's 5 seconds, so it needs no pause control),
 * then settles and stays still. After that it moves only when the card says something happened,
 * with the event-motion catalogue's meanings (@mizan/shared motion):
 *   sending (a password, a code, a link)  TRANSFER (STAGE_WAIT): one pass of dots along the edges
 *                                         toward Mizan, then still even if the work goes on
 *   an error (a wrong field or answer)    TIP: the mark goes off balance, holds, then settles
 *   signed in                             nothing here: the card's DoneState plays the DROP (the
 *                                         screen's one red, WAIT_MOTION's end of the flow)
 * Typing and choosing move nothing. Reduced motion: no intro and no beats (the still settled frame).
 */
import type { FluidBeat } from "@mizan/design-system/react/motion";
import { WAIT_MOTION } from "@mizan/shared/motion";

export type StagePhase = "intro" | "settled" | "transfer" | "tip";
export type StageEvent =
  /** The intro finished, or the stage went out of sight during it (it jumps to its end). */
  | { type: "introEnd" }
  /** The card started work that leaves the browser (sign in, send a code or a link). */
  | { type: "send" }
  /** That work ended without an error and without signing in (a code was sent, a step changed). */
  | { type: "idle" }
  /** A field or the server said no. */
  | { type: "error" }
  /** The session is signed in. */
  | { type: "signedIn" }
  /** A one-off beat (tip, the transfer pass) finished. */
  | { type: "beatEnd" };
export type StageState = { phase: StagePhase; /** Bumps on every beat so the same beat can replay. */ seq: number; signedIn: boolean };

/**
 * The map draws two systems (the store's channels and Mizan), so the card's work shows on it with
 * the catalogue's meaning for moving data between systems (syncing = transfer). The wait itself
 * belongs to the CTA's AuthProgress (sending and signingIn = drop); the stage only echoes it once.
 */
export const STAGE_WAIT = WAIT_MOTION.syncing;

/** The intro's length: the map builds, one transfer passes, and it settles (≤ 5s). */
export const INTRO_MS = 4200;
/**
 * How long a beat runs before the stage is settled again: tip (motion tokens: tip 2600) and the
 * one transfer pass (the last lane's last dot lands by then). Both under 5 seconds.
 */
export const BEAT_MS: Record<"tip" | "transfer", number> = { tip: 2600, transfer: 4600 };

export function initialStage(reduced: boolean): StageState {
  return { phase: reduced ? "settled" : "intro", seq: 0, signedIn: false };
}

export function stage(s: StageState, e: StageEvent, reduced = false): StageState {
  if (s.signedIn) return s;
  if (e.type === "signedIn") return { phase: "settled", seq: s.seq, signedIn: true };
  if (reduced) return s.phase === "settled" ? s : { ...s, phase: "settled" };
  switch (e.type) {
    case "introEnd":
      return s.phase === "intro" ? { ...s, phase: "settled" } : s;
    case "send":
      return s.phase === "transfer" ? s : { ...s, phase: "transfer", seq: s.seq + 1 };
    case "idle":
      return s.phase === "transfer" ? { ...s, phase: "settled" } : s;
    case "error":
      return { ...s, phase: "tip", seq: s.seq + 1 };
    case "beatEnd":
      return s.phase === "tip" || s.phase === "transfer" ? { ...s, phase: "settled" } : s;
  }
}

/** The mark's beat for a phase (the intro arrives; transfer is carried by the map's edges). */
export function markBeat(phase: StagePhase): FluidBeat | null {
  return phase === "intro" ? "settle" : phase === "tip" ? "tip" : null;
}

/** Whether anything on the stage may move in this phase ("settled" is still). */
export const moving = (phase: StagePhase) => phase !== "settled";
