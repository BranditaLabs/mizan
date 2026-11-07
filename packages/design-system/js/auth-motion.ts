/**
 * The auth flow's motion runtime (css/auth.css is its stylesheet): step transitions, the card
 * surface FLIP, the success wipe, stroke draws and loop pausing, with the Web Animations API and no
 * library. Durations and easings are read from the CSS custom properties on `.mz-auth` (themselves
 * DS-1 tokens with fallbacks), so no literal timing lives in components.
 *
 * Rules (docs/16 §4.23, auth spec §5): only transform and opacity animate; every running animation
 * is remembered per element and a new one commits and cancels it first (interruptible, never
 * queued, never jumped with finish()); will-change only while running; reduced motion takes a
 * 120ms crossfade path, not "duration 0", so no frame shows a half-moved layer.
 */

export type Direction = "forward" | "back" | "swap";
export type Duration = "instant" | "fast" | "base" | "slow" | "moderate" | "glide" | "reveal";
export type Ease = "ease" | "ease-exit" | "ease-std" | "ease-sheet" | "ease-spring" | "ease-spring-soft" | "ease-wipe";

const FALLBACK_MS: Record<Duration, number> = { instant: 80, fast: 150, base: 200, slow: 300, moderate: 450, glide: 600, reveal: 900 };
const FALLBACK_EASE: Record<Ease, string> = {
  ease: "cubic-bezier(.23, 1, .32, 1)", "ease-exit": "cubic-bezier(.4, 0, 1, 1)", "ease-std": "cubic-bezier(.2, 0, 0, 1)",
  "ease-sheet": "cubic-bezier(.32, .72, 0, 1)", "ease-spring": "cubic-bezier(.34, 1.56, .64, 1)",
  "ease-spring-soft": "cubic-bezier(.34, 1.7, .64, 1)", "ease-wipe": "cubic-bezier(.65, 0, .35, 1)",
};
/** The reduced-motion crossfade. */
export const REDUCED_MS = 120;

const REDUCE = "(prefers-reduced-motion: reduce)";

/** True when the person asked for less motion (false on the server and where matchMedia is missing). */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCE).matches;
}

/** Calls `cb` when the reduced-motion preference changes; returns the unsubscribe. */
export function onReducedMotionChange(cb: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const q = window.matchMedia(REDUCE);
  q.addEventListener("change", cb);
  return () => q.removeEventListener("change", cb);
}

function root(el?: Element | null): Element | null {
  if (typeof document === "undefined") return null;
  return el?.closest(".mz-auth") ?? document.querySelector(".mz-auth") ?? document.documentElement;
}

/** Parses "300ms", "0.3s" or a bare number into milliseconds. */
export function parseMs(v: string): number | null {
  const m = /^\s*(-?[\d.]+)\s*(ms|s)?\s*$/.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2] === "s" ? n * 1000 : n;
}

/** A duration token in ms, read from `--au-<name>` on the auth root (DS token or its fallback). */
export function ms(name: Duration, el?: Element | null): number {
  const r = root(el);
  if (r && typeof getComputedStyle === "function") {
    const v = parseMs(getComputedStyle(r).getPropertyValue(`--au-${name}`));
    if (v !== null) return v;
  }
  return FALLBACK_MS[name];
}

/** An easing token, read from `--au-<name>` on the auth root. */
export function ease(name: Ease, el?: Element | null): string {
  const r = root(el);
  const v = r && typeof getComputedStyle === "function" ? getComputedStyle(r).getPropertyValue(`--au-${name}`).trim() : "";
  return v || FALLBACK_EASE[name];
}

/** The reading direction as a sign: 1 left to right, -1 right to left. */
export function dirSign(el?: Element | null): 1 | -1 {
  const d = el?.closest("[dir]")?.getAttribute("dir") ?? (typeof document !== "undefined" ? document.documentElement.dir : "ltr");
  return d === "rtl" ? -1 : 1;
}

const running = new WeakMap<Element, Set<Animation>>();
const DEV_CAP = 12;

/**
 * Runs one animation on an element. Anything already running on it is committed (its current
 * values written to style) and cancelled first, so a new transition starts from where the old one
 * was. will-change is set for the run and removed when it ends.
 */
export function run(el: Element, keyframes: Keyframe[], opts: KeyframeAnimationOptions): Animation | null {
  if (typeof (el as HTMLElement).animate !== "function") return null;
  interrupt(el);
  const h = el as HTMLElement;
  const props = new Set(keyframes.flatMap((k) => Object.keys(k).filter((p) => p !== "offset" && p !== "easing" && p !== "composite")));
  h.style.willChange = [...props].map((p) => (p === "transform" || p === "opacity" ? p : "")).filter(Boolean).join(", ") || "auto";
  const a = h.animate(keyframes, { fill: "both", ...opts });
  const set = running.get(el) ?? new Set<Animation>();
  set.add(a);
  running.set(el, set);
  const clear = () => {
    set.delete(a);
    if (set.size === 0) h.style.willChange = "";
  };
  a.addEventListener("finish", () => {
    clear();
    // Leave the final values in style so removing the fill never flashes the "from" frame.
    try { a.commitStyles(); } catch { /* element gone */ }
    a.cancel();
  });
  a.addEventListener("cancel", clear);
  if (isDev() && typeof document.getAnimations === "function" && document.getAnimations().length > DEV_CAP * 4) {
    console.warn(`[auth-motion] ${document.getAnimations().length} animations running`);
  }
  return a;
}

/**
 * One plain WAAPI animation (fill both), not interrupting what else runs on the element: the
 * stage's build and loops (apps/web auth/stage/animator.ts), which own and cancel their own list.
 * App code never calls element.animate itself (mizan/no-adhoc-motion); it comes through here.
 */
export function play(el: Element, keyframes: Keyframe[], opts: KeyframeAnimationOptions): Animation | null {
  if (typeof (el as HTMLElement).animate !== "function") return null;
  return (el as HTMLElement).animate(keyframes, { fill: "both", ...opts });
}

function isDev(): boolean {
  try { return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.NODE_ENV === "development"; } catch { return false; }
}

/** Commits and cancels whatever runs on the element (and clears its inline motion styles if asked). */
export function interrupt(el: Element, reset = false): void {
  const set = running.get(el);
  if (set) {
    for (const a of [...set]) {
      try { a.commitStyles(); } catch { /* detached */ }
      a.cancel();
    }
    set.clear();
  }
  if (reset) {
    const h = el as HTMLElement;
    h.style.transform = "";
    h.style.opacity = "";
    h.style.willChange = "";
  }
}

function done(a: Animation | null): Promise<void> {
  return a ? a.finished.then(() => undefined, () => undefined) : Promise.resolve();
}

const sign = (direction: Direction) => (direction === "back" ? -1 : 1);

/** The parts of a form field the exit copy touches (an input, textarea or select, or a test double). */
export type GhostField = { type: string; value: string; hasAttribute(name: string): boolean };

/**
 * Makes the exit copy's fields safe to show. A cloned input keeps its live value (the HTML
 * cloning steps copy the value and its dirty flag, so the `value` attribute draws nothing), so a
 * secret is overwritten through the property: a password, or a field marked `data-secret` (a
 * password shown with "Show" is type=text), stays or becomes type=password and holds filler of
 * the same length, drawn as the same dots; the typed secret never reaches the copy. Other fields
 * keep what was on screen.
 */
export function scrubGhostFields(copies: ArrayLike<GhostField>, originals: ArrayLike<GhostField>): void {
  for (let i = 0; i < copies.length; i++) {
    const c = copies[i]!;
    const o = originals[i];
    const secret = c.type === "password" || c.hasAttribute("data-secret") || o?.type === "password" || Boolean(o?.hasAttribute("data-secret"));
    if (secret) {
      c.type = "password";
      c.value = "•".repeat(Math.min(o?.value.length ?? 0, 24));
    } else {
      c.value = o?.value ?? "";
    }
  }
}

/** The outgoing step: fades and slides 16px toward the reading start (forward) or end (back). */
export function stepExit(el: HTMLElement, direction: Direction): Promise<void> {
  if (prefersReducedMotion()) return done(run(el, [{ opacity: 1 }, { opacity: 0 }], { duration: REDUCED_MS, easing: "linear" }));
  if (direction === "swap") return done(run(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: ease("ease-exit", el) }));
  const x = -16 * dirSign(el) * sign(direction);
  return done(run(el, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${x}px)` }], { duration: ms("fast", el), easing: ease("ease-exit", el) }));
}

/**
 * The incoming step: arrives 24px from the reading end (forward) or start (back), overlapping the
 * exit by 60ms. Forward also reveals the H1 word by word and staggers fields and buttons; back
 * and swap do not (a return is not news). The element is live from frame 0 (never inert).
 */
export function stepEnter(el: HTMLElement, direction: Direction): Promise<void> {
  if (prefersReducedMotion()) return done(run(el, [{ opacity: 0 }, { opacity: 1 }], { duration: REDUCED_MS, easing: "linear" }));
  if (direction === "swap") {
    return done(run(el, [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: ms("base", el), easing: ease("ease", el), delay: 60 }));
  }
  const x = 24 * dirSign(el) * sign(direction);
  const main = run(el, [{ opacity: 0, transform: `translateX(${x}px)` }, { opacity: 1, transform: "none" }], { duration: ms("slow", el), easing: ease("ease", el), delay: 60 });
  if (direction === "forward") {
    revealWords(el.querySelector<HTMLElement>("[data-words]"), 60);
    const items = [...el.querySelectorAll<HTMLElement>("[data-stagger]")].slice(0, 5);
    items.forEach((item, i) => run(item, [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }],
      { duration: ms("slow", el), easing: ease("ease", el), delay: 120 + i * 40 }));
  }
  return done(main);
}

/** Word-by-word reveal of a heading whose words are `.au-w` spans (cap 8, 40ms apart). */
export function revealWords(host: HTMLElement | null, delay = 0, stagger = 40): void {
  if (!host || prefersReducedMotion()) return;
  [...host.querySelectorAll<HTMLElement>(".au-w")].slice(0, 8).forEach((w, i) =>
    run(w, [{ opacity: 0, transform: "translateY(.35em)" }, { opacity: 1, transform: "none" }],
      { duration: ms("moderate", host), easing: ease("ease-spring-soft", host), delay: delay + i * stagger }));
}

/**
 * The card surface follows the content's height: scaleY(h0/h1) → none from the top edge, so the
 * heading never moves and only the bottom edge travels. Outside a 0.7–1.4 ratio a scale would
 * distort the radius and shadow, so the surface crossfades instead. Content is never scaled.
 */
export function flipSurface(surface: HTMLElement, h0: number, h1: number): void {
  if (!h0 || !h1 || Math.abs(h0 - h1) < 1) return;
  if (prefersReducedMotion()) return; // an instant height change; the card is top-anchored
  const ratio = h0 / h1;
  if (ratio >= 0.7 && ratio <= 1.4) {
    run(surface, [{ transform: `scaleY(${ratio})` }, { transform: "none" }], { duration: ms("slow", surface), easing: ease("ease-sheet", surface) });
  } else {
    run(surface, [{ opacity: 0.6 }, { opacity: 1 }], { duration: ms("fast", surface), easing: "linear" });
  }
}

/** A stroke that draws itself (icons up to 24px, map edges). */
export function drawPath(path: SVGGeometryElement, opts: { duration?: Duration; delay?: number } = {}): Promise<void> {
  const len = typeof path.getTotalLength === "function" ? path.getTotalLength() : 100;
  path.style.strokeDasharray = String(len);
  if (prefersReducedMotion()) {
    path.style.strokeDashoffset = "0";
    return Promise.resolve();
  }
  const a = typeof path.animate === "function"
    ? path.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: ms(opts.duration ?? "glide", path), easing: ease("ease", path), delay: opts.delay ?? 0, fill: "both" })
    : null;
  return done(a);
}

/**
 * The success wipe: a circle of the app's background colour grows from the button that was pressed
 * until it covers the farthest corner of the viewport (transform only). Under reduced motion it is
 * a 120ms fade. Returns the element and a promise for the end; remove it with `.remove()`.
 */
export function successWipe(from: { x: number; y: number }): { el: HTMLElement; finished: Promise<void> } {
  const el = document.createElement("div");
  el.className = "mz-auth-wipe";
  el.setAttribute("aria-hidden", "true");
  const w = window.innerWidth;
  const h = window.innerHeight;
  const r = Math.hypot(Math.max(from.x, w - from.x), Math.max(from.y, h - from.y));
  // Viewport coordinates (getBoundingClientRect) are physical in both directions, so is this origin.
  Object.assign(el.style, { width: `${r * 2}px`, height: `${r * 2}px`, left: "0", top: "0", translate: `${from.x - r}px ${from.y - r}px` });
  (document.querySelector(".mz-auth") ?? document.body).appendChild(el);
  if (prefersReducedMotion()) {
    el.style.transform = "none";
    return { el, finished: done(run(el, [{ opacity: 0 }, { opacity: 1 }], { duration: REDUCED_MS, easing: "linear" })) };
  }
  return { el, finished: done(run(el, [{ transform: "scale(.001)" }, { transform: "scale(1)" }], { duration: ms("glide", el), easing: ease("ease-wipe", el) })) };
}

/**
 * Calls `onChange(visible)` when the element enters or leaves the viewport or the tab is hidden, so
 * loops (particles, ticker, drift) run only while someone can see them. Returns the cleanup.
 */
export function pauseWhenHidden(el: Element, onChange: (visible: boolean) => void): () => void {
  let inView = true;
  let tabVisible = typeof document === "undefined" || document.visibilityState !== "hidden";
  const emit = () => onChange(inView && tabVisible);
  const onVis = () => { tabVisible = document.visibilityState !== "hidden"; emit(); };
  document.addEventListener("visibilitychange", onVis);
  let io: IntersectionObserver | null = null;
  if (typeof IntersectionObserver === "function") {
    io = new IntersectionObserver((entries) => { inView = entries.some((e) => e.isIntersecting); emit(); });
    io.observe(el);
  }
  return () => { document.removeEventListener("visibilitychange", onVis); io?.disconnect(); };
}

/** Pause or play every animation on an element and its descendants (stage pause button, hidden tab). */
export function setPlaying(el: Element, playing: boolean): void {
  const anims = typeof (el as HTMLElement).getAnimations === "function" ? (el as HTMLElement).getAnimations({ subtree: true }) : [];
  for (const a of anims) {
    if (playing) { if (a.playState === "paused") a.play(); } else if (a.playState === "running") a.pause();
  }
}
