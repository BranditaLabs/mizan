import { describe, expect, it } from "vitest";
import { deliveredRate, metricByKey, METRICS, type MetricFacts } from "../src/modules/reports/metrics.js";
import { percent } from "../src/modules/profit/home.js";

/** E15-1: the metric layer's definitions, without the database. */
const facts = (over: Partial<MetricFacts> = {}): MetricFacts => ({
  base: "EGP", days: 30, live: 200n, prepaid: 50n, cod: 150n, delivered: 120n, returned: 30n, net: 1_234_550n, revenue: 9_000_000n, refunds: 500_000n, spend: 3_000_000n,
  totalBase: 24_000_000n, ordersBase: 199n, available: 400n, unitsShipped: 600n, ...over,
});
const value = (key: string, f = facts()) => metricByKey.get(key)!.compute(f);

describe("ad metrics (M7-1)", () => {
  it("true ROAS is real money less refunds over spend; cost per delivered order is spend over delivered", () => {
    expect(value("true_roas")).toEqual({ value: "2.83", numerator: "8500000", denominator: "3000000" });
    expect(value("cost_per_delivered_order")).toMatchObject({ value: "250.00", money: { amount: "250.00", currency: "EGP" } });
    expect(value("ad_spend")).toMatchObject({ value: "30000.00" });
    expect(value("true_roas", facts({ spend: 0n })).value).toBeNull();
    expect(value("cost_per_delivered_order", facts({ delivered: 0n })).value).toBeNull();
  });
});

describe("metric layer (E15-1)", () => {
  it("each metric is defined once, versioned, in Arabic and English, for at least the owner", () => {
    expect(new Set(METRICS.map((m) => m.key)).size).toBe(METRICS.length);
    for (const m of METRICS) {
      expect(m.version).toBeGreaterThanOrEqual(1);
      expect(m.name.en && m.definition.en).toBeTruthy();
      expect(m.name.ar).toMatch(/[؀-ۿ]/);
      expect(m.definition.ar).toMatch(/[؀-ۿ]/);
      expect(m.roles.has("owner")).toBe(true);
    }
    expect(metricByKey.get("net_profit")!.roles.has("agent")).toBe(false);
    expect(metricByKey.get("days_of_cover")!.roles.has("warehouse")).toBe(true);
  });

  it("computes from the facts, exactly", () => {
    expect(value("orders")).toEqual({ value: "200" });
    expect(value("delivered_rate")).toEqual({ value: "80.0", numerator: "120", denominator: "150" });
    expect(value("rto_rate")).toEqual({ value: "20.0", numerator: "30", denominator: "150" });
    expect(value("prepaid_share").value).toBe("25.0");
    expect(value("cod_share").value).toBe("75.0");
    expect(value("net_profit")).toMatchObject({ value: "12345.50", money: { amount: "12345.50", currency: "EGP" } });
    expect(value("average_order_value").money).toEqual({ amount: "1206.03", currency: "EGP" }); // 24,000,000 ÷ 199 minor, rounded half up
    expect(value("days_of_cover").value).toBe("20.0"); // 400 available ÷ (600 ÷ 30 a day)
  });

  it("says nothing rather than a wrong zero when there is nothing to divide by", () => {
    const none = facts({ live: 0n, prepaid: 0n, cod: 0n, delivered: 0n, returned: 0n, ordersBase: 0n, unitsShipped: 0n });
    for (const k of ["delivered_rate", "rto_rate", "prepaid_share", "cod_share", "average_order_value", "days_of_cover"]) expect(value(k, none).value).toBeNull();
    expect(value("orders", none).value).toBe("0");
  });

  it("delivered and RTO rates add up to 100 within rounding when anything ended, and match the home's formula", () => {
    for (let d = 0n; d < 40n; d += 3n) for (let r = 0n; r < 40n; r += 7n) {
      const f = facts({ delivered: d, returned: r });
      expect(deliveredRate(d, r)).toBe(percent(d, d + r));
      // Each is rounded to one decimal on its own, so together they are 100 ± 0.1.
      if (d + r > 0n) expect(Math.abs(Math.round((Number(value("delivered_rate", f).value) + Number(value("rto_rate", f).value)) * 10) - 1000)).toBeLessThanOrEqual(1);
    }
  });
});
