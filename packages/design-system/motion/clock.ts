/**
 * One animation clock for every brand component on the page: one requestAnimationFrame loop, one
 * IntersectionObserver (rootMargin 100px), paused while the tab is hidden, and running only while at
 * least one visible subscriber exists. dt is capped at 50ms so a stalled tab never jumps.
 *
 * Nothing touches the DOM at module scope: the loop and the observer start on the first subscribe.
 * Tests drive it with `MotionClock.manual(true)` and `MotionClock.tick(dt)`.
 */
export type Tick = (dt: number, t: number) => void;

interface Sub { tick: Tick; el: Element | null; visible: boolean; t: number }

/** At most this many goo-filtered elements animate per view; the rest render a still frame. */
export const GOO_SLOTS = 4;

class Clock {
  private subs = new Set<Sub>();
  private byEl = new Map<Element, Sub>();
  private raf = 0;
  private last = 0;
  private isManual = false;
  private io: IntersectionObserver | null = null;
  private onVisibility: (() => void) | null = null;
  private goo = new Set<string>();
  private gooWaiters = new Set<() => void>();
  /** Frames requested since the last reset (tests: "zero rAF when nothing is visible"). */
  requests = 0;

  /** Subscribe a frame callback, optionally tied to an element whose visibility gates it. */
  subscribe(tick: Tick, el?: Element | null): () => void {
    const sub: Sub = { tick, el: el ?? null, visible: true, t: 0 };
    this.subs.add(sub);
    if (sub.el) {
      const io = this.observer();
      if (io) { sub.visible = false; this.byEl.set(sub.el, sub); io.observe(sub.el); }
    }
    this.listen();
    this.wake();
    return () => {
      this.subs.delete(sub);
      if (sub.el) { this.byEl.delete(sub.el); this.io?.unobserve(sub.el); }
      if (!this.subs.size) this.stop(true);
    };
  }

  /** Tests and frame-exact renders: no rAF; frames advance only through tick(dt). */
  manual(on: boolean) { this.isManual = on; if (on) this.stop(false); else this.wake(); }

  /** Advance every visible subscriber by dt seconds (manual mode, or one frame of the loop). */
  tick(dt: number) {
    for (const s of this.subs) if (s.visible) { s.t += dt; s.tick(dt, s.t); }
  }

  get running() { return this.raf !== 0; }
  get size() { return this.subs.size; }

  /** Claim one of the GOO_SLOTS for an animating goo element. False: render the still frame. */
  claimGoo(id: string): boolean {
    if (this.goo.has(id)) return true;
    if (this.goo.size >= GOO_SLOTS) return false;
    this.goo.add(id);
    return true;
  }
  releaseGoo(id: string) {
    if (!this.goo.delete(id)) return;
    for (const w of [...this.gooWaiters]) { if (this.goo.size >= GOO_SLOTS) break; w(); }
  }
  /** Called when a goo slot frees up (a refused loader retries its claim instead of staying frozen). */
  onGooFree(fn: () => void): () => void { this.gooWaiters.add(fn); return () => { this.gooWaiters.delete(fn); }; }

  /** Tests only: forget everything. */
  reset() { this.stop(true); this.subs.clear(); this.byEl.clear(); this.goo.clear(); this.gooWaiters.clear(); this.requests = 0; this.io = null; this.isManual = false; }

  private hidden() { return typeof document !== "undefined" && document.hidden; }
  private anyVisible() { for (const s of this.subs) if (s.visible) return true; return false; }

  private observer() {
    if (this.io || typeof IntersectionObserver === "undefined") return this.io;
    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) { const s = this.byEl.get(e.target); if (s) s.visible = e.isIntersecting; }
      this.wake();
    }, { rootMargin: "100px" });
    return this.io;
  }

  private listen() {
    if (this.onVisibility || typeof document === "undefined") return;
    this.onVisibility = () => (this.hidden() ? this.stop(false) : this.wake());
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private wake() {
    if (this.raf || this.isManual || this.hidden() || !this.anyVisible() || typeof requestAnimationFrame === "undefined") return;
    this.last = 0;
    this.requests++;
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.raf = 0;
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    this.tick(dt);
    if (!this.isManual && !this.hidden() && this.anyVisible()) { this.requests++; this.raf = requestAnimationFrame(this.frame); }
  };

  private stop(detach: boolean) {
    if (this.raf && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (detach && this.onVisibility && typeof document !== "undefined") { document.removeEventListener("visibilitychange", this.onVisibility); this.onVisibility = null; }
    if (detach && this.io) { this.io.disconnect(); this.io = null; }
  }
}

export const MotionClock = new Clock();
export type MotionClockType = Clock;
