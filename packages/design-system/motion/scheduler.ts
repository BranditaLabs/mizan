/**
 * The motion scheduler: the one place that turns facts (the viewer's own mutation, a poll that saw
 * a status change, a live frame) into motion on surfaces. Pure and timer-injected, so it is tested
 * with fake timers. The catalogue lookup is injected (`resolve`), so this package does not depend
 * on @mizan/shared.
 *
 *  1. Seen ids: an LRU of 2,000 ids drops replays (a live stream's overlap window).
 *  2. History: events dated before the scheduler started (or before `markReady`), and `history` /
 *     `resync` sources, refresh data with no motion.
 *  3. Echo: a local success records type:entity; the same event within 8s plays nothing.
 *  4. Lookup: `resolve(type, data)` gives the outcome, surfaces, copy and merge key.
 *  5. Merge: the same surfaces and merge key within a 600ms trailing window give one dispatch with a
 *     count; a steady stream flushes at least every 1.5s (mergeMaxMs), so it never waits forever.
 *  6. Rate limits: 4 dispatches/s (burst 6); per surface one every 400ms (bell 2s); one DROP per 3s
 *     (later ones settle as "done"). A surface still inside its gap keeps its own events and shows
 *     them as one batched end frame when the gap ends; the others are not affected. Only overflow
 *     of the global bucket starts a 5s storm: everything is counted, then one batched dispatch shows
 *     the end frame and an "N new" chip.
 *  7. Hidden tab: nothing plays; on return the bell gets one summary.
 *  8. Reduced motion: dispatches still happen, flagged `reduced`, and surfaces crossfade.
 *  9. Unmounted surfaces are dropped silently.
 * 10. One at a time: a surface shows the newest dispatch; there is no queue (the surface's concern).
 *
 * Privacy: the state holds ids, types and timestamps only. Event data is read by `resolve` at push
 * time and never stored; nothing is written to storage.
 */
export type MotionSource = "mutation" | "poll" | "live" | "history" | "resync";
export type MergeKey = "entity" | "list" | "store";

export interface MotionInput { id?: string; type: string; entityId?: string; at: number; source: MotionSource; data?: unknown }
export interface ResolvedRule { outcome: string; surfaces: readonly string[]; copy: string | null; mergeKey?: MergeKey; select?: string }

export interface MotionDispatch {
  ids: string[];
  type: string;
  outcome: string;
  surfaces: string[];
  copy: string | null;
  select?: string;
  count: number;
  batched: boolean;
  reduced: boolean;
  entityId?: string;
  /** The hidden-tab summary for the bell. */
  summary?: boolean;
}

export type PushResult = "dispatched" | "merging" | "duplicate" | "history" | "echo" | "quiet" | "hidden" | "unmounted" | "storm" | "held";

type Timer = ReturnType<typeof setTimeout>;

export interface SchedulerOptions {
  resolve(type: string, data?: unknown): ResolvedRule;
  dispatch(d: MotionDispatch): void;
  /** Every accepted event refreshes data, with or without motion. */
  refresh?(type: string, entityId?: string): void;
  isMounted?(surface: string): boolean;
  isReduced?(): boolean;
  now?(): number;
  /** When false, events wait for markReady() (a live stream's "ready"). */
  ready?: boolean;
  setTimer?(fn: () => void, ms: number): Timer;
  clearTimer?(t: Timer): void;
}

export const LIMITS = {
  seen: 2000, echoMs: 8000, mergeMs: 600, mergeMaxMs: 1500, perSecond: 4, burst: 6,
  surfaceGapMs: 400, bellGapMs: 2000, dropGapMs: 3000, stormMs: 5000, freshMs: 5000,
} as const;

export const BATCHED_COPY = "motion.batched";

interface Pending { rule: ResolvedRule; type: string; entityId?: string; ids: string[]; count: number; surfaces: string[]; timer: Timer; first: number }

export function createScheduler(o: SchedulerOptions) {
  const now = o.now ?? (() => Date.now());
  const setTimer = o.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((t: Timer) => clearTimeout(t));
  const mounted = o.isMounted ?? (() => true);
  const reduced = o.isReduced ?? (() => false);

  const seen = new Map<string, true>();
  const echoes = new Map<string, number>();
  const fresh = new Map<string, number>();
  const lastSurface = new Map<string, number>();
  const pending = new Map<string, Pending>();
  const storm = new Map<string, number>();
  /** Events that reached a surface inside its gap: shown as one batched end frame when it ends. */
  const gapHeld = new Map<string, { count: number; ids: string[]; timer: Timer }>();
  let readyAt = o.ready === false ? Infinity : now();
  let tokens: number = LIMITS.burst;
  let refilled = now();
  let lastDrop = -Infinity;
  let stormTimer: Timer | null = null;
  let hidden = false;
  let hiddenCount = 0;

  const remember = (id: string) => {
    seen.set(id, true);
    if (seen.size > LIMITS.seen) seen.delete(seen.keys().next().value as string);
  };

  const gapFor = (s: string) => (s === "bell" ? LIMITS.bellGapMs : LIMITS.surfaceGapMs);

  function refill(t: number) {
    tokens = Math.min(LIMITS.burst, tokens + ((t - refilled) / 1000) * LIMITS.perSecond);
    refilled = t;
  }

  function enterStorm(surfaces: string[], count: number) {
    for (const s of surfaces) storm.set(s, (storm.get(s) ?? 0) + count);
    if (stormTimer) return;
    stormTimer = setTimer(() => {
      stormTimer = null;
      const total = Math.max(0, ...storm.values());
      const surfacesHit = [...storm.keys()].filter(mounted);
      storm.clear();
      if (total && surfacesHit.length) o.dispatch({ ids: [], type: "batched", outcome: "settle", surfaces: surfacesHit, copy: BATCHED_COPY, count: total, batched: true, reduced: reduced() });
    }, LIMITS.stormMs);
  }

  function holdForGap(surfaces: string[], d: MotionDispatch, t: number) {
    for (const s of surfaces) {
      const held = gapHeld.get(s);
      if (held) { held.count += d.count; held.ids.push(...d.ids); continue; }
      const wait = Math.max(0, gapFor(s) - (t - (lastSurface.get(s) ?? -Infinity)));
      const entry = { count: d.count, ids: [...d.ids], timer: setTimer(() => {
        gapHeld.delete(s);
        if (!mounted(s)) return;
        emit({ ids: entry.ids, type: "held", outcome: "settle", surfaces: [s], copy: BATCHED_COPY, count: entry.count, batched: true, reduced: reduced() });
      }, wait) };
      gapHeld.set(s, entry);
    }
  }

  function markFresh(ids: string[], t: number) {
    for (const id of ids) { fresh.delete(id); fresh.set(id, t); }
    // Bounded: ids older than freshMs are of no use to isFresh (a tab left open for days).
    for (const [k, at] of fresh) { if (t - at < LIMITS.freshMs) break; fresh.delete(k); }
  }

  function emit(d: MotionDispatch) {
    const t = now();
    if (stormTimer) { enterStorm(d.surfaces, d.count); return false; }
    refill(t);
    const open = d.surfaces.filter((s) => t - (lastSurface.get(s) ?? -Infinity) >= gapFor(s));
    if (!open.length) { holdForGap(d.surfaces, d, t); return false; }
    if (tokens < 1) { enterStorm(d.surfaces, d.count); return false; }
    tokens -= 1;
    for (const s of open) lastSurface.set(s, t);
    let outcome = d.outcome;
    if (outcome === "drop") { if (t - lastDrop < LIMITS.dropGapMs) outcome = "done"; else lastDrop = t; }
    markFresh(d.ids, t);
    o.dispatch({ ...d, surfaces: open, outcome });
    return true;
  }

  function flush(key: string) {
    const p = pending.get(key);
    if (!p) return;
    pending.delete(key);
    emit({ ids: p.ids, type: p.type, outcome: p.rule.outcome, surfaces: p.surfaces, copy: p.count > 1 ? BATCHED_COPY : p.rule.copy, select: p.rule.select, count: p.count, batched: p.count > 1, reduced: reduced(), entityId: p.entityId });
  }

  function push(ev: MotionInput): PushResult {
    if (ev.id) { if (seen.has(ev.id)) return "duplicate"; remember(ev.id); }
    o.refresh?.(ev.type, ev.entityId);
    if (ev.source === "history" || ev.source === "resync" || ev.at < readyAt) return "history";
    const t = now();
    if (ev.entityId !== undefined) {
      const echo = echoes.get(`${ev.type}:${ev.entityId}`);
      if (echo !== undefined && t - echo <= LIMITS.echoMs && ev.source !== "mutation") return "echo";
    }
    const rule = o.resolve(ev.type, ev.data);
    if (rule.outcome === "quiet" || !rule.surfaces.length) return "quiet";
    if (hidden) { hiddenCount++; return "hidden"; }
    const surfaces = rule.surfaces.filter(mounted);
    if (!surfaces.length) return "unmounted";
    if (stormTimer) { enterStorm(surfaces, 1); return "storm"; }
    const ids = ev.id ? [ev.id] : [];
    if (rule.mergeKey) {
      const scope = rule.mergeKey === "entity" ? ev.entityId ?? ev.type : rule.mergeKey === "list" ? ev.type.split(".")[0] : "*";
      const key = `${surfaces.join(",")}|${rule.mergeKey}:${scope}`;
      const p = pending.get(key);
      if (p) {
        clearTimer(p.timer);
        p.count++; p.ids.push(...ids); p.type = ev.type; p.rule = rule;
        // Trailing window, but never past mergeMaxMs from the first event of the window.
        p.timer = setTimer(() => flush(key), Math.max(0, Math.min(LIMITS.mergeMs, p.first + LIMITS.mergeMaxMs - t)));
      } else {
        pending.set(key, { rule, type: ev.type, entityId: ev.entityId, ids, count: 1, surfaces, first: t, timer: setTimer(() => flush(key), LIMITS.mergeMs) });
      }
      return "merging";
    }
    return emit({ ids, type: ev.type, outcome: rule.outcome, surfaces, copy: rule.copy, select: rule.select, count: 1, batched: false, reduced: reduced(), entityId: ev.entityId }) ? "dispatched" : stormTimer ? "storm" : "held";
  }

  return {
    push,
    /** The viewer's own success: the same event arriving from elsewhere within 8s plays nothing. */
    recordLocalSuccess(type: string, entityId: string) {
      const t = now();
      echoes.set(`${type}:${entityId}`, t);
      for (const [k, at] of echoes) if (t - at > LIMITS.echoMs) echoes.delete(k);
    },
    /**
     * The viewer's own DROP (its toast plays at once, outside the queue): true when the 3 s DROP gap
     * allows it, and the gap restarts; false: show it as "done".
     */
    claimDrop(): boolean {
      const t = now();
      if (t - lastDrop < LIMITS.dropGapMs) return false;
      lastDrop = t;
      return true;
    },
    /** A live stream's "ready": events dated before it are history. */
    markReady(at = now()) { readyAt = at; },
    setHidden(h: boolean) {
      if (hidden === h) return;
      hidden = h;
      if (!h && hiddenCount) {
        const count = hiddenCount;
        hiddenCount = 0;
        if (mounted("bell")) o.dispatch({ ids: [], type: "summary", outcome: "settle", surfaces: ["bell"], copy: BATCHED_COPY, count, batched: true, reduced: reduced(), summary: true });
      }
    },
    /** True when the scheduler dispatched this id in the last 5s (rows play their glyph only then). */
    isFresh(id: string) { const at = fresh.get(id); return at !== undefined && now() - at < LIMITS.freshMs; },
    get storming() { return stormTimer !== null; },
    dispose() {
      for (const p of pending.values()) clearTimer(p.timer);
      pending.clear();
      for (const g of gapHeld.values()) clearTimer(g.timer);
      gapHeld.clear();
      if (stormTimer) clearTimer(stormTimer);
      stormTimer = null;
    },
  };
}

export type MotionScheduler = ReturnType<typeof createScheduler>;
