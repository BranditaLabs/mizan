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
import type { MizanLoaderProps } from "../react/motion";
import { AuthProgress, PrimaryCta, ResendTimer, type ProgressKind } from "../react/auth";

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

describe("goo slots and the loader", () => {
  it("a loader refused a goo slot starts animating when one frees up", () => {
    for (let i = 1; i <= 4; i++) MotionClock.claimGoo(`h${i}`);
    const m = mount(<MizanLoader label="x" />);
    expect(MotionClock.size).toBe(0);
    act(() => MotionClock.releaseGoo("h1"));
    expect(MotionClock.size).toBe(1);
    m.unmount();
    expect(MotionClock.size).toBe(0);
  });

  it("reduced motion: the keyboard tips the slider at once and aria-valuenow follows", () => {
    forceReduced(true);
    const m = mount(<MizanLoader interactive label="Tip" />);
    const svg = m.host.querySelector("svg[role=slider]") as SVGSVGElement;
    const before = svg.querySelector('[data-k="R0"]')?.getAttribute("cy");
    act(() => { svg.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect(svg.getAttribute("aria-valuenow")).not.toBe("0");
    expect(svg.querySelector('[data-k="R0"]')?.getAttribute("cy")).not.toBe(before);
    act(() => { svg.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true })); });
    expect(svg.getAttribute("aria-valuenow")).toBe("0");
    m.unmount();
  });

  it("a new fill value is not written by React: the clock moves the bar from where it was", () => {
    MotionClock.manual(true);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<MizanLoader kind="fill" value={0.1} label="x" />));
    const rect = () => host.querySelector('[data-k="rect"]')?.getAttribute("width");
    const w0 = rect();
    act(() => root.render(<MizanLoader kind="fill" value={0.9} label="x" />));
    expect(rect()).toBe(w0);
    act(() => { root.unmount(); });
    host.remove();
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
    expect(html).toMatch(/aria-label="Expected EGP\s?184,250\.00, Collected EGP\s?181,900\.00, short by ⁨1\.28%⁩"/);
    expect(html).toMatch(/<bdi class="mz-figure"[^>]*>Δ −EGP\s?2,350\.00<\/bdi>/);
    expect(html).toContain('aria-live="polite"');
    // The visible verdict is the readable one; the live region starts empty (it speaks category changes).
    expect(html).toMatch(/<p style="margin:0">short by ⁨1\.28%⁩<\/p><span aria-live="polite" class="mz-sr"><\/span>/);
  });

  it("instrument readings stay A-left, B-right in Arabic (the SVG does not mirror)", () => {
    const html = renderToString(<div dir="rtl"><Gauge a="10.00" b="12.00" currency="EGP" locale="ar-EG" copy={{ title: "g", labelA: "المتوقع", labelB: "المحصل", balanced: "b", shortBy: (p) => p, overBy: (p) => p, tilt: (d) => d, summary: () => "s" }} /></div>);
    expect(html).toMatch(/<div dir="ltr" style="display:flex;justify-content:space-between/);
    expect(html.indexOf("المتوقع")).toBeLessThan(html.indexOf("المحصل"));
    expect(html).toMatch(/text-align:left[^>]*><span[^>]*>المتوقع/);
  });

  it("bullseye isolates only the figures, the labels stay page text", () => {
    const html = renderToString(<Bullseye x={1.2} y={-0.8} locale="en" copy={{ title: "b", labelX: "Cash", labelY: "Stock", level: "l", tolerance: (t) => t, off: "o", offScale: "s" }} />);
    const summary = html.replace(/<!-- -->/g, "");
    expect(summary).toMatch(/Cash <bdi class="mz-figure">\+1\.2%<\/bdi> · Stock <bdi class="mz-figure">−0\.8%<\/bdi>/);
  });

  it("vessels scale marks sit on the physical left, beside the drawn scale", () => {
    const html = renderToString(<Vessels a={120} b={112} locale="en" copy={{ title: "v", labelA: "A", labelB: "B", matched: "m", gap: (p) => p }} />);
    expect(html).toContain("position:absolute;left:0");
    expect(html).not.toContain("inset-inline-start");
  });

  it("a status loader carries its label as text inside the live region, the SVG hidden", () => {
    const html = renderToString(<MizanLoader label="Loading orders" />);
    expect(html).toMatch(/role="status"[^>]*><span class="mz-sr">Loading orders<\/span><svg[^>]*aria-hidden="true"/);
  });

  it("the fill loader's track mirrors in RTL through its class", () => {
    expect(renderToString(<MizanLoader kind="fill" value={0.3} label="x" />)).toContain('class="mz-fill-track"');
  });

  it("the interactive pair slider starts at 0° with a value text", () => {
    const html = renderToString(<MizanLoader interactive label="Tip" />);
    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-valuenow="0"');
    expect(html).toContain('aria-valuetext="0°"');
  });

  it("DoneState: two pans that travel together and a bubble inside them, not a ball above", () => {
    const html = renderToString(<DoneState label="Done" />);
    expect(html).toContain('class="mz-pan-l"');
    expect(html).toContain('class="mz-pan-r"');
    expect(html).toMatch(/<circle cx="60" cy="50" r="5"[^>]*class="mz-drop-in"/);
  });

  it("EventGlyph: merge travels and grows a neck; fail stays ink", () => {
    const merge = renderToString(<EventGlyph outcome="merge" />);
    expect(merge).toContain("mz-pan-l");
    expect(merge).toContain("mz-neck");
    expect(merge).not.toContain("<rect x=\"3.5\"");
    const fail = renderToString(<EventGlyph outcome="fail" />);
    expect(fail).not.toContain("danger");
  });
});

describe("meanings: each auth wait plays what is happening", () => {
  it("AuthProgress: signing in and checking pair, sending transfers, creating and saving drop, confirmed is DoneState", () => {
    const kind = (k: ProgressKind) => { const h = document.createElement("div"); h.innerHTML = renderToString(<AuthProgress kind={k} />); return h; };
    for (const k of ["loading", "signingIn", "checking"] as const) expect(kind(k).querySelector("[data-loader]")?.getAttribute("data-loader"), k).toBe("pair");
    expect(kind("sending").querySelector("[data-loader]")?.getAttribute("data-loader")).toBe("transfer");
    for (const k of ["creating", "saving"] as const) expect(kind(k).querySelector("[data-loader]")?.getAttribute("data-loader"), k).toBe("drop");
    const done = kind("confirmed");
    expect(done.querySelector("[data-loader]")).toBeNull();
    expect(done.querySelector('[data-kind="confirmed"]')).not.toBeNull();
  });

  it("PrimaryCta: the busy key plays its busyAs; idle shows the arrow", () => {
    const h = document.createElement("div");
    h.innerHTML = renderToString(<PrimaryCta label="Continue" busy busyAs="sending" />);
    expect(h.querySelector(".mz-auth-cta__key [data-kind=\"sending\"] [data-loader]")?.getAttribute("data-loader")).toBe("transfer");
    expect(h.querySelector("button")?.getAttribute("aria-busy")).toBe("true");
    h.innerHTML = renderToString(<PrimaryCta label="Continue" busy busyAs="signingIn" />);
    expect(h.querySelector("[data-loader]")?.getAttribute("data-loader")).toBe("pair");
    h.innerHTML = renderToString(<PrimaryCta label="Continue" />);
    expect(h.querySelector("[data-loader]")).toBeNull();
  });

  it("ResendTimer: a resend on its way shows an inline TRANSFER with aria-busy; idle shows none", () => {
    const props = { seconds: 0, startedAt: 0, countdown: (t: ReactElement | string) => t, resendLabel: "Resend", onResend: () => undefined };
    const h = document.createElement("div");
    h.innerHTML = renderToString(<ResendTimer {...props} busy />);
    const link = h.querySelector("button.mz-auth-link");
    expect(link?.getAttribute("aria-busy")).toBe("true");
    expect(link?.querySelector("[data-loader]")?.getAttribute("data-loader")).toBe("transfer");
    h.innerHTML = renderToString(<ResendTimer {...props} />);
    expect(h.querySelector("[data-loader]")).toBeNull();
  });

  it("an indeterminate fill warns in development (and is a type error: test/meaning.check.tsx)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderToString(<MizanLoader {...({ kind: "fill", decorative: true } as unknown as MizanLoaderProps)} />);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("needs a real value"));
  });
});
