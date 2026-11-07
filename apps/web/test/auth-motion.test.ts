import { flipSurface, ms, parseMs, prefersReducedMotion, REDUCED_MS, stepEnter, stepExit } from "@mizan/design-system/auth-motion";
import { afterEach, describe, expect, it } from "vitest";

type Call = { frames: Keyframe[]; opts: KeyframeAnimationOptions };
function fakeEl() {
  const calls: Call[] = [];
  const el = {
    style: {} as Record<string, string>,
    closest: () => null,
    getAttribute: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    animate(frames: Keyframe[], opts: KeyframeAnimationOptions) {
      calls.push({ frames, opts });
      return { finished: Promise.resolve(), addEventListener() {}, commitStyles() {}, cancel() {} };
    },
  };
  return { el: el as unknown as HTMLElement, calls };
}
const g = globalThis as unknown as { window?: unknown };
function reduce(on: boolean) {
  g.window = { matchMedia: (q: string) => ({ matches: on && q.includes("reduce"), addEventListener() {}, removeEventListener() {} }) };
}
afterEach(() => { delete g.window; });

describe("auth motion: reduced motion is a crossfade, never a half-moved layer", () => {
  it("knows the preference (false on the server)", () => {
    expect(prefersReducedMotion()).toBe(false);
    reduce(true);
    expect(prefersReducedMotion()).toBe(true);
  });
  it("step enter and exit become a 120ms opacity fade, with no transform", async () => {
    reduce(true);
    for (const go of [stepEnter, stepExit]) {
      const { el, calls } = fakeEl();
      await go(el, "forward");
      expect(calls).toHaveLength(1);
      expect(calls[0]!.opts.duration).toBe(REDUCED_MS);
      expect(calls[0]!.frames.every((f) => !("transform" in f))).toBe(true);
    }
  });
  it("the card surface does not scale; its height just changes", () => {
    reduce(true);
    const { el, calls } = fakeEl();
    flipSurface(el, 300, 400);
    expect(calls).toHaveLength(0);
  });
  it("with motion: forward slides from the reading end, back mirrors it, swap does not slide", async () => {
    reduce(false);
    const fwd = fakeEl();
    await stepEnter(fwd.el, "forward");
    expect(String(fwd.calls[0]!.frames[0]!.transform)).toBe("translateX(24px)");
    const back = fakeEl();
    await stepEnter(back.el, "back");
    expect(String(back.calls[0]!.frames[0]!.transform)).toBe("translateX(-24px)");
    const swap = fakeEl();
    await stepEnter(swap.el, "swap");
    expect(String(swap.calls[0]!.frames[0]!.transform)).toBe("translateY(6px)");
  });
  it("the surface FLIP scales within 0.7–1.4 and crossfades outside it", () => {
    reduce(false);
    const a = fakeEl();
    flipSurface(a.el, 300, 360);
    expect(String(a.calls[0]!.frames[0]!.transform)).toMatch(/^scaleY\(0\.83/);
    const b = fakeEl();
    flipSurface(b.el, 200, 500);
    expect(b.calls[0]!.frames[0]).toEqual({ opacity: 0.6 });
  });
  it("durations fall back to the spec's values before the design-system tokens land", () => {
    expect([ms("instant"), ms("fast"), ms("base"), ms("slow"), ms("moderate"), ms("glide"), ms("reveal")]).toEqual([80, 150, 200, 300, 450, 600, 900]);
    expect([parseMs("300ms"), parseMs(".45s"), parseMs("80"), parseMs("fast")]).toEqual([300, 450, 80, null]);
  });
});
