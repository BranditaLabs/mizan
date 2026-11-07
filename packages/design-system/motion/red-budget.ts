/**
 * Red appears once per view. Every element that wants the brand red claims it here with a priority;
 * one holder at a time, a better priority preempts a worse one, and the loser renders mono. When the
 * holder releases, the best waiting claimant gets it. The danger tone is not budgeted (text and
 * badges only). Holders are ids; nothing else is kept.
 */
export const RED_PRIORITY = {
  /** A DROP outcome: temporary, released after duration.ripple. */
  drop: 1,
  /** A balanced instrument verdict. */
  verdict: 2,
  /** The page pair loader (tone="brand"). */
  pageLoader: 3,
  /** Status or live dots. */
  dot: 4,
} as const;

type Listener = () => void;
interface Claim { id: string; priority: number; seq: number }

/** Development builds warn on a second claimant (ids only). Bundlers inline NODE_ENV; elsewhere it may be absent. */
const dev = () => { try { return process.env.NODE_ENV !== "production"; } catch { return false; } };

export class RedBudget {
  private claims = new Map<string, Claim>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private listeners = new Set<Listener>();
  private seq = 0;
  private current: string | null = null;

  /** Ask for the red. `ttlMs` releases it automatically (a DROP after its ripple). Returns whether it is granted now. */
  claim(id: string, priority: number, opts: { ttlMs?: number } = {}): boolean {
    const had = this.claims.get(id);
    this.claims.set(id, { id, priority, seq: had?.seq ?? ++this.seq });
    if (opts.ttlMs != null) {
      clearTimeout(this.timers.get(id));
      this.timers.set(id, setTimeout(() => this.release(id), opts.ttlMs));
    }
    this.elect();
    if (!had && this.claims.size > 1 && dev()) {
      const others = [...this.claims.keys()].filter((k) => k !== this.current);
      console.warn(`[mizan red budget] one red per view: "${this.current}" holds it; mono: ${others.map((o) => `"${o}"`).join(", ")}`);
    }
    return this.current === id;
  }

  release(id: string) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    if (this.claims.delete(id)) this.elect();
  }

  holder(): string | null { return this.current; }
  has(id: string) { return this.current === id; }

  subscribe = (l: Listener): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };

  /** A new view (route change): nobody holds the red. */
  reset() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear(); this.claims.clear();
    if (this.current !== null) { this.current = null; this.emit(); }
  }

  private elect() {
    let best: Claim | null = null;
    // Lower number wins; on a tie the earlier claimant keeps it (no flicker).
    for (const c of this.claims.values()) if (!best || c.priority < best.priority || (c.priority === best.priority && c.seq < best.seq)) best = c;
    const next = best?.id ?? null;
    if (next !== this.current) { this.current = next; this.emit(); }
  }

  private emit() { for (const l of this.listeners) l(); }
}

/** The page's budget (RedBudgetProvider gives each route its own). */
export const defaultRedBudget = new RedBudget();
