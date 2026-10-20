/**
 * Drift monitor: every time an adapter has to adapt (a field moved, a status
 * code is unknown, the API version fell forward, a response shape changed)
 * it records a drift event instead of failing silently or crashing.
 *
 * The engine keeps working on the fallback, and the team sees a ranked list
 * of what changed at which provider, with an example payload, so the adapter
 * can be updated before the fallback runs out.
 */

export type DriftKind =
  | "fallback_field" // the primary path was missing; an alternate path matched
  | "missing_field" // no candidate path matched
  | "unknown_status" // a status code or label not in the mapping
  | "learned_status" // a new status code was learned from its label
  | "shape_changed" // keys added or removed versus the stored baseline
  | "version_fell_forward" // provider served a different API version than requested
  | "coerced_value"; // value had an unexpected type and was converted

export interface DriftEvent {
  connector: string;
  entity: string;
  kind: DriftKind;
  field?: string;
  detail: string;
  sample?: unknown;
  at: number;
}

export interface DriftSink {
  record(e: DriftEvent): void;
}

export class DriftMonitor implements DriftSink {
  private readonly events: DriftEvent[] = [];
  private readonly counts = new Map<string, { event: DriftEvent; count: number; lastAt: number }>();
  private readonly listeners: Array<(e: DriftEvent) => void> = [];

  constructor(private readonly maxEvents = 1_000) {}

  record(e: DriftEvent) {
    this.events.push(e);
    if (this.events.length > this.maxEvents) this.events.shift();
    const key = `${e.connector}|${e.entity}|${e.kind}|${e.field ?? ""}|${e.kind === "unknown_status" ? e.detail : ""}`;
    const cur = this.counts.get(key);
    if (cur) {
      cur.count += 1;
      cur.lastAt = e.at;
    } else {
      this.counts.set(key, { event: e, count: 1, lastAt: e.at });
      for (const l of this.listeners) l(e); // notify once per new kind of drift, not per occurrence
    }
  }

  onNew(listener: (e: DriftEvent) => void) {
    this.listeners.push(listener);
  }

  /** Distinct drift issues, most frequent first. */
  report() {
    return [...this.counts.values()]
      .sort((a, b) => b.count - a.count)
      .map(({ event, count, lastAt }) => ({ ...event, count, lastAt }));
  }

  has(pred: (e: DriftEvent) => boolean) {
    return this.events.some(pred);
  }
}
