// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionClock } from "../motion/clock";
import { forceReduced } from "../motion/reduced";
import * as pair from "../motion/physics/pair";
import * as transfer from "../motion/physics/transfer";
import * as drop from "../motion/physics/drop";
import * as fill from "../motion/physics/fill";
import * as level from "../motion/physics/level";
import { MizanLoader, EventGlyph, DoneState, RedBudgetProvider, Mark, Wordmark } from "../react/motion";
import { Gauge, Vessels, Breakeven, Bullseye } from "../react/motion/instruments";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── Browser stand-ins: rAF, IntersectionObserver ──
let frames = new Map<number, FrameRequestCallback>();
let nextId = 1;
const observers: FakeIO[] = [];
class FakeIO {
  targets = new Set<Element>();
  disconnected = false;
  constructor(public cb: IntersectionObserverCallback) { observers.push(this); }
  observe(el: Element) { this.targets.add(el); }
  unobserve(el: Element) { this.targets.delete(el); }
  disconnect() { this.disconnected = true; this.targets.clear(); }
  show(visible: boolean) { this.cb([...this.targets].map((target) => ({ target, isIntersecting: visible }) as IntersectionObserverEntry), this as unknown as IntersectionObserver); }
}
const runFrame = (ms: number) => { const f = [...frames.values()]; frames = new Map(); f.forEach((cb) => cb(ms)); };

beforeEach(() => {
  frames = new Map(); observers.length = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { const id = nextId++; frames.set(id, cb); return id; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
  vi.stubGlobal("IntersectionObserver", FakeIO);
  MotionClock.reset();
  forceReduced(null);
});
afterEach(() => { MotionClock.reset(); forceReduced(null); vi.unstubAllGlobals(); vi.restoreAllMocks(); Object.defineProperty(document, "hidden", { value: false, configurable: true }); });

describe("the shared clock", () => {
  it("N subscribers share one requestAnimationFrame", () => {
    const ticks = [vi.fn(), vi.fn(), vi.fn()];
    ticks.forEach((t) => MotionClock.subscribe(t));
    expect(frames.size).toBe(1);
    runFrame(16); runFrame(33);
    ticks.forEach((t) => expect(t).toHaveBeenCalledTimes(2));
    expect(frames.size).toBe(1);
    const [dt] = ticks[0].mock.calls[1];
    expect(dt).toBeCloseTo(0.017, 3);
  });

  it("caps dt at 50 ms after a stall", () => {
    const t = vi.fn();
    MotionClock.subscribe(t);
    runFrame(10); runFrame(5000);
    expect(t.mock.calls[1][0]).toBe(0.05);
  });

  it("requests no frame while nothing is visible, and starts when something scrolls in", () => {
    const el = document.createElement("div");
    const t = vi.fn();
    MotionClock.subscribe(t, el);
    expect(MotionClock.requests).toBe(0);
    expect(frames.size).toBe(0);
    act(() => observers[0].show(true));
    expect(frames.size).toBe(1);
    runFrame(16);
    expect(t).toHaveBeenCalledTimes(1);
    observers[0].show(false);
    runFrame(32);
    expect(frames.size).toBe(0);
  });

  it("pauses while the tab is hidden", () => {
    MotionClock.subscribe(vi.fn());
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(frames.size).toBe(0);
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(frames.size).toBe(1);
  });

  it("removes its listeners and observer when the last subscriber leaves", () => {
    const remove = vi.spyOn(document, "removeEventListener");
    const off = MotionClock.subscribe(vi.fn(), document.createElement("div"));
    off();
    expect(remove).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    expect(observers[0].disconnected).toBe(true);
    expect(MotionClock.size).toBe(0);
  });

  it("gives at most 4 goo slots", () => {
    expect([1, 2, 3, 4, 5].map((i) => MotionClock.claimGoo(`g${i}`))).toEqual([true, true, true, true, false]);
    MotionClock.releaseGoo("g1");
    expect(MotionClock.claimGoo("g5")).toBe(true);
  });
});

function mount(el: ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(el));
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

const attr = (host: Element, key: string, name: string) => host.querySelector(`[data-k="${key}"]`)?.getAttribute(name);

describe("reduced motion: each kind shows its chosen still frame and requests no frame", () => {
  const cases: [string, ReactElement, string, Record<string, string>][] = [
    ["pair", <MizanLoader kind="pair" label="Loading" />, "L0", pair.rest().L0],
    ["transfer", <MizanLoader kind="transfer" label="Syncing" />, "pivot", transfer.rest().pivot],
    ["drop", <MizanLoader kind="drop" label="Saving" />, "drop", drop.rest().drop],
    ["fill", <MizanLoader kind="fill" value={0.3} label="Import" valueText="30%" />, "rect", fill.rest({ value: 0.3 }).rect],
    ["level", <MizanLoader kind="level" label="Level" />, "g", level.rest().g],
  ];
  it.each(cases)("%s", (kind, el, key, want) => {
    forceReduced(true);
    const { host, unmount } = mount(el);
    for (const [name, value] of Object.entries(want)) expect(attr(host, key, name), `${kind} ${key}.${name}`).toBe(value);
    expect(MotionClock.requests).toBe(0);
    expect(frames.size).toBe(0);
    if (kind === "fill") expect(host.textContent).toContain("30%");
    unmount();
  });

  it("an animated loader joins the clock, writes frames to the DOM, and leaves it on unmount", () => {
    const { host, unmount } = mount(<MizanLoader kind="transfer" label="Syncing" />);
    act(() => observers[0].show(true));
    runFrame(16); runFrame(400);
    expect(attr(host, "d0", "r")).not.toBe("0");
    expect(MotionClock.size).toBe(1);
    unmount();
    expect(MotionClock.size).toBe(0);
  });
});

describe("server render = first client render (no hydration mismatch)", () => {
  const els: [string, () => ReactElement][] = [
    ["pair", () => <MizanLoader kind="pair" label="Loading" tone="brand" />],
    ["transfer", () => <MizanLoader kind="transfer" label="Syncing" />],
    ["drop", () => <MizanLoader kind="drop" decorative />],
    ["fill", () => <MizanLoader kind="fill" value={0.42} label="Import" valueText="42%" />],
    ["level", () => <MizanLoader kind="level" label="Tilt" interactive />],
    ["glyph", () => <EventGlyph outcome="drop" />],
    ["done", () => <DoneState label="Done" testId="confirm-done">ok</DoneState>],
    ["marks", () => <><Mark alt="mizan" tone="mono" /><Wordmark alt="ميزان" locale="ar" /></>],
    ["gauge", () => <Gauge a="184250.00" b="181900.00" currency="EGP" locale="en" copy={{ title: "Gauge", labelA: "Expected", labelB: "Collected", balanced: "Balanced", shortBy: (p) => `Short by ${p}`, overBy: (p) => `Over by ${p}`, tilt: (d) => `Tilt ${d}`, summary: (s) => `${s.labelA} ${s.a}, ${s.labelB} ${s.b}, ${s.verdict}` }} />],
    ["vessels", () => <Vessels a={1640} b={1588} locale="ar-EG" copy={{ title: "V", labelA: "In system", labelB: "Counted", matched: "Match", gap: (p) => `Gap ${p}` }} />],
    ["breakeven", () => <Breakeven a="-500.00" b="38900.00" currency="SAR" locale="en" copy={{ title: "B", axis: "Break-even", labelA: "Gross", labelB: "Ads", exact: "Exact", profitable: (p) => `Up ${p.amount}`, below: (p) => `Below ${p.amount}`, noSpend: "No spend" }} />],
    ["bullseye", () => <Bullseye x={1.8} y={-0.6} locale="en" copy={{ title: "Level", labelX: "Cash", labelY: "Stock", level: "Level", tolerance: (t) => `±${t}`, off: "Off", offScale: "Off scale" }} />],
  ];
  it.each(els)("%s", (_name, make) => {
    const html = renderToString(<RedBudgetProvider>{make()}</RedBudgetProvider>);
    expect(html).not.toContain("<template");
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a); });
    let root: ReturnType<typeof hydrateRoot> | null = null;
    act(() => { root = hydrateRoot(host, <RedBudgetProvider>{make()}</RedBudgetProvider>, { onRecoverableError: (e) => errors.push(e) }); });
    expect(errors).toEqual([]);
    consoleError.mockRestore();
    act(() => root?.unmount());
    host.remove();
  });
});

describe("red once per view", () => {
  it("two brand loaders: one red, the other mono", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { host, unmount } = mount(<RedBudgetProvider><MizanLoader kind="pair" tone="brand" label="a" /><MizanLoader kind="pair" tone="brand" label="b" /></RedBudgetProvider>);
    expect(host.querySelectorAll('[data-mz-red="on"]').length).toBe(1);
    expect(host.querySelectorAll('[data-mz-red="off"]').length).toBe(1);
    unmount();
  });

  it("a DROP glyph takes the red from a loader, then gives it back after the ripple", () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { host, unmount } = mount(<RedBudgetProvider><MizanLoader kind="pair" tone="brand" label="a" /><EventGlyph outcome="drop" /></RedBudgetProvider>);
    expect(host.querySelector('svg[data-outcome="drop"]')?.getAttribute("data-mz-red")).toBe("on");
    expect(host.querySelectorAll('[data-mz-red="on"]').length).toBe(1);
    act(() => { vi.advanceTimersByTime(620 + 1400 + 5); });
    expect(host.querySelector('svg[data-outcome="drop"]')?.getAttribute("data-mz-red")).toBe("off");
    expect(host.querySelectorAll('[data-mz-red="on"]').length).toBe(1);
    unmount();
    vi.useRealTimers();
  });

  it("a static glyph never claims red", () => {
    const { host, unmount } = mount(<RedBudgetProvider><EventGlyph outcome="drop" static /></RedBudgetProvider>);
    expect(host.querySelector('[data-mz-red="on"]')).toBeNull();
    unmount();
  });
});

describe("accessibility", () => {
  it("roles follow the loader's use", () => {
    expect(renderToString(<MizanLoader kind="pair" label="Loading" />)).toContain('role="status"');
    expect(renderToString(<MizanLoader kind="drop" decorative />)).toContain('aria-hidden="true"');
    const progress = renderToString(<MizanLoader kind="fill" value={0.3} label="Import" valueText="3 of 10" />);
    expect(progress).toContain('role="progressbar"');
    expect(progress).toContain('aria-valuenow="30"');
    expect(progress).toContain('aria-valuetext="3 of 10"');
    expect(renderToString(<MizanLoader kind="pair" interactive label="Tip the scale" />)).toContain('role="slider"');
  });

  it("filter ids are SVG-safe and unique per instance", () => {
    const html = renderToString(<><MizanLoader kind="pair" decorative /><MizanLoader kind="pair" decorative /></>);
    const ids = [...html.matchAll(/<filter id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(id).toMatch(/^mzg-[A-Za-z0-9_-]+$/);
  });

  it("instruments label the SVG from the copy and keep figures in <bdi>", () => {
    const html = renderToString(<Gauge a="184250.00" b="181900.00" currency="EGP" locale="en" copy={{ title: "Gauge", labelA: "Expected", labelB: "Collected", balanced: "Balanced", shortBy: (p) => `short by ${p}`, overBy: (p) => `over by ${p}`, tilt: (d) => d, summary: (s) => `${s.labelA} ${s.a}, ${s.labelB} ${s.b}, ${s.verdict}` }} />);
    expect(html).toMatch(/aria-label="Expected EGP\s?184,250\.00, Collected EGP\s?181,900\.00, short by 1\.28%"/);
    expect(html).toMatch(/<bdi class="mz-figure"[^>]*>Δ −EGP\s?2,350\.00<\/bdi>/);
    expect(html).toContain('aria-live="polite"');
  });
});
