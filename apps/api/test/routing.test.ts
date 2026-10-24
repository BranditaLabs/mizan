import { describe, expect, it } from "vitest";
import { DEFAULT_ROUTING, routeFor } from "../src/modules/confirmation/routing.js";

/** E6-2: the route for each payment method and risk band. */
const on = { ...DEFAULT_ROUTING, enabled: true };
const r = (paymentMode: string, score: number | null, paid = false) => routeFor({ paymentMode, paid, score }, on);

describe("routing by payment method and risk band", () => {
  it("off: cash orders walk the cascade, others are not confirmed", () => {
    expect(routeFor({ paymentMode: "cod", paid: false, score: 0 }, DEFAULT_ROUTING)).toBe("bot");
    expect(routeFor({ paymentMode: "partial", paid: true, score: 99 }, DEFAULT_ROUTING)).toBe("bot");
    expect(routeFor({ paymentMode: "prepaid", paid: true, score: 0 }, DEFAULT_ROUTING)).toBeNull();
  });

  it("cash: auto · chat · team · hold at 25 / 60 / 85", () => {
    expect([0, 25, 26, 60, 61, 85, 86, 100].map((s) => r("cod", s))).toEqual(["auto", "auto", "bot", "bot", "agent", "agent", "hold", "hold"]);
    expect(r("cod", null)).toBe("bot"); // not scored: ask
    expect(r("partial", 10, true)).toBe("auto");
  });

  it("paid online: approved unless very risky; BNPL approved; a bank transfer waits for its money", () => {
    expect(r("prepaid", 10, true)).toBe("auto");
    expect(r("prepaid", 90, true)).toBe("hold");
    expect(r("bnpl", 99)).toBe("auto");
    expect(r("bank_transfer", 10, false)).toBeNull();
    expect(r("bank_transfer", 10, true)).toBe("auto");
  });

  it("the store's own thresholds", () => {
    const strict = { enabled: true, autoMax: 0, botMax: 40, agentMax: 70 };
    expect([0, 1, 40, 41, 70, 71].map((s) => routeFor({ paymentMode: "cod", paid: false, score: s }, strict))).toEqual(["auto", "bot", "bot", "agent", "agent", "hold"]);
  });
});
