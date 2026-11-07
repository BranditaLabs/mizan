"use client";

import { useSyncExternalStore } from "react";

/**
 * What the persistent auth frame (top bar, stage) needs to know about the card inside it: the
 * stage's scene, the card's mode (so the bar's contextual link says the opposite), whether a code
 * is being typed (the language link asks before leaving), and requests from the bar back to the card.
 */
export type Scene = "signIn" | "signup" | "shopify" | "invite" | "secure" | "welcome" | "outage" | "staff";
type State = { scene: Scene | null; mode: "signin" | "create" | null; locked: boolean; keyboard: boolean };

let state: State = { scene: null, mode: null, locked: false, keyboard: false };
const listeners = new Set<() => void>();
const modeRequests = new Set<(m: "signin" | "create") => void>();
/** What the card tells the stage happened (the stage's machine turns it into motion). */
export type StageSignal = "send" | "idle" | "error" | "signedIn";
const stageListeners = new Set<(s: StageSignal) => void>();

function emit() { listeners.forEach((l) => l()); }

export const authUi = {
  get: () => state,
  set(patch: Partial<State>) {
    const next = { ...state, ...patch };
    if (next.scene === state.scene && next.mode === state.mode && next.locked === state.locked && next.keyboard === state.keyboard) return;
    state = next;
    emit();
  },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  /** The bar's "Create an account" / "Sign in" link asks the card to switch. */
  requestMode(m: "signin" | "create") { modeRequests.forEach((r) => r(m)); },
  onModeRequest(r: (m: "signin" | "create") => void) { modeRequests.add(r); return () => { modeRequests.delete(r); }; },
  /** The card's news for the stage: work started or ended, an error, signed in. Typing sends nothing. */
  signal(s: StageSignal) { stageListeners.forEach((l) => l(s)); },
  onSignal(l: (s: StageSignal) => void) { stageListeners.add(l); return () => { stageListeners.delete(l); }; },
};

const SERVER: State = { scene: null, mode: null, locked: false, keyboard: false };
export function useAuthUi(): State {
  return useSyncExternalStore(authUi.subscribe, authUi.get, () => SERVER);
}
