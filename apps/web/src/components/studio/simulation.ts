/**
 * The phone's simulation (E6-16b): the buyer's chat played one step at a time, from the preview's
 * conversations (POST /v1/settings/confirmation/preview). Pure: the phone keeps a `SimState`, sends
 * the buyer's taps here, and shows `shown` turns of the scenario (the last business reply after a
 * short "typing…" when `animate`). The position survives a new preview (same scenario, same step).
 */
export type Scenario = "confirm" | "confirm_offer" | "offer_no" | "change" | "cancel" | "message" | "already" | "opt_out" | "opt_in";

export interface SimTurn {
  from: "business" | "customer";
  kind: "template" | "text" | "buttons" | "list" | "tap" | "typed";
  key?: string;
  text?: string;
  buttons?: readonly string[];
  list?: { button: string; rows: ReadonlyArray<{ title: string }> };
}
export interface SimConversation { scenario: Scenario; turns: SimTurn[] }

export interface SimState {
  /** null: only the template, waiting for the first tap. */
  scenario: Scenario | null;
  /** How many turns of the scenario are on screen (the template counts). */
  shown: number;
  /** The title the buyer chose in the list (shown instead of the sample's first row). */
  chosen?: { at: number; title: string };
}

export type SimAction =
  | { type: "template"; index: number; offer: boolean }
  | { type: "button"; turn: number; index: number }
  | { type: "list"; turn: number; title: string }
  | { type: "compose"; reply: "next" | "message" | "opt_out" | "opt_in" }
  | { type: "jump"; scenario: Scenario }
  | { type: "restart" };

export type SimResult = { state: SimState; animate: boolean } | { state: SimState; animate: false; nowhere: true };

export const START: SimState = { scenario: null, shown: 1 };
const TEMPLATE_SCENARIO = ["confirm", "change", "cancel"] as const;

const find = (convs: readonly SimConversation[], s: Scenario | null) => (s ? convs.find((c) => c.scenario === s) : undefined);

/** A scenario from its start: the buyer's first turn and the store's reply to it. */
function play(convs: readonly SimConversation[], scenario: Scenario, shown = 3): SimResult {
  const c = find(convs, scenario);
  if (!c) return { state: START, animate: false, nowhere: true };
  return { state: { scenario, shown: Math.min(shown, c.turns.length) }, animate: true };
}

/** What the buyer can do next inside the scenario: tap the turn's buttons or list, or type. */
export function nextStep(convs: readonly SimConversation[], state: SimState):
  | { kind: "tap"; on: number; expect: string }
  | { kind: "typed"; text: string }
  | null {
  const c = find(convs, state.scenario);
  const next = c?.turns[state.shown];
  if (!c || !next || next.from !== "customer") return null;
  if (next.kind === "typed") return { kind: "typed", text: next.text ?? "" };
  return { kind: "tap", on: state.shown - 1, expect: next.text ?? "" };
}

export function simulate(convs: readonly SimConversation[], state: SimState, action: SimAction): SimResult {
  switch (action.type) {
    case "restart": return { state: START, animate: false };
    case "jump": {
      const c = find(convs, action.scenario);
      return c ? { state: { scenario: action.scenario, shown: c.turns.length }, animate: false } : { state, animate: false, nowhere: true };
    }
    case "template": {
      const base = TEMPLATE_SCENARIO[action.index];
      if (!base) return { state, animate: false, nowhere: true };
      // After a confirmation, Cancel on the template gets "you already answered".
      if (base === "cancel" && (state.scenario === "confirm" || state.scenario === "confirm_offer" || state.scenario === "offer_no") && state.shown >= 3) {
        const already = find(convs, "already");
        return already ? { state: { scenario: "already", shown: already.turns.length }, animate: true } : { state, animate: false, nowhere: true };
      }
      return play(convs, base === "confirm" && action.offer ? "confirm_offer" : base);
    }
    case "button": {
      const step = nextStep(convs, state);
      const c = find(convs, state.scenario);
      const turn = c?.turns[action.turn];
      if (!step || step.kind !== "tap" || step.on !== action.turn || !turn?.buttons) return { state, animate: false, nowhere: true };
      if (turn.buttons[action.index] === step.expect) return { state: { ...state, shown: Math.min(state.shown + 2, c!.turns.length) }, animate: true };
      // "No thanks" on the offer: its own scenario, the same chat up to here.
      if (state.scenario === "confirm_offer" && find(convs, "offer_no")) return play(convs, "offer_no", state.shown + 2);
      return { state, animate: false, nowhere: true };
    }
    case "list": {
      const step = nextStep(convs, state);
      const c = find(convs, state.scenario);
      if (!step || step.kind !== "tap" || step.on !== action.turn) return { state, animate: false, nowhere: true };
      return { state: { ...state, shown: Math.min(state.shown + 2, c!.turns.length), chosen: { at: state.shown, title: action.title } }, animate: true };
    }
    case "compose": {
      if (action.reply === "next") {
        const step = nextStep(convs, state);
        if (step?.kind !== "typed") return { state, animate: false, nowhere: true };
        return { state: { ...state, shown: state.shown + 2 }, animate: true };
      }
      return play(convs, action.reply);
    }
  }
}

/** The same position on a new preview: the scenario if it is still there, the step clamped. */
export function keep(convs: readonly SimConversation[], state: SimState): SimState {
  const c = find(convs, state.scenario);
  if (!state.scenario) return START;
  if (!c) return START;
  return { ...state, shown: Math.max(1, Math.min(state.shown, c.turns.length)) };
}

/** The turns on screen; the template alone before the first tap. */
export function visibleTurns<T extends SimTurn>(convs: ReadonlyArray<{ scenario: Scenario; turns: T[] }>, state: SimState): T[] {
  const c = state.scenario ? convs.find((x) => x.scenario === state.scenario) : convs[0];
  if (!c) return [];
  return c.turns.slice(0, state.scenario ? state.shown : 1);
}
