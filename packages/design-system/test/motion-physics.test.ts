import { describe, expect, it } from "vitest";
import * as pair from "../motion/physics/pair";
import * as level from "../motion/physics/level";
import * as transfer from "../motion/physics/transfer";
import * as drop from "../motion/physics/drop";
import * as fill from "../motion/physics/fill";
import * as gauge from "../motion/physics/gauge";
import * as vessels from "../motion/physics/vessels";
import * as breakeven from "../motion/physics/breakeven";
import * as bullseye from "../motion/physics/bullseye";
import { M } from "../motion/spring";

const DT = 1 / 600;

describe("pair (TIP + MERGE)", () => {
  it("merges (κ > 0.5) for 0.39 ± 0.02 s, twice per 2.6 s loop", () => {
    const period = M.duration.tip / 1000;
    const windows: number[] = [];
    let start: number | null = null;
    for (let t = 0.05; t < 0.05 + period; t += DT) {
      const on = pair.loop(t).kiss > 0.5;
      if (on && start === null) start = t;
      if (!on && start !== null) { windows.push(t - start); start = null; }
    }
    if (start !== null) windows.push(0.05 + period - start);
    // the window around t = 0 wraps the loop's start: join it with the last one
    const merged = windows.length === 3 ? [windows[1], windows[0] + windows[2]] : windows;
    expect(merged).toHaveLength(2);
    for (const w of merged) expect(w).toBeCloseTo(0.39, 1), expect(Math.abs(w - 0.39)).toBeLessThanOrEqual(0.02);
  });

  it("tilts within ±18° and drives the balls from the shared state", () => {
    const S = pair.init();
    let max = 0;
    for (let i = 0; i < 400; i++) { pair.step(S, 1 / 60); max = Math.max(max, Math.abs(S.phi)); }
    expect(max).toBeLessThanOrEqual(M.angle.tip + 1e-9);
    expect(max).toBeGreaterThan(17);
  });

  it("reduced: two balls level and apart (the mark), the trailing ball snapped", () => {
    const S = pair.init();
    for (let i = 0; i < 30; i++) pair.step(S, 1 / 60);
    const still = pair.step(S, 0, undefined, true);
    expect(still).toEqual(pair.rest());
    expect(still.L0).toEqual({ cx: "39", cy: "36", r: "10.5" });
    expect(still.R0).toEqual({ cx: "81", cy: "36", r: "10.5" });
    expect(still.R1.cx).toBe(still.R0.cx);
  });
});

describe("drop (DROP)", () => {
  it("reaches the surface at duration.fall (620 ms)", () => {
    expect(M.duration.fall).toBe(620);
    expect(drop.dropY(0.62 - 1e-6)).toBeCloseTo(drop.SURFACE - 4, 1);
    expect(drop.dropY(0.3)).toBeLessThan(drop.SURFACE - 4);
  });
  it("the ripple has died out (under 0.25 px) by duration.ripple (1.4 s)", () => {
    expect(Math.abs(drop.ripple(0, 0.2))).toBeGreaterThan(2);
    for (let d = 0; d < 50; d += 2) expect(Math.abs(drop.ripple(d, M.duration.ripple / 1000))).toBeLessThan(0.25);
  });
  it("reduced: the drop at rest on a flat surface", () => {
    const r = drop.rest();
    for (let i = 0; i < drop.SURFACE_X.length; i++) expect(r[`s${i}`].cy).toBe(String(drop.SURFACE));
    expect(r.drop.opacity).toBe("1");
    expect(r.sp0.r).toBe("0");
  });
});

describe("fill (known progress)", () => {
  it("animates a new value from the current one, not from 0", () => {
    const S = fill.init({ value: 0.4 });
    expect(S.v).toBe(0.4);
    fill.step(S, 1 / 60, { value: 0.8 });
    expect(S.v).toBeGreaterThan(0.4);
    expect(S.v).toBeLessThan(0.8);
  });
  it("at value 1 the bubble leaves past the track end and fades out within 150 ms", () => {
    const S = fill.init({ value: 0.9 });
    let a = fill.step(S, 1 / 60, { value: 1 });
    for (let i = 0; i < 120; i++) a = fill.step(S, 1 / 60, { value: 1 });
    expect(Number(a.bub.opacity)).toBe(0);
    expect(Number(a.bub.cx)).toBeGreaterThan(236);
    const T = fill.init({ value: 0 });
    fill.step(T, 0.07, { value: 0.5 });
    const half = T.o;
    fill.step(T, 0.1, { value: 0.5 });
    expect(half).toBeGreaterThan(0);
    expect(T.o).toBe(1);
  });
  it("reduced: the bar at its value with no wobble", () => {
    const r = fill.step(fill.init({ value: 0.3 }), 0, { value: 0.3 }, true);
    expect(r).toEqual(fill.rest({ value: 0.3 }));
    expect(new Set(Object.keys(r).filter((k) => k.startsWith("m")).map((k) => r[k].cx)).size).toBe(1);
  });
});

describe("transfer and level still frames", () => {
  it("transfer: equal volumes, no droplets, balanced pivot", () => {
    const r = transfer.rest();
    expect(r.L.r).toBe(r.R.r);
    for (let i = 0; i < transfer.DROPLETS; i++) expect(r[`d${i}`].r).toBe("0");
    expect(r.pivot).toEqual({ rx: "5.8", ry: "4.1" });
  });
  it("level: centred", () => {
    const r = level.rest();
    expect(r.g.transform).toBe("rotate(0 60 30)");
    expect(r.b1.cx).toBe("60");
  });
});

describe("instruments", () => {
  it("gauge: one denominator, max(|A|, 1), for short and over", () => {
    expect(gauge.relative({ a: 1000, b: 990 })).toBeCloseTo(-0.01);
    expect(gauge.relative({ a: 1000, b: 1010 })).toBeCloseTo(0.01);
    expect(Math.abs(gauge.tilt({ a: 1000, b: 990 }))).toBeCloseTo(Math.abs(gauge.tilt({ a: 1000, b: 1010 })));
    expect(gauge.relative({ a: 0, b: 5 })).toBe(5);
    expect(Math.abs(gauge.tilt({ a: 0, b: 1e9 }))).toBe(11);
  });

  it("gauge settles analytically: rest() is the settled frame, not 240 warm-up ticks", () => {
    const input = { a: 184250, b: 181900 };
    const S = gauge.init(input);
    expect(S.th.x).toBeCloseTo(gauge.tilt(input));
    expect(gauge.step(S, 0, input, true)).toEqual(gauge.rest(input));
  });

  it("breakeven: a loss empties the bar, no spend fills it", () => {
    expect(breakeven.share({ a: -500, b: 1000 })).toBe(0);
    expect(breakeven.share({ a: 500, b: 0 })).toBe(1);
    expect(breakeven.share({ a: 1000, b: 1000 })).toBe(0.5);
    const r = breakeven.rest({ a: 1000, b: 1000 });
    expect(Number(r.bub.x) + 11).toBe(200); // the bubble is centred on the meniscus
  });

  it("vessels: the scale comes from the values", () => {
    expect(vessels.scaleTop({ a: 1640, b: 1588 })).toBeCloseTo(1640 * 1.18);
    expect(vessels.scaleTop({ a: 3, b: 2 })).toBeCloseTo(3.54);
    expect(vessels.scaleY(0, { a: 10, b: 10 })).toBe(196);
    expect(vessels.gap({ a: 100, b: 98 })).toBeCloseTo(2);
  });

  it("bullseye: tolerance is a prop and clamping reads off scale", () => {
    expect(bullseye.verdict({ x: 0, y: 0 })).toBe("level");
    expect(bullseye.verdict({ x: 1.5, y: 0 })).toBe("inside");
    expect(bullseye.verdict({ x: 1.5, y: 0, tolerance: 1 })).toBe("off");
    expect(bullseye.verdict({ x: 30, y: 30 })).toBe("offScale");
    const { tx, ty } = bullseye.target({ x: 30, y: 30 });
    expect(Math.hypot(tx, ty)).toBeCloseTo(80);
  });

  it("reduced: springs snap and ambient motion is off", () => {
    const input = { a: 100, b: 60 };
    const S = vessels.init({ a: 10, b: 10 });
    expect(vessels.step(S, 1 / 60, input, true)).toEqual(vessels.rest(input));
  });
});

describe("rest() is deterministic and rounded", () => {
  const cases: [string, () => Record<string, Record<string, string>>][] = [
    ["pair", () => pair.rest()], ["level", () => level.rest()], ["transfer", () => transfer.rest()], ["drop", () => drop.rest()],
    ["fill", () => fill.rest({ value: 0.37 })], ["gauge", () => gauge.rest({ a: 184250, b: 181900 })], ["vessels", () => vessels.rest({ a: 1640, b: 1588 })],
    ["breakeven", () => breakeven.rest({ a: 42600, b: 38900 })], ["bullseye", () => bullseye.rest({ x: 1.8, y: -0.6 })],
  ];
  it.each(cases)("%s", (_k, f) => {
    const a = f();
    expect(f()).toEqual(a);
    const numbers = JSON.stringify(a).match(/-?\d+\.\d+/g) ?? [];
    for (const n of numbers) expect(n.split(".")[1].length, n).toBeLessThanOrEqual(2);
  });
});
