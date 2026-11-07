/**
 * The event-motion model (docs/16 §2.x, Brand 2.0). Screens never pick an animation: they pass an
 * event type (or a state) to a surface, and the catalogue decides what it means.
 */

/** The loader shown while the viewer's own action runs (each one has one meaning). */
export const PENDINGS = ["pair", "transfer", "drop", "fill"] as const;
export type Pending = (typeof PENDINGS)[number];

/**
 * What the viewer's action does. Rows and waits name this, never a loader; the loader is derived
 * (LOADER_FOR), so a row cannot name a loader that disagrees with what it does (Brand 2.0 meanings):
 *   read      read / wait for an answer (load, sign in, check a code, search)     -> PAIR
 *   send      send something out to another system (SMS code, email link, push)  -> TRANSFER
 *   sync      sync or reconcile two systems (import, store sync, ops queue)       -> TRANSFER
 *   write     a write in Mizan (save, create, confirm, delete, a payment link)    -> DROP
 *   progress  known progress with a real value (done/total)                       -> FILL
 * `progress` never appears in a catalogue row or a wait meaning: neither has a value. FILL is reached
 * only through a component that requires one (FillProgress, FillBar, MizanLoader kind="fill" value).
 */
export const ACTIONS = ["read", "send", "sync", "write", "progress"] as const;
export type Action = (typeof ACTIONS)[number];
/** An action a row or a wait can name (no value, so never progress). */
export type RowAction = Exclude<Action, "progress">;
export const LOADER_FOR = { read: "pair", send: "transfer", sync: "transfer", write: "drop", progress: "fill" } as const satisfies Record<Action, Pending>;

/**
 * What an event plays when it lands:
 *   quiet  refresh the data, no motion          settle  arrive (SETTLE), neutral information
 *   done   settle, then a check (confirmed, not money)   merge  agreement, reconciled (MERGE)
 *   tip    off balance, a warning (TIP holds 8°)  fail   a failure: tips twice, rests in the danger tone
 *   drop   red DROP: an order confirmed or money in (allowlisted, red once per view)
 */
export const OUTCOMES = ["quiet", "settle", "done", "merge", "tip", "fail", "drop"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Where an event can show: the surface primitives in apps/web (and admin). */
export const SURFACES = ["button", "toast", "bell", "timeline", "card", "list", "kpi", "sync", "queue", "instrument", "banner"] as const;
export type Surface = (typeof SURFACES)[number];

export type Audience = "merchant" | "staff";
export type MergeKey = "entity" | "list" | "store";

/** The non-PII facts a variant may read: the actor type and a few fields of `data` (status enums, flags, counts, a due date). */
export interface EventData {
  actor?: { type?: string } | null;
  data?: Record<string, unknown> | null;
  /** "Now" for time-based variants (privacy overdue); defaults to Date.now(). */
  now?: number;
}

/**
 * A variant picks one branch of an ICU `select` message (`select` names the argument) and maps the
 * branch to its outcome. Declarative, so every outcome an event can play is listed (and tested).
 */
export interface Variant {
  /** The ICU select argument name in the copy, e.g. "state". */
  arg: string;
  pick: (e: EventData) => string;
  /** Branch → outcome; "other" is required. */
  outcomes: Record<string, Outcome> & { other: Outcome };
}

export interface MotionRule {
  /** What the viewer's own action does (absent: the event comes from outside). */
  action?: RowAction;
  /** Shown while that action runs: always LOADER_FOR[action] (absent with no action). */
  pending?: Pending;
  outcome: Outcome;
  variant?: Variant;
  surfaces: readonly Surface[];
  audience: Audience;
  /** next-intl key; null = quiet, no copy. */
  copy: `motion.event.${string}` | null;
  /** The scheduler's merge window groups events by this. */
  mergeKey?: MergeKey;
}

export interface ResolvedMotion {
  type: string;
  outcome: Outcome;
  pending?: Pending;
  surfaces: readonly Surface[];
  audience: Audience;
  copy: string | null;
  /** The ICU select branch to pass as `values[arg]` with the copy. */
  select?: { arg: string; value: string };
  mergeKey?: MergeKey;
  /** The outcome claims the view's red (DROP). */
  red: boolean;
  /** Not in the catalogue: a neutral settle (and a dev warning). */
  unknown?: boolean;
}
