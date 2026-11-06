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
  /**
   * Template buttons tapped after the buyer had answered, in order: the tap, and the "already"
   * reply when the engine sends one (another answer). The same answer again gets no reply.
   */
  late?: ReadonlyArray<{ label: string; reply: boolean }>;
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

/** What the buyer has answered in the scenario on screen (the engine closes the run on it). */
export function answered(state: SimState): "confirmed" | "changed" | "cancelled" | null {
  switch (state.scenario) {
    case "confirm": case "confirm_offer": case "offer_no": case "already": return state.shown >= 3 ? "confirmed" : null;
    case "change": return state.shown >= 3 ? "changed" : null;
    // Cancel opens the reasons list; the run closes when a reason is sent.
    case "cancel": return state.shown >= 5 ? "cancelled" : null;
    default: return null;
  }
}
const OUTCOME_OF = { confirm: "confirmed", change: "changed", cancel: "cancelled" } as const;

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
  if (!c || !next || next.from !== "customer" || state.late?.length) return null;
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
      // Once the buyer has answered, the engine (whatsapp-chat.service onTap) never plays a new
      // scenario: another answer gets "you already answered", the same answer again gets nothing.
      // (Inside the store's hold window after a confirmation it sends "noted" instead; the phone
      // shows the usual case.)
      const outcome = answered(state);
      if (outcome) {
        const label = find(convs, state.scenario)?.turns[0]?.buttons?.[action.index] ?? "";
        const reply = OUTCOME_OF[base] !== outcome;
        if (reply && !find(convs, "already")) return { state, animate: false, nowhere: true };
        return { state: { ...state, late: [...(state.late ?? []), { label, reply }] }, animate: reply };
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

/**
 * Where the phone goes to show one of `keys` (a field got focus, a node was picked): null when a
 * bubble with one of them is on screen already. Otherwise the first sample that has one, up to that
 * bubble; else the `fallback` scenario whole; else null (nothing to show).
 */
export function reveal<T extends SimTurn>(convs: ReadonlyArray<{ scenario: Scenario; turns: T[] }>, state: SimState, keys: readonly string[], fallback?: Scenario): SimState | null {
  const has = (x: SimTurn) => Boolean(x.key && keys.includes(x.key));
  if (visibleTurns(convs, state).some(has)) return null;
  for (const c of convs) {
    const i = c.turns.findIndex(has);
    if (i >= 0) return { scenario: c.scenario, shown: i + 1 };
  }
  const c = fallback ? convs.find((x) => x.scenario === fallback) : undefined;
  return c ? { scenario: c.scenario, shown: c.turns.length } : null;
}

/** The turns on screen; the template alone before the first tap. */
export function visibleTurns<T extends SimTurn>(convs: ReadonlyArray<{ scenario: Scenario; turns: T[] }>, state: SimState): T[] {
  const c = state.scenario ? convs.find((x) => x.scenario === state.scenario) : convs[0];
  if (!c) return [];
  const turns = c.turns.slice(0, state.scenario ? state.shown : 1);
  if (!state.late?.length) return turns;
  // The late taps: the buyer's tap (as the samples draw a tap) and the store's "already".
  const already = convs.find((x) => x.scenario === "already")?.turns ?? [];
  const reply = [...already].reverse().find((x) => x.from === "business");
  const tap = [...already, ...c.turns].find((x) => x.from === "customer" && x.kind === "tap");
  for (const l of state.late) {
    if (tap) turns.push({ ...tap, text: l.label });
    if (l.reply && reply) turns.push(reply);
  }
  return turns;
}
