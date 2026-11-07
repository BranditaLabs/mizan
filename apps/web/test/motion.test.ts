import { DOMAIN_EVENT_TYPES } from "@mizan/shared";
import { EVENT_MOTION, ORDER_EVENT_TYPES, OUTCOMES, SURFACES, TIMELINE_MOTION } from "@mizan/shared/motion";
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import { successMotion } from "../src/lib/api/query";
import { createEventMotion } from "../src/lib/motion/engine";
import { bellEvent, pendingFor, resolveRule, timelineOutcome, toastsOnSuccess } from "../src/lib/motion/resolve";

type Tree = { [k: string]: string | Tree };
const get = (t: Tree, key: string) => key.split(".").reduce<string | Tree | undefined>((n, k) => (n && typeof n === "object" ? n[k] : undefined), t);
type Timer = ReturnType<typeof setTimeout>;

/** A fake clock and timers for the scheduler (no real waiting). */
function fakeTime() {
  let now = 1_000_000;
  const timers: { at: number; fn: () => void }[] = [];
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => { const t = { at: now + ms, fn }; timers.push(t); return t as unknown as Timer; },
    clearTimer: (t: Timer) => { const i = timers.indexOf(t as unknown as (typeof timers)[number]); if (i >= 0) timers.splice(i, 1); },
    advance(ms: number) {
      now += ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers.splice(timers.indexOf(due), 1);
        due.fn();
      }
    },
  };
}

describe("resolve: the surfaces' side of the catalogue", () => {
  it("never schedules the toast (it confirms the viewer's own action at once)", () => {
    for (const type of DOMAIN_EVENT_TYPES) expect(resolveRule(type).surfaces).not.toContain("toast");
    expect(toastsOnSuccess("member.invited")).toBe(true);
    expect(toastsOnSuccess("shipment.created")).toBe(false);
  });

  it("reads timeline, bell and engine facts", () => {
    expect(resolveRule("timeline.confirmed")).toMatchObject({ outcome: "drop", surfaces: ["timeline"] });
    expect(resolveRule("timeline.nope")).toMatchObject({ outcome: "quiet", surfaces: [] });
    expect(resolveRule("bell.automation.paused")).toMatchObject({ outcome: "fail", surfaces: ["bell"] });
    expect(resolveRule("bell.other")).toMatchObject({ outcome: "settle", surfaces: ["bell"] });
    expect(resolveRule("engine.job.dead").surfaces).toEqual([]);
    expect(timelineOutcome("ship_failed")).toBe("fail");
  });

  it("picks each busy button's loader from the event (drop by default)", () => {
    expect(pendingFor("connection.connected")).toBe("transfer");
    expect(pendingFor("shipment.created")).toBe("transfer");
    expect(pendingFor("order.confirmed")).toBe("drop");
    expect(pendingFor(undefined)).toBe("drop");
    expect(pendingFor("not.an.event")).toBe("drop");
  });

  it("maps the bell's alert sources to their events", () => {
    expect(bellEvent("automation.paused", "x")).toBe("automation.paused");
    expect(bellEvent("plan.limit", "orders|near|240|300|free")).toBe("plan.limit_reached");
    expect(bellEvent("after_confirmation", "blocked|#1042|no_courier")).toBe("order.auto_ship_blocked");
    expect(bellEvent("something", "x")).toBeNull();
  });
});

describe("the motion engine", () => {
  it("confirms the viewer's own success in a toast with the screen's message or the catalogue copy", () => {
    const m = createEventMotion();
    const toasts: unknown[] = [];
    m.setToaster((e) => toasts.push(e));
    m.ownSuccess({ type: "member.invited", entityId: "u1" });
    m.ownSuccess({ type: "shipment.created", entityId: "o1" }); // no toast surface and no message: silent
    m.ownSuccess({ type: "order.confirmed", entityId: "o2", message: "Confirmed" });
    m.ownSuccess({ type: "order.confirmed", entityId: "o3", toast: false });
    expect(toasts).toEqual([{ type: "member.invited" }, { type: "order.confirmed", message: "Confirmed" }]);
    m.dispose();
  });

  it("dispatches a poll fact to mounted surfaces only, and drops the echo of the viewer's own action", () => {
    const time = fakeTime();
    const m = createEventMotion({ ...time, isReduced: () => false });
    const sync: string[] = [];
    m.subscribe("sync", (d) => sync.push(`${d.type}:${d.outcome}`));
    expect(m.push({ type: "connection.sync_failed", entityId: "c1", at: time.now(), source: "poll" })).toBe("dispatched");
    expect(sync).toEqual(["connection.sync_failed:fail"]);
    // The bell is not mounted: dropped silently.
    expect(m.push({ type: "automation.paused", at: time.now(), source: "poll" })).toBe("unmounted");
    // The viewer's own success, then the same fact from a poll within 8 s: nothing plays.
    m.ownSuccess({ type: "connection.connected", entityId: "c2", toast: false });
    time.advance(1000);
    expect(m.push({ type: "connection.connected", entityId: "c2", at: time.now(), source: "poll" })).toBe("echo");
    m.dispose();
  });

  it("marks new rows fresh so they play once, and the rest stay still", () => {
    const time = fakeTime();
    const m = createEventMotion({ ...time, isReduced: () => false });
    m.subscribe("timeline", () => undefined);
    m.push({ id: "e1", type: "timeline.confirmed", entityId: "e1", at: time.now(), source: "poll" });
    m.push({ id: "e2", type: "timeline.tagged", entityId: "e2", at: time.now(), source: "poll" });
    expect(m.isFresh("e1")).toBe(false); // merging (600 ms window)
    time.advance(700);
    expect(m.isFresh("e1") && m.isFresh("e2")).toBe(true);
    time.advance(6000);
    expect(m.isFresh("e1")).toBe(false);
    m.dispose();
  });
});

describe("a mutation names its event (meta.motion)", () => {
  it("hands the provider the event, the entity, the variant's facts and the screen's message", () => {
    const s = successMotion({ type: (_d, v) => (v === "confirm" ? "order.confirmed" : "order.cancelled"), entityId: () => "o1", message: () => "Done" }, { ok: true }, "confirm");
    expect(s).toEqual({ type: "order.confirmed", entityId: "o1", message: "Done" });
    expect(successMotion({ type: "order.created", data: () => ({ actor: { type: "user" } }), toast: false }, {}, undefined))
      .toEqual({ type: "order.created", data: { actor: { type: "user" } }, toast: false });
    expect(successMotion(undefined, {}, undefined)).toBeNull();
  });
});

describe("motion copy in both languages", () => {
  it("every catalogue event and timeline row has its copy", () => {
    for (const [lang, msgs] of [["ar", ar], ["en", en]] as const) {
      for (const rule of Object.values(EVENT_MOTION)) if (rule.copy) expect(typeof get(msgs as Tree, rule.copy), `${lang} ${rule.copy}`).toBe("string");
      for (const type of ORDER_EVENT_TYPES) expect(typeof get(msgs as Tree, TIMELINE_MOTION[type].copy), `${lang} ${type}`).toBe("string");
    }
  });

  it("the gallery names every outcome, loader and surface", () => {
    for (const msgs of [ar, en] as Tree[]) {
      for (const o of OUTCOMES) {
        expect(typeof get(msgs, `gallery.motion.outcome.${o}`)).toBe("string");
        expect(typeof get(msgs, `gallery.motion.outcomeMeaning.${o}`)).toBe("string");
      }
      for (const s of SURFACES) expect(typeof get(msgs, `gallery.motion.surface.${s}`)).toBe("string");
      for (const k of ["pair", "transfer", "drop", "fill", "level"]) expect(typeof get(msgs, `gallery.motion.kind.${k}`)).toBe("string");
    }
  });
});
