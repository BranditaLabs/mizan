/**
 * The sign-in card's flow as a pure reducer (no Firebase here): which step shows, and in which
 * direction it arrives. Forward is news (slides in from the reading end, words reveal), back is a
 * return (mirrored, quieter), swap changes the content in place (sign-in ↔ create, email ↔ phone).
 */
export type Direction = "forward" | "back" | "swap";
export type SignInStep = "start" | "phoneCode" | "mfa" | "reset" | "resetSent" | "sso" | "done";
export type Method = "email" | "phone";
export type Mode = "signin" | "create";

export type FlowState = { step: SignInStep; method: Method; mode: Mode; direction: Direction; history: SignInStep[] };

export type FlowEvent =
  | { type: "method"; method: Method }
  | { type: "mode"; mode: Mode }
  | { type: "go"; step: Exclude<SignInStep, "start" | "done"> }
  | { type: "back" }
  | { type: "restart" }
  | { type: "done" };

/** Steps that ask for a code: switching language there would lose it (the confirm popover asks first). */
export const CODE_STEPS: ReadonlySet<SignInStep> = new Set(["phoneCode", "mfa"]);
/** Steps whose first focus is the heading (they inform; nothing to type). */
export const INFO_STEPS: ReadonlySet<SignInStep> = new Set(["resetSent", "done"]);

export function initialFlow(opts: { method?: Method; mode?: Mode } = {}): FlowState {
  return { step: "start", method: opts.method ?? "email", mode: opts.mode ?? "signin", direction: "forward", history: [] };
}

export function flow(s: FlowState, e: FlowEvent): FlowState {
  switch (e.type) {
    case "method":
      return s.step === "start" && s.method !== e.method ? { ...s, method: e.method, direction: "swap" } : s;
    case "mode":
      return s.step === "start" && s.mode !== e.mode ? { ...s, mode: e.mode, direction: "swap" } : s;
    case "go":
      if (s.step === e.step || s.step === "done") return s;
      // resetSent replaces reset in the history: Back from it goes to the start, not to the form again.
      return { ...s, step: e.step, direction: "forward", history: e.step === "resetSent" && s.step === "reset" ? s.history : [...s.history, s.step] };
    case "back": {
      if (s.step === "start" || s.step === "done") return s;
      const prev = s.history.at(-1) ?? "start";
      return { ...s, step: prev, direction: "back", history: s.history.slice(0, -1) };
    }
    case "restart":
      return s.step === "start" ? s : { ...s, step: "start", direction: "back", history: [] };
    case "done":
      return s.step === "done" ? s : { ...s, step: "done", direction: "forward", history: [] };
  }
}

/** The step's focus target when it enters. */
export function focusFor(step: SignInStep): "field" | "code" | "heading" {
  return CODE_STEPS.has(step) ? "code" : INFO_STEPS.has(step) ? "heading" : "field";
}
