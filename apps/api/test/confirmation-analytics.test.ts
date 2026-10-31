import { describe, expect, it } from "vitest";
import { channelOf, median, outcomeOf, summarize, type ConfirmationFact } from "../src/modules/confirmation/analytics.js";

/** E6-6: how confirmation results add up, worked by hand. */
const at = (min: number) => new Date(Date.UTC(2026, 9, 1, 10, min));
const f = (over: Partial<ConfirmationFact>): ConfirmationFact => ({
  route: "bot", status: "pending_confirmation", runStatus: "running", answeredChannel: null, placedAt: at(0), confirmedAt: null, ...over,
});

describe("confirmation analytics", () => {
  it("an order is confirmed once confirmed, even if it was shipped, returned or cancelled later", () => {
    expect(["confirmed", "shipped", "delivered", "returned"].map((status) => outcomeOf({ status, confirmedAt: at(5) }))).toEqual(Array(4).fill("confirmed"));
    expect(outcomeOf({ status: "cancelled", confirmedAt: at(5) })).toBe("confirmed");
    expect(outcomeOf({ status: "cancelled", confirmedAt: null })).toBe("cancelled");
    expect(outcomeOf({ status: "pending_confirmation", confirmedAt: null })).toBe("pending");
  });

  it("the answering channel: automated calls read as one channel; nothing answered = the store decided", () => {
    expect(channelOf({ answeredChannel: "voice_ivr", route: "bot" })).toBe("call_auto");
    expect(channelOf({ answeredChannel: null, route: "auto" })).toBe("auto");
    expect(channelOf({ answeredChannel: null, route: "bot" })).toBe("store");
  });

  it("by route and by channel, with the rate over decided orders and the median time to confirm", () => {
    const s = summarize([
      f({ route: "auto", status: "confirmed", runStatus: null, confirmedAt: at(0) }),
      f({ route: "auto", status: "delivered", runStatus: null, confirmedAt: at(0) }),
      f({ route: "bot", status: "confirmed", runStatus: "confirmed", answeredChannel: "whatsapp", confirmedAt: at(12) }),
      f({ route: "bot", status: "confirmed", runStatus: "confirmed", answeredChannel: "whatsapp", confirmedAt: at(30) }),
      f({ route: "bot", status: "cancelled", runStatus: "cancelled", answeredChannel: "whatsapp" }),
      f({ route: null, status: "pending_confirmation", runStatus: "needs_agent" }), // routing off: the cascade
      f({ route: "agent", status: "confirmed", runStatus: "confirmed", answeredChannel: "call_team", confirmedAt: at(90) }),
      f({ route: "agent", status: "cancelled", runStatus: "stopped" }), // cancelled in the store
      f({ route: "hold", status: "pending_confirmation", runStatus: "needs_agent" }),
    ]);
    expect(s).toMatchObject({ orders: 9, confirmed: 5, cancelled: 2, pending: 2, rate: "71.4", needsTeam: 2, medianMinutes: 30 });
    expect(s.byRoute).toEqual([
      { route: "auto", orders: 2, confirmed: 2, cancelled: 0, pending: 0, rate: "100.0" },
      { route: "bot", orders: 4, confirmed: 2, cancelled: 1, pending: 1, rate: "66.7" },
      { route: "agent", orders: 2, confirmed: 1, cancelled: 1, pending: 0, rate: "50.0" },
      { route: "hold", orders: 1, confirmed: 0, cancelled: 0, pending: 1, rate: null },
    ]);
    expect(s.byChannel).toEqual([
      { channel: "auto", confirmed: 2, cancelled: 0 },
      { channel: "whatsapp", confirmed: 2, cancelled: 1 },
      { channel: "call_team", confirmed: 1, cancelled: 0 },
      { channel: "store", confirmed: 0, cancelled: 1 },
    ]);
  });

  it("nothing yet: zeros and nulls, no empty routes", () => {
    expect(summarize([])).toEqual({ orders: 0, confirmed: 0, cancelled: 0, pending: 0, rate: null, needsTeam: 0, medianMinutes: null, byRoute: [], byChannel: [] });
    expect([median([5]), median([4, 1, 9, 2])]).toEqual([5, 3]);
  });

  it("over 2,000 generated orders: the parts add up to the whole", () => {
    let seed = 11;
    const r = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
    const facts = Array.from({ length: 2000 }, () => {
      const status = pick(["pending_confirmation", "confirmed", "cancelled", "shipped", "delivered", "returned"]);
      return f({
        route: pick(["auto", "bot", "agent", "hold", null]), status, runStatus: pick([null, "running", "needs_agent", "confirmed", "cancelled", "stopped"]),
        answeredChannel: pick([null, "whatsapp", "link", "call_team", "voice_ivr", "agent", "auto"]), confirmedAt: status === "pending_confirmation" || r() < 0.3 ? null : at(Math.floor(r() * 600)),
      });
    });
    const s = summarize(facts);
    expect(s.confirmed + s.cancelled + s.pending).toBe(s.orders);
    for (const k of ["orders", "confirmed", "cancelled", "pending"] as const) expect(s.byRoute.reduce((a, x) => a + x[k], 0)).toBe(s[k]);
    expect(s.byChannel.reduce((a, x) => a + x.confirmed, 0)).toBe(s.confirmed);
    expect(s.byChannel.reduce((a, x) => a + x.cancelled, 0)).toBe(s.cancelled);
    expect(s.needsTeam).toBeLessThanOrEqual(s.pending);
  });
});
