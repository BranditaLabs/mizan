import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScheduler, LIMITS, type MotionDispatch, type ResolvedRule } from "../motion/scheduler";
import { RedBudget, RED_PRIORITY } from "../motion/red-budget";
import { formatDeg, formatInt, formatMoney, formatPct, MINUS } from "../motion/format";
import { M } from "../motion/spring";

// A tiny stand-in for the shared catalogue (the scheduler takes it injected).
const RULES: Record<string, ResolvedRule> = {
  "order.confirmed": { outcome: "drop", surfaces: ["button", "toast", "timeline"], copy: "motion.event.order.confirmed" },
  "payment.received": { outcome: "drop", surfaces: ["card", "kpi"], copy: "motion.event.payment.received" },
  "shipment.status_changed": { outcome: "settle", surfaces: ["list", "timeline"], copy: "motion.event.shipment.status_changed", mergeKey: "list" },
  "order.updated": { outcome: "quiet", surfaces: ["timeline"], copy: null },
  "stock.low": { outcome: "tip", surfaces: ["list", "bell"], copy: "motion.event.stock.low" },
};
const resolve = (type: string) => RULES[type] ?? { outcome: "settle", surfaces: [], copy: null };

function setup(opts: { mounted?: (s: string) => boolean } = {}) {
  const out: MotionDispatch[] = [];
  const refreshed: string[] = [];
  const s = createScheduler({ resolve, dispatch: (d) => out.push(d), refresh: (t) => refreshed.push(t), isMounted: opts.mounted });
  return { s, out, refreshed };
}

describe("the motion scheduler", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-07T10:00:00Z")); });
  afterEach(() => vi.useRealTimers());
  const now = () => Date.now();

  it("drops a replayed id (a live stream's overlap window)", () => {
    const { s, out } = setup();
    expect(s.push({ id: "e1", type: "stock.low", at: now(), source: "live" })).toBe("dispatched");
    expect(s.push({ id: "e1", type: "stock.low", at: now(), source: "live" })).toBe("duplicate");
    expect(out).toHaveLength(1);
  });

  it("the seen-id memory is bounded (2,000)", () => {
    const { s } = setup();
    for (let i = 0; i < LIMITS.seen + 5; i++) s.push({ id: `x${i}`, type: "order.updated", at: now(), source: "live" });
    expect(s.push({ id: "x0", type: "order.updated", at: now(), source: "live" })).toBe("quiet");
    expect(s.push({ id: `x${LIMITS.seen + 4}`, type: "order.updated", at: now(), source: "live" })).toBe("duplicate");
  });

  it("an echo of the viewer's own success plays nothing for 8 s", () => {
    const { s, out } = setup();
    s.push({ type: "order.confirmed", entityId: "o1", at: now(), source: "mutation" });
    s.recordLocalSuccess("order.confirmed", "o1");
    vi.advanceTimersByTime(3000);
    expect(s.push({ id: "e9", type: "order.confirmed", entityId: "o1", at: now(), source: "live" })).toBe("echo");
    vi.advanceTimersByTime(LIMITS.echoMs);
    expect(s.push({ id: "e10", type: "order.confirmed", entityId: "o1", at: now(), source: "live" })).toBe("dispatched");
    expect(out).toHaveLength(2);
  });

  it("merges the same surfaces and merge key within 600 ms into one dispatch with a count", () => {
    const { s, out } = setup();
    for (let i = 0; i < 5; i++) { s.push({ id: `m${i}`, type: "shipment.status_changed", entityId: `s${i}`, at: now(), source: "poll" }); vi.advanceTimersByTime(100); }
    expect(out).toHaveLength(0);
    vi.advanceTimersByTime(LIMITS.mergeMs);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ count: 5, batched: true, copy: "motion.batched" });
    expect(s.isFresh("m3")).toBe(true);
  });

  it("500 events in a second: at most 6 dispatches, then one batched end frame", () => {
    const types = Object.keys(RULES).filter((t) => t !== "order.updated");
    const { s, out } = setup();
    for (let i = 0; i < 500; i++) { s.push({ id: `b${i}`, type: types[i % types.length], entityId: `e${i}`, at: now(), source: "live" }); vi.advanceTimersByTime(2); }
    vi.advanceTimersByTime(LIMITS.mergeMs);
    const live = out.filter((d) => !d.batched || d.count < 2).length;
    expect(live).toBeLessThanOrEqual(LIMITS.burst);
    expect(s.storming).toBe(true);
    vi.advanceTimersByTime(LIMITS.stormMs);
    const batched = out.filter((d) => d.type === "batched");
    expect(batched).toHaveLength(1);
    expect(batched[0].count).toBeGreaterThan(50);
    expect(out.length).toBeLessThanOrEqual(LIMITS.burst + 2);
  });

  it("one DROP per 3 s: a second confirmation settles as done", () => {
    const { s, out } = setup();
    s.push({ id: "d1", type: "order.confirmed", at: now(), source: "live" });
    vi.advanceTimersByTime(1000);
    s.push({ id: "d2", type: "payment.received", at: now(), source: "live" });
    vi.advanceTimersByTime(LIMITS.dropGapMs);
    s.push({ id: "d3", type: "payment.received", at: now(), source: "live" });
    expect(out.map((d) => d.outcome)).toEqual(["drop", "done", "drop"]);
  });

  it("a hidden tab plays nothing, then the bell gets one summary", () => {
    const { s, out } = setup();
    s.setHidden(true);
    for (let i = 0; i < 7; i++) expect(s.push({ id: `h${i}`, type: "stock.low", at: now(), source: "live" })).toBe("hidden");
    expect(out).toHaveLength(0);
    s.setHidden(false);
    expect(out).toEqual([expect.objectContaining({ summary: true, count: 7, surfaces: ["bell"] })]);
  });

  it("history and resync refresh data with no motion", () => {
    const { s, out, refreshed } = setup();
    expect(s.push({ id: "old", type: "stock.low", at: now() - 60_000, source: "live" })).toBe("history");
    expect(s.push({ type: "stock.low", at: now(), source: "resync" })).toBe("history");
    expect(s.push({ type: "stock.low", at: now(), source: "history" })).toBe("history");
    expect(out).toHaveLength(0);
    expect(refreshed).toEqual(["stock.low", "stock.low", "stock.low"]);
  });

  it("waits for a stream's ready when asked", () => {
    const out: MotionDispatch[] = [];
    const s = createScheduler({ resolve, dispatch: (d) => out.push(d), ready: false });
    expect(s.push({ type: "stock.low", at: now(), source: "live" })).toBe("history");
    s.markReady();
    vi.advanceTimersByTime(10);
    expect(s.push({ type: "stock.low", at: now(), source: "live" })).toBe("dispatched");
  });

  it("an unmounted surface drops the dispatch silently; quiet events never dispatch", () => {
    const { s, out } = setup({ mounted: (x) => x === "kpi" });
    expect(s.push({ type: "stock.low", at: now(), source: "live" })).toBe("unmounted");
    expect(s.push({ type: "order.updated", at: now(), source: "live" })).toBe("quiet");
    expect(s.push({ type: "payment.received", at: now(), source: "live" })).toBe("dispatched");
    expect(out[0].surfaces).toEqual(["kpi"]);
  });

  it("a surface inside its gap holds its own event; it does not start a storm for the others", () => {
    const { s, out } = setup();
    expect(s.push({ id: "g1", type: "stock.low", at: now(), source: "live" })).toBe("dispatched");
    vi.advanceTimersByTime(300);
    expect(s.push({ id: "g2", type: "stock.low", at: now(), source: "live" })).toBe("held");
    expect(s.storming).toBe(false);
    expect(s.push({ id: "g3", type: "payment.received", at: now(), source: "live" })).toBe("dispatched");
    vi.advanceTimersByTime(LIMITS.bellGapMs);
    const held = out.filter((d) => d.type === "held");
    expect(held.map((d) => d.surfaces[0]).sort()).toEqual(["bell", "list"]);
    expect(held.every((d) => d.batched && d.count === 1)).toBe(true);
  });

  it("a steady merge stream flushes within 1.5 s instead of waiting for a pause", () => {
    const { s, out } = setup();
    for (let i = 0; i < 30; i++) { s.push({ id: `st${i}`, type: "shipment.status_changed", entityId: `s${i}`, at: now(), source: "poll" }); vi.advanceTimersByTime(100); }
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0].count).toBeLessThanOrEqual(LIMITS.mergeMaxMs / 100 + 1);
  });

  it("the fresh map forgets ids older than 5 s", () => {
    const { s } = setup();
    s.push({ id: "f1", type: "stock.low", at: now(), source: "live" });
    vi.advanceTimersByTime(LIMITS.freshMs + 10);
    expect(s.isFresh("f1")).toBe(false);
    s.push({ id: "f2", type: "payment.received", at: now(), source: "live" });
    expect(s.isFresh("f2")).toBe(true);
  });

  it("holds ids, types and times only: event data is never kept", () => {
    const { s, out } = setup();
    s.push({ id: "p1", type: "stock.low", at: now(), source: "live", data: { phone: "+201000000000", name: "Someone" } });
    expect(JSON.stringify(out)).not.toMatch(/phone|Someone|2010/);
  });
});

describe("the red budget", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("one holder at a time; a better priority preempts; release hands it back", () => {
    const b = new RedBudget();
    expect(b.claim("loader", RED_PRIORITY.pageLoader)).toBe(true);
    expect(b.claim("dot", RED_PRIORITY.dot)).toBe(false);
    expect(b.claim("verdict", RED_PRIORITY.verdict)).toBe(true);
    expect(b.has("loader")).toBe(false);
    b.release("verdict");
    expect(b.holder()).toBe("loader");
  });

  it("a DROP preempts, then releases after its ripple", () => {
    const b = new RedBudget();
    b.claim("verdict", RED_PRIORITY.verdict);
    expect(b.claim("drop", RED_PRIORITY.drop, { ttlMs: M.duration.fall + M.duration.ripple })).toBe(true);
    vi.advanceTimersByTime(M.duration.fall + M.duration.ripple - 1);
    expect(b.holder()).toBe("drop");
    vi.advanceTimersByTime(2);
    expect(b.holder()).toBe("verdict");
  });

  it("warns in development with both owner ids (ids only)", () => {
    const b = new RedBudget();
    b.claim("a", 3); b.claim("b", 3);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"a" holds it; mono: "b"'));
  });

  it("a new view resets it and notifies", () => {
    const b = new RedBudget();
    const seen: (string | null)[] = [];
    b.subscribe(() => seen.push(b.holder()));
    b.claim("x", 1);
    b.reset();
    expect(seen).toEqual(["x", null]);
  });
});

describe("figures", () => {
  it.each(["en", "ar-EG", "ar"])("%s: Latin digits and the U+2212 minus", (loc) => {
    expect(formatInt(-1234567, loc)).toMatch(new RegExp(`^${MINUS}1[,٬]?234[,٬]?567$`));
    expect(formatInt(1234, loc)).not.toMatch(/[٠-٩]/);
    expect(formatPct(-1.25, loc, 2)).toContain(MINUS);
    expect(formatPct(1.25, loc, 2)).toMatch(/1[.٫]25/);
  });

  it("money from a decimal string, exactly, in the currency passed", () => {
    expect(formatMoney("184250.00", "EGP", "en")).toMatch(/EGP\s?184,250\.00/);
    expect(formatMoney("1150.5", "SAR", "en")).toMatch(/SAR\s?1,150\.50/);
    expect(formatMoney("-20.00", "AED", "en")).toContain(MINUS);
    expect(formatMoney("12345678901234567.89", "EGP", "en")).toContain("12,345,678,901,234,567.89");
    const ar = formatMoney("184250.00", "EGP", "ar-EG");
    expect(ar).toMatch(/184[,٬]250[.٫]00/);
    expect(ar).not.toMatch(/[‎‏؜]/);
  });

  it("degrees carry a sign", () => {
    expect(formatDeg(-3.21, "en")).toBe(`${MINUS}3.2°`);
    expect(formatDeg(4, "en")).toBe("+4.0°");
  });
});
