"use client";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { MotionClock } from "../../motion/clock";
import type { Attrs } from "../../motion/spring";

/** A physics module from motion/physics: init, step and the still frame. */
export interface PhysicsModule<St, I> {
  init(input: I): St;
  step(state: St, dt: number, input: I, reduced?: boolean): Attrs;
  rest(input: I): Attrs;
}

/** An SVG-safe id from useId (no colons or guillemets): mzg-<id>. */
export function useSvgId(prefix = "mzg") {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

const camel = (k: string) => k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** One element's frame attributes as React props (the server render and the first client render). */
export function attrProps(attrs: Attrs, key: string): Record<string, string> {
  const a = attrs[key];
  const out: Record<string, string> = { "data-k": key };
  if (a) for (const k in a) out[camel(k)] = a[k];
  return out;
}

type Writer = (attrs: Attrs) => void;

/** A frame writer for one SVG: elements looked up once, unchanged values skipped. */
function writer(root: Element): Writer {
  const els = new Map<string, Element>();
  root.querySelectorAll("[data-k]").forEach((el) => els.set(el.getAttribute("data-k") as string, el));
  const cache = new Map<string, string>();
  return (attrs) => {
    for (const key in attrs) {
      const el = els.get(key);
      if (!el) continue;
      const a = attrs[key];
      for (const name in a) {
        const id = `${key}.${name}`;
        if (cache.get(id) === a[name]) continue;
        cache.set(id, a[name]);
        el.setAttribute(name, a[name]);
      }
    }
  };
}

const gooSupported = () => typeof CSS === "undefined" || typeof CSS.supports !== "function" || CSS.supports("filter", "url(#x)");

/**
 * Drives one component's physics on the shared clock. Frames are written straight to the SVG with
 * setAttribute (never a React state per frame); the subscription, the goo slot and the observer
 * entry are released on unmount. `animate: false` (a list row, no goo slot) and reduced motion show
 * the still frame with no rAF. Returns whether the goo filter may be drawn.
 */
export function useMotionClock<St, I>(opts: {
  svg: RefObject<SVGSVGElement | null>;
  physics: PhysicsModule<St, I>;
  input: I;
  animate: boolean;
  reduced: boolean;
  goo?: boolean;
  /** The live state (the interactive pair aims it, instruments kick it). */
  stateRef?: { current: St | null };
}): { goo: boolean } {
  const { svg, physics, input, animate, reduced } = opts;
  const id = useId();
  const [goo, setGoo] = useState(true);
  const inputRef = useRef(input);
  const ownState = useRef<St | null>(null);
  const stateRef = opts.stateRef ?? ownState;
  const wantsGoo = opts.goo !== false;
  const inputKey = JSON.stringify(input ?? null);
  const still = reduced || !animate;

  useEffect(() => { inputRef.current = input; });

  useEffect(() => {
    if (wantsGoo && !gooSupported()) setGoo(false);
  }, [wantsGoo]);

  // The still frame: rewritten when the input changes, no rAF.
  useEffect(() => {
    const root = svg.current;
    if (!root || !still) return;
    if (!stateRef.current) stateRef.current = physics.init(inputRef.current);
    writer(root)(reduced ? physics.step(stateRef.current, 0, inputRef.current, true) : physics.rest(inputRef.current));
  }, [svg, physics, still, reduced, inputKey, stateRef]);

  // Animated: one subscription to the shared clock while mounted and visible.
  useEffect(() => {
    const root = svg.current;
    if (!root || still) return;
    if (!stateRef.current) stateRef.current = physics.init(inputRef.current);
    const write = writer(root);
    if (wantsGoo && !MotionClock.claimGoo(id)) { setGoo(false); write(physics.rest(inputRef.current)); return; }
    const off = MotionClock.subscribe((dt) => { if (stateRef.current) write(physics.step(stateRef.current, dt, inputRef.current, false)); }, root);
    return () => { off(); MotionClock.releaseGoo(id); };
  }, [svg, physics, still, wantsGoo, id, stateRef]);

  return { goo: goo && wantsGoo };
}
