/**
 * The stage's motion (auth spec §5.7), loaded on idle by AuthStage and never under reduced motion
 * or Save-Data. Nothing here loops: the intro plays once (it ends by INTRO_MS after the stage
 * mounted, whenever this chunk arrives), and TRANSFER is one pass of dots per send (BEAT_MS.transfer).
 *
 * The intro's build runs only when the page was marked before first paint (STAGE_BUILD_SCRIPT:
 * `data-stage-build` on <html>, which keeps the pieces it builds unpainted, with a CSS reveal at
 * 1.5s if this chunk never arrives) and only while that reveal has not started; it takes over in
 * one frame and removes the mark. A late chunk (or the card speaking first) skips the build and the
 * intro pass: the stage is already the poster. Particles ride precomputed lanes (geometry.ts), at
 * most 3 per lane and 30 in total on fine pointers, 2 and 8 on touch. Only transform and opacity
 * animate, plus the edges' stroke draw. Dots that must stop fade where they are (never blink out).
 */
import { ease, ms, play } from "@mizan/design-system/auth-motion";
import { INTRO_MS } from "./machine";
import { PARTICLES, type Variant } from "./geometry";

export type StageController = {
  /** Jump every intro animation to its end frame (out of sight, or the card spoke first). */
  finishIntro(): void;
  /** On: one pass of dots along the edges toward Mizan (≤ BEAT_MS.transfer). Off: each dot fades where it is. */
  transfer(on: boolean): void;
  destroy(): void;
};

const TRIP_MS = 2400;
const SVG = "http://www.w3.org/2000/svg";

/** The mark the inline script sets before first paint (see STAGE_BUILD_SCRIPT in lib/auth/intent.ts). */
export const STAGE_BUILD_ATTR = "data-stage-build";

/** The visible map (one per screen shape; the hidden ones are display:none). */
function visibleMap(root: HTMLElement): SVGSVGElement | null {
  return [...root.querySelectorAll<SVGSVGElement>("svg.mz-auth-map")].find((svg) => svg.getClientRects().length > 0) ?? null;
}

/** The CSS reveal's delay ([data-stage-build] in auth.css): after it the poster is already on screen. */
const REVEAL_AT = 1500;

/**
 * `elapsed`: ms since the stage mounted (the intro's clock started then, not when this chunk
 * arrived). `intro`: whether the stage is still in its intro (false: build nothing, the poster stays).
 */
export function buildStage(root: HTMLElement, { elapsed = 0, intro: inIntro = true }: { elapsed?: number; intro?: boolean } = {}): StageController {
  const html = document.documentElement;
  const build = inIntro && elapsed < REVEAL_AT && html.hasAttribute(STAGE_BUILD_ATTR);
  const intro: Animation[] = [];
  const add = (el: Element | null, frames: Keyframe[], opts: KeyframeAnimationOptions) => {
    const a = el ? play(el, frames, opts) : null;
    if (a) intro.push(a);
  };
  const enter = ease("ease", root);
  const springSoft = ease("ease-spring-soft", root);
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;

  // The headline's words rise (the mark arrives by itself: FluidMark's settle beat).
  if (build) [...root.querySelectorAll(".mz-auth-stage__headline .au-w")].slice(0, 8).forEach((w, i) =>
    add(w, [{ opacity: 0, transform: "translateY(.35em)" }, { opacity: 1, transform: "none" }], { duration: ms("slow", root), easing: springSoft, delay: 120 + i * 50 }));

  const svg = visibleMap(root);
  if (svg && build) {
    add(svg.querySelector(".st-hub"), [{ opacity: 0, transform: "scale(.92)" }, { opacity: 1, transform: "none" }], { duration: ms("slow", root), easing: enter, delay: 300 });
    [...svg.querySelectorAll<SVGGElement>(".st-node:not(.st-ghost)")].forEach((n, i) => {
      const at = 420 + i * 70;
      add(n, [{ opacity: 0, transform: "scale(.92)" }, { opacity: 1, transform: "none" }], { duration: ms("slow", root), easing: enter, delay: at });
      const edge = svg.querySelector<SVGPathElement>(`[data-edge="${n.dataset.node}"]`);
      if (edge && typeof edge.getTotalLength === "function") {
        const len = edge.getTotalLength();
        edge.style.strokeDasharray = String(len);
        add(edge, [{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: ms("glide", root), easing: enter, delay: at + 120 });
      }
    });
  }
  // The pieces now hold their "from" frame (fill: both): the CSS hold can go in this same frame.
  html.removeAttribute(STAGE_BUILD_ATTR);

  /* ── TRANSFER: one dot per slot per lane, toward the hub ── */
  const dots: { el: SVGCircleElement; a: Animation | null }[] = [];
  const lanes = (v: Variant) => Object.values(PARTICLES[v]);
  const spawn = (firstDelay: number, one = false) => {
    const map = visibleMap(root);
    const layer = map?.querySelector(".st-particles");
    if (!map || !layer) return;
    const v = (map.dataset.variant ?? "island") as Variant;
    const perLane = one ? 1 : coarse ? 2 : v === "island" ? 3 : 2;
    const cap = coarse ? 8 : 30;
    let count = 0;
    lanes(v).forEach((pts, lane) => {
      for (let k = 0; k < perLane && count < cap; k++, count++) {
        const el = document.createElementNS(SVG, "circle");
        el.setAttribute("r", v === "strip" ? "1.6" : "2.2");
        el.setAttribute("class", "st-particle");
        layer.appendChild(el);
        const frames: Keyframe[] = pts.map((p, i) => ({ transform: `translate(${p.x}px, ${p.y}px)`, opacity: i === 0 || i === pts.length - 1 ? 0 : 0.9 }));
        // fill "none": a finished dot leaves nothing behind.
        const a = play(el, frames, { duration: TRIP_MS, easing: "linear", fill: "none", delay: firstDelay + lane * 120 + (k * TRIP_MS) / perLane });
        dots.push({ el, a });
        a?.finished.then(() => el.remove(), () => el.remove());
      }
    });
  };
  /** Stop every dot: one still waiting just goes; one in flight fades out where it is. */
  const fadeDots = () => {
    const out = ms("fast", root);
    dots.splice(0).forEach(({ el, a }) => {
      if (!a || a.playState !== "running" || Number(a.currentTime ?? 0) < (Number(a.effect?.getTiming().delay) || 0)) { a?.cancel(); el.remove(); return; }
      const now = Number(getComputedStyle(el).opacity) || 0;
      a.pause();
      const f = play(el, [{ opacity: now }, { opacity: 0 }], { duration: out, easing: "linear", fill: "forwards" });
      if (f) f.finished.then(() => el.remove(), () => el.remove()); else el.remove();
    });
  };

  // The intro's one transfer pass, a dot per lane, only if its last dot lands by INTRO_MS after mount.
  const passDelay = build ? 1100 : 150;
  if (inIntro && elapsed + passDelay + 5 * 120 + TRIP_MS <= INTRO_MS) spawn(passDelay, true);

  let flowing = false;
  return {
    finishIntro() {
      intro.splice(0).forEach((a) => { try { a.finish(); } catch { /* detached */ } });
      if (!flowing) fadeDots();
    },
    transfer(on) {
      if (on === flowing) return;
      flowing = on;
      fadeDots();
      if (on) spawn(0);
    },
    destroy() {
      intro.splice(0).forEach((a) => a.cancel());
      dots.splice(0).forEach(({ el, a }) => { a?.cancel(); el.remove(); });
      root.querySelectorAll<SVGPathElement>("[data-edge]").forEach((e) => { e.style.strokeDasharray = ""; });
    },
  };
}
