import { describe, expect, it } from "vitest";
import { discounted, recommend, type Candidate, type RecommendInput, type Rule } from "../src/modules/confirmation/offers/recommend.js";

/**
 * E6-11: which offer to make. Properties over generated stores (seeded, so a failure always
 * reproduces), then the cases a merchant would check by hand.
 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const v = (id: string, price: number, over: Partial<Candidate> = {}): Candidate => ({ variantId: id, title: `P ${id}`, priceMinor: BigInt(price), costMinor: null, available: null, active: true, ...over });
const base = (over: Partial<RecommendInput> = {}): RecommendInput => ({
  mode: "rules_then_auto", maxDiscountPct: "15", autoDiscountPct: "10", currency: "EGP", orderTotalMinor: 125000n, orderVariantIds: ["abaya"],
  rules: [], candidates: new Map(), boughtWith: new Map(), popularity: new Map(), ...over,
});
const cands = (...xs: Candidate[]) => new Map(xs.map((x) => [x.variantId, x]));
const rule = (over: Partial<Rule>): Rule => ({ id: "r1", triggerVariantId: null, offerVariantId: "scarf", discountPct: "10", priority: 0, messageAr: null, messageEn: null, ...over });

describe("offer properties (3,000 generated orders)", () => {
  const r = rng(20261023);
  const cases = Array.from({ length: 3000 }, () => {
    const ids = Array.from({ length: 2 + Math.floor(r() * 10) }, (_, i) => `v${i}`);
    const candidates = cands(...ids.map((id) => v(id, 1000 + Math.floor(r() * 200_000), {
      costMinor: r() < 0.5 ? BigInt(Math.floor(r() * 150_000)) : null, available: r() < 0.2 ? 0 : r() < 0.5 ? null : 5, active: r() > 0.1,
    })));
    const inOrder = ids.filter(() => r() < 0.3);
    const rules = r() < 0.5 ? [rule({ offerVariantId: ids[Math.floor(r() * ids.length)]!, discountPct: String(Math.floor(r() * 50)), triggerVariantId: r() < 0.5 ? null : ids[0]! })] : [];
    const together = new Map(ids.filter(() => r() < 0.4).map((id) => [id, 1 + Math.floor(r() * 20)] as const));
    const popular = new Map(ids.filter(() => r() < 0.4).map((id) => [id, 1 + Math.floor(r() * 50)] as const));
    const modes = ["rules_then_auto", "rules", "auto"] as const;
    return base({ mode: modes[Math.floor(r() * 3)]!, orderTotalMinor: BigInt(5000 + Math.floor(r() * 400_000)), orderVariantIds: inOrder, rules, candidates, boughtWith: together, popularity: popular, maxDiscountPct: String(Math.floor(r() * 30)) });
  });

  it("never offers what is in the order, sold out, inactive, at a loss, or more than 60% of the order", () => {
    for (const c of cases) {
      const o = recommend(c);
      if (!o) continue;
      const x = c.candidates.get(o.variantId)!;
      expect(c.orderVariantIds).not.toContain(o.variantId);
      expect(x.active).toBe(true);
      expect(x.available === null || x.available > 0).toBe(true);
      if (x.costMinor !== null) expect(o.offerPriceMinor > x.costMinor).toBe(true);
      expect(o.offerPriceMinor * 100n <= c.orderTotalMinor * 60n + 100n).toBe(true);
    }
  });

  it("never discounts beyond the store's cap, and the price shown is never above the price before", () => {
    for (const c of cases) {
      const o = recommend(c);
      if (!o) continue;
      expect(Number(o.discountPct)).toBeLessThanOrEqual(Number(c.maxDiscountPct));
      expect(o.offerPriceMinor <= o.unitPriceMinor).toBe(true);
      expect(o.offerPriceMinor).toBe(discounted(o.unitPriceMinor, o.discountPct, "EGP"));
    }
  });

  it("follows the mode: rules only never recommends; recommendations only never uses a rule", () => {
    for (const c of cases) {
      const o = recommend(c);
      if (c.mode === "rules" && o) expect(o.source).toBe("rule");
      if (c.mode === "auto" && o) expect(o.source).toBe("auto");
    }
  });

  it("is deterministic", () => {
    for (const c of cases.slice(0, 300)) expect(recommend(c)).toEqual(recommend(c));
  });
});

describe("worked examples", () => {
  it("the owner's rule: an abaya order gets the matching scarf at 10% off (150 → 135)", () => {
    const o = recommend(base({ rules: [rule({ triggerVariantId: "abaya", messageAr: "طرحة على نفس اللون" })], candidates: cands(v("scarf", 15000)) }));
    expect(o).toMatchObject({ variantId: "scarf", source: "rule", ruleId: "r1", unitPriceMinor: 15000n, offerPriceMinor: 13500n, discountPct: "10", messageAr: "طرحة على نفس اللون" });
  });

  it("a rule for this order's product beats a rule for any order, whatever the priority", () => {
    const o = recommend(base({
      rules: [rule({ id: "any", offerVariantId: "bag", priority: 50 }), rule({ id: "abaya", triggerVariantId: "abaya", offerVariantId: "scarf" })],
      candidates: cands(v("scarf", 15000), v("bag", 30000)),
    }));
    expect(o?.ruleId).toBe("abaya");
  });

  it("caps a rule's discount at the store's maximum", () => {
    expect(recommend(base({ rules: [rule({ discountPct: "40" })], candidates: cands(v("scarf", 15000)) }))).toMatchObject({ discountPct: "15", offerPriceMinor: 12750n });
  });

  it("skips a rule whose product is sold out, then recommends what is bought together", () => {
    const o = recommend(base({
      rules: [rule({})], candidates: cands(v("scarf", 15000, { available: 0 }), v("pin", 5000), v("belt", 8000)),
      boughtWith: new Map([["pin", 7], ["belt", 2]]),
    }));
    expect(o).toMatchObject({ variantId: "pin", source: "auto", discountPct: "10", offerPriceMinor: 4500n });
  });

  it("never sells at a loss: a 10% discount on a thin margin is not offered", () => {
    expect(recommend(base({ candidates: cands(v("pin", 5000, { costMinor: 4600n })), popularity: new Map([["pin", 9]]) }))).toBeNull();
  });

  it("nothing in common and nothing popular: no offer rather than a random one", () => {
    expect(recommend(base({ candidates: cands(v("pin", 5000)) }))).toBeNull();
  });

  it("a second order, not an upsell: an item over 60% of the order is never offered", () => {
    expect(recommend(base({ orderTotalMinor: 10000n, candidates: cands(v("coat", 9000)), popularity: new Map([["coat", 30]]) }))).toBeNull();
  });
});
