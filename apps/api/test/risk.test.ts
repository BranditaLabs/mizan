import { describe, expect, it } from "vitest";
import { bandOf, scoreOrder, type RiskFacts } from "../src/modules/orders/risk.js";

/** E6-1: the risk score's rules, worked examples, and properties over generated orders. */
const base: RiskFacts = {
  paymentMode: "cod", paid: false, history: { delivered: 0, refused: 0, cancelled: 0, chargebacks: 0, last24h: 0 },
  duplicate: false, address: { line1Length: 20, hasCity: true }, phoneValid: true, valueRatio: 1, totalQuantity: 1,
};
const f = (over: Partial<RiskFacts> & { h?: Partial<RiskFacts["history"]> } = {}): RiskFacts => ({ ...base, ...over, history: { ...base.history, ...over.h } });

describe("risk score v1", () => {
  it("cash on delivery: the customer's track record weighs most", () => {
    expect(scoreOrder(f())).toEqual({ score: 30, band: "medium", reasons: [{ code: "first_order", points: 10 }] });
    expect(scoreOrder(f({ h: { delivered: 3 } }))).toEqual({ score: 0, band: "low", reasons: [{ code: "delivered_before", points: -30 }] });
    const refuser = scoreOrder(f({ h: { refused: 2, delivered: 1 } }));
    expect(refuser).toMatchObject({ score: 60, band: "medium" });
    expect(refuser.reasons[0]).toEqual({ code: "refused_before", points: 50 });
  });

  it("names the three reasons that moved it most", () => {
    const r = scoreOrder(f({ phoneValid: false, duplicate: true, address: { line1Length: 3, hasCity: true }, valueRatio: 5, totalQuantity: 6 }));
    expect(r.score).toBe(100);
    expect(r.band).toBe("very_high");
    expect(r.reasons.map((x) => x.code)).toEqual(["phone_invalid", "very_high_value", "duplicate"]);
  });

  it("each payment method has its own worries", () => {
    expect(scoreOrder(f({ paymentMode: "prepaid", paid: true })).score).toBe(10);
    expect(scoreOrder(f({ paymentMode: "prepaid", paid: true, h: { chargebacks: 1, last24h: 3 } })).reasons.map((r) => r.code)).toEqual(["chargeback_before", "velocity"]);
    expect(scoreOrder(f({ paymentMode: "bnpl", phoneValid: false, h: { refused: 3 } })).score).toBe(5); // the provider carries the risk
    expect(scoreOrder(f({ paymentMode: "bank_transfer" })).reasons).toEqual([{ code: "awaiting_transfer", points: 15 }]);
    expect(scoreOrder(f({ paymentMode: "partial", paid: true, h: { delivered: 1 } })).score).toBe(0); // deposit paid, known customer
  });

  it("bands match the routing thresholds (25 · 60 · 85)", () => {
    expect([0, 25, 26, 60, 61, 85, 86, 100].map(bandOf)).toEqual(["low", "low", "medium", "medium", "high", "high", "very_high", "very_high"]);
  });

  it("over 3,000 generated orders: always 0–100, at most 3 reasons, deterministic; more refusals never lower it", () => {
    let seed = 7;
    const r = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const modes = ["cod", "partial", "prepaid", "bnpl", "bank_transfer", "unknown"];
    for (let i = 0; i < 3000; i++) {
      const facts = f({
        paymentMode: modes[Math.floor(r() * modes.length)]!, paid: r() < 0.5, duplicate: r() < 0.1, phoneValid: r() < 0.9,
        address: { line1Length: Math.floor(r() * 40), hasCity: r() < 0.9 }, valueRatio: r() < 0.1 ? null : r() * 6, totalQuantity: 1 + Math.floor(r() * 8),
        h: { delivered: Math.floor(r() * 5), refused: Math.floor(r() * 3), cancelled: Math.floor(r() * 3), chargebacks: Math.floor(r() * 2), last24h: Math.floor(r() * 5) },
      });
      const s = scoreOrder(facts);
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
      expect(s.reasons.length).toBeLessThanOrEqual(3);
      expect(scoreOrder(facts)).toEqual(s);
      expect(scoreOrder({ ...facts, history: { ...facts.history, refused: facts.history.refused + 1 } }).score).toBeGreaterThanOrEqual(s.score);
    }
  });
});
