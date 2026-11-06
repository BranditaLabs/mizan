import { describe, expect, it } from "vitest";
import {
  entitlementPlan, nextStatus, startOfLocalDay, SUBSCRIPTION_EVENTS, SUBSCRIPTION_STATUSES, TRANSITIONS, TransitionError, trialDaysLeft, trialEndsAt,
  type SubscriptionEvent, type SubscriptionStatus,
} from "../src/modules/billing/state.js";

/** The subscription state machine (E12-2a1): every edge, and every edge that is not there. */
describe("subscription state machine", () => {
  const edges: Array<[SubscriptionStatus | null, SubscriptionEvent, SubscriptionStatus, SubscriptionStatus?]> = [
    [null, "start_trial", "trialing"],
    [null, "start", "active"],
    ["trialing", "trial_end", "expired"],
    ["trialing", "pay_ok", "active"],
    ["past_due", "pay_ok", "active"],
    ["restricted", "pay_ok", "active"],
    ["incomplete", "pay_ok", "active"],
    ["active", "renewal_fail", "past_due"],
    ["past_due", "grace_end", "restricted"],
    ["restricted", "restricted_end", "expired"],
    ["active", "cancel", "active"],
    ["active", "uncancel", "active"],
    ["active", "period_end_cancel", "cancelled"],
    ["active", "pause", "paused"],
    ["paused", "resume", "active"],
    ["trialing", "checkout_open", "incomplete"],
    ["active", "checkout_open", "incomplete"],
    ["past_due", "checkout_open", "incomplete"],
    ["restricted", "checkout_open", "incomplete"],
    ["paused", "checkout_open", "incomplete"],
    ["incomplete", "checkout_expired", "trialing", "trialing"],
    ["incomplete", "checkout_expired", "restricted", "restricted"],
    ["trialing", "change_plan", "trialing"],
    ["active", "change_plan", "active"],
    ["trialing", "staff_override", "active"],
    ["past_due", "staff_override", "active"],
    ["restricted", "staff_override", "active"],
    ["paused", "staff_override", "active"],
    ["active", "staff_override", "active"],
  ];

  it.each(edges)("%s --%s--> %s", (from, event, to, previous) => {
    expect(nextStatus(from, event, previous)).toBe(to);
  });

  it("refuses every edge the table does not have", () => {
    const allowed = new Set(edges.map(([f, e]) => `${f}|${e}`));
    let refused = 0;
    for (const from of [null, ...SUBSCRIPTION_STATUSES]) {
      for (const event of SUBSCRIPTION_EVENTS) {
        if (allowed.has(`${from}|${event}`)) continue;
        expect(() => nextStatus(from, event, "active"), `${from} ${event}`).toThrow(TransitionError);
        refused++;
      }
    }
    expect(refused).toBe((SUBSCRIPTION_STATUSES.length + 1) * SUBSCRIPTION_EVENTS.length - allowed.size);
    // Ended subscriptions never come back: a new one opens instead.
    for (const ended of ["cancelled", "expired"] as const) for (const e of SUBSCRIPTION_EVENTS) expect(() => nextStatus(ended, e)).toThrow(TransitionError);
  });

  it("returns from an open checkout only to a state it can hold", () => {
    expect(() => nextStatus("incomplete", "checkout_expired", null)).toThrow(TransitionError);
    expect(() => nextStatus("incomplete", "checkout_expired", "expired")).toThrow(TransitionError);
  });

  it("covers every event in the table", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...SUBSCRIPTION_EVENTS].sort());
  });

  it("entitles the tier while trialing, active or past due; Free when restricted, paused or ended; an open checkout keeps the state before", () => {
    const at = (status: SubscriptionStatus, previousStatus?: SubscriptionStatus) => entitlementPlan({ status, plan: "scale", previousStatus: previousStatus ?? null });
    expect(["trialing", "active", "past_due"].map((s) => at(s as SubscriptionStatus))).toEqual(["scale", "scale", "scale"]);
    expect(["restricted", "paused", "cancelled", "expired"].map((s) => at(s as SubscriptionStatus))).toEqual(["free", "free", "free", "free"]);
    expect(at("incomplete", "trialing")).toBe("scale");
    expect(at("incomplete", "restricted")).toBe("free");
    expect(at("incomplete")).toBe("free");
  });
});

describe("trial dates in the store's time zone", () => {
  it("ends at 23:59:59 on day 7, the start day being day 1", () => {
    // Monday 2026-11-02 15:00 Cairo (UTC+2) → Sunday 2026-11-08 23:59:59 Cairo.
    const end = trialEndsAt(new Date("2026-11-02T13:00:00Z"), "Africa/Cairo", 7);
    expect(end.toISOString()).toBe("2026-11-08T21:59:59.000Z");
    // 23:30 Riyadh on the 2nd is already the 2nd there, not the 3rd (UTC 20:30).
    expect(trialEndsAt(new Date("2026-11-02T20:30:00Z"), "Asia/Riyadh", 7).toISOString()).toBe("2026-11-08T20:59:59.000Z");
    // Just after midnight Riyadh is the next local day.
    expect(trialEndsAt(new Date("2026-11-02T21:30:00Z"), "Asia/Riyadh", 7).toISOString()).toBe("2026-11-09T20:59:59.000Z");
  });

  it("follows a daylight-saving change (Cairo's summer time ends on the last Thursday of October)", () => {
    expect(startOfLocalDay("2026-10-29", "Africa/Cairo").toISOString()).toBe("2026-10-28T21:00:00.000Z"); // UTC+3 until that night
    expect(startOfLocalDay("2026-10-31", "Africa/Cairo").toISOString()).toBe("2026-10-30T22:00:00.000Z"); // UTC+2 after
    expect(trialEndsAt(new Date("2026-10-27T10:00:00Z"), "Africa/Cairo", 7).toISOString()).toBe("2026-11-02T21:59:59.000Z");
  });

  it("counts calendar days left, today included", () => {
    const tz = "Africa/Cairo";
    const end = trialEndsAt(new Date("2026-11-02T13:00:00Z"), tz, 7);
    expect(trialDaysLeft(end, new Date("2026-11-02T13:00:00Z"), tz)).toBe(7);
    expect(trialDaysLeft(end, new Date("2026-11-07T23:00:00Z"), tz)).toBe(1); // 01:00 on Sunday in Cairo: the last day
    expect(trialDaysLeft(end, new Date("2026-11-08T21:59:58Z"), tz)).toBe(1);
    expect(trialDaysLeft(end, new Date("2026-11-08T21:59:59Z"), tz)).toBe(0);
  });
});
