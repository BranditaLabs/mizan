/**
 * The stage's build and loops (auth spec §5.7), loaded on idle by AuthStage and never under reduced
 * motion or Save-Data. It takes over the server-rendered poster in one frame: every piece is set to
 * its "from" state and then animated in, so nothing flashes. Particles ride precomputed lanes
 * (geometry.ts), at most 6 per lane and 30 in total on fine pointers, 2 and 8 on touch, none on the
 * tablet band. Only transform and opacity animate, plus the edges' stroke draw.
 */
import { ease, ms, parseMs, setPlaying } from "@mizan/design-system/auth-motion";
import { PARTICLES, type Variant } from "./geometry";

export type StageController = { play(): void; pause(): void; destroy(): void };

const TRIP_MS = 2400;
const SVG = "http://www.w3.org/2000/svg";

export function buildStage(root: HTMLElement): StageController {
  const anims: Animation[] = [];
  const made: Element[] = [];
  const add = (el: Element | null, frames: Keyframe[], opts: KeyframeAnimationOptions) => {
    if (!el || typeof (el as HTMLElement).animate !== "function") return;
    anims.push((el as HTMLElement).animate(frames, { fill: "both", ...opts }));
  };
  const enter = ease("ease", root);
  const spring = ease("ease-spring", root);
  const springSoft = ease("ease-spring-soft", root);
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;

  // 1–3: the scale settles and the headline's words rise.
  add(root.querySelector(".mz-auth-stage__scale .au-beam"), [{ transform: "rotate(-8deg)" }, { transform: "none" }], { duration: ms("reveal", root), easing: spring });
  root.querySelectorAll(".mz-auth-stage__scale .au-pan").forEach((pan, i) =>
    add(pan, [{ transform: `translateY(${i ? 6 : -6}px)` }, { transform: "none" }], { duration: ms("reveal", root), easing: spring }));
  [...root.querySelectorAll(".mz-auth-stage__headline .au-w")].slice(0, 8).forEach((w, i) =>
    add(w, [{ opacity: 0, transform: "translateY(.35em)" }, { opacity: 1, transform: "none" }], { duration: ms("slow", root), easing: springSoft, delay: 120 + i * 50 }));

  // 4–8 per map variant (only the visible one costs anything; hidden SVGs are display:none).
  root.querySelectorAll<SVGSVGElement>("svg.mz-auth-map").forEach((svg) => {
    if (svg.getClientRects().length === 0) return;
    const v = (svg.dataset.variant ?? "island") as Variant;
    add(svg.querySelector(".st-hub"), [{ opacity: 0, transform: "scale(.92)" }, { opacity: 1, transform: "none" }], { duration: ms("slow", root), easing: enter, delay: 300 });
    const nodes = [...svg.querySelectorAll<SVGGElement>(".st-node:not(.st-ghost)")];
    nodes.forEach((n, i) => {
      const at = 420 + i * 70;
      add(n, [{ opacity: 0, transform: "scale(.92)" }, { opacity: 1, transform: "none" }], { duration: ms("slow", root), easing: enter, delay: at });
      const edge = svg.querySelector<SVGPathElement>(`[data-edge="${n.dataset.node}"]`);
      if (edge && typeof edge.getTotalLength === "function") {
        const len = edge.getTotalLength();
        edge.style.strokeDasharray = String(len);
        add(edge, [{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: ms("glide", root), easing: enter, delay: at + 120 });
      }
    });
    // Particles: a loop per lane, after the build.
    if (v === "band") return;
    const layer = svg.querySelector(".st-particles");
    if (!layer) return;
    const perLane = coarse ? 2 : v === "island" ? 6 : 3;
    const cap = coarse ? 8 : 30;
    let count = 0;
    Object.values(PARTICLES[v]).forEach((pts, lane) => {
      for (let k = 0; k < perLane && count < cap; k++, count++) {
        const dot = document.createElementNS(SVG, "circle");
        dot.setAttribute("r", v === "strip" ? "1.6" : "2.2");
        dot.setAttribute("class", "st-particle");
        layer.appendChild(dot);
        made.push(dot);
        const frames: Keyframe[] = pts.map((p, i) => ({ transform: `translate(${p.x}px, ${p.y}px)`, opacity: i === 0 || i === pts.length - 1 ? 0 : 0.9 }));
        add(dot, frames, { duration: TRIP_MS, easing: "linear", iterations: Infinity, delay: 1600 + lane * 400 + (k * TRIP_MS) / perLane });
      }
    });
  });

  // 10: the ambient light drifts slowly.
  add(root.querySelector("[data-drift]"), [{ transform: "translate(-2%, -2%)" }, { transform: "translate(2%, 2%)" }],
    { duration: parseMs(getComputedStyle(root).getPropertyValue("--au-drift")) ?? 24000, easing: "ease-in-out", direction: "alternate", iterations: Infinity });

  let playing = true;
  return {
    play() { if (!playing) { playing = true; setPlaying(root, true); } },
    pause() { if (playing) { playing = false; setPlaying(root, false); } },
    destroy() { anims.forEach((a) => a.cancel()); made.forEach((m) => m.remove()); root.querySelectorAll<SVGPathElement>("[data-edge]").forEach((e) => { e.style.strokeDasharray = ""; }); },
  };
}
