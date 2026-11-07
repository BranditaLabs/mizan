import { describe, expect, it } from "vitest";
import { COST_FLAGS, deliveredRate, metricByKey, METRICS, perUnitSigned, profitQuality, type MetricFacts } from "../src/modules/reports/metrics.js";
import { isoWeekOf, isoWeekRange, isWeekParam, lastFullWeek } from "../src/modules/reports/week.js";
import { percent } from "../src/modules/profit/home.js";
import { provisionalLine } from "../src/modules/reports/dashboards.service.js";
import { COST_FLAGS as SHARED_COST_FLAGS } from "@mizan/shared";

/** E15-1: the metric layer's definitions, without the database. */
const facts = (over: Partial<MetricFacts> = {}): MetricFacts => ({
  base: "EGP", days: 30, live: 200n, prepaid: 50n, cod: 150n, delivered: 120n, returned: 30n, net: 1_234_550n, netEnded: 1_234_550n, revenue: 9_000_000n, refunds: 500_000n, spend: 3_000_000n,
  totalBase: 24_000_000n, ordersBase: 199n, available: 400n, unitsShipped: 600n, confirmed: 160n, confirmedAuto: 108n, ordersMissingCosts: 0n, productsMissingCost: 0n, ...over,
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

describe("pilot metrics (L1-7)", () => {
  it("profit per completed order is the ended orders' net profit over those orders, half away from zero", () => {
    // 1,234,550 minor ÷ (120 delivered + 30 returned) = 8230.33… → 8230 minor
    expect(value("profit_per_completed_order")).toEqual({ value: "82.30", money: { amount: "82.30", currency: "EGP" }, numerator: "1234550", denominator: "150" });
    expect(value("profit_per_completed_order", facts({ netEnded: -1_000_001n, delivered: 1n, returned: 1n })).money).toEqual({ amount: "-5000.01", currency: "EGP" }); // -500000.5 → -500001
    expect(value("profit_per_completed_order", facts({ netEnded: 5n, delivered: 2n, returned: 0n })).value).toBe("0.03"); // 2.5 → 3
    expect(value("profit_per_completed_order", facts({ delivered: 0n, returned: 0n }))).toMatchObject({ value: null, money: null });
    // Orders still on the road (costs booked, cash not yet in) pull the period's net down, not this metric.
    expect(value("profit_per_completed_order", facts({ net: -22_000_000n }))).toMatchObject({ value: "82.30", numerator: "1234550" });
    expect(value("net_profit", facts({ net: -22_000_000n })).value).toBe("-220000.00");
    expect(perUnitSigned(-5n, 2n)).toBe(-3n);
    expect(perUnitSigned(7n, -2n)).toBe(-4n);
    expect(perUnitSigned(1n, 0n)).toBeNull();
  });

  it("automation share is orders confirmed with nobody involved over confirmed orders", () => {
    expect(value("automation_share")).toEqual({ value: "67.5", numerator: "108", denominator: "160" });
    expect(value("automation_share", facts({ confirmed: 3n, confirmedAuto: 2n })).value).toBe("66.7");
    expect(value("automation_share", facts({ confirmed: 0n, confirmedAuto: 0n })).value).toBeNull();
    expect(metricByKey.get("automation_share")!.roles.has("agent")).toBe(false);
    expect(metricByKey.get("profit_per_completed_order")!.roles.has("agent")).toBe(false);
  });
});

describe("ISO weeks for the weekly export (L1-7)", () => {
  it("names the week a store day is in, Monday to Sunday, the year of its Thursday", () => {
    expect(isoWeekOf("2026-10-19")).toBe("2026-W43"); // Monday
    expect(isoWeekOf("2026-10-25")).toBe("2026-W43"); // Sunday
    expect(isoWeekOf("2026-10-26")).toBe("2026-W44");
    expect(isoWeekOf("2027-01-01")).toBe("2026-W53"); // a Friday: 2026 has 53 weeks
    expect(isoWeekOf("2024-12-30")).toBe("2025-W01"); // a Monday whose Thursday is in 2025
    expect(isoWeekRange("2026-W43")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(isoWeekRange("2025-W01")).toEqual({ from: "2024-12-30", to: "2025-01-05" });
    expect(isoWeekRange("2026-W53")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
  });

  it("refuses weeks that do not exist", () => {
    for (const bad of ["2025-W53", "2026-W00", "2026-W54", "2026-43", "2026W43", "26-W43", "2026-w43", "1999-W10", ""]) expect(isoWeekRange(bad), bad).toBeNull();
    expect(isWeekParam("last")).toBe(true);
    expect(isWeekParam("2026-W43")).toBe(true);
    expect(isWeekParam("2025-W53")).toBe(false);
  });

  it("the last full week is the one before today's", () => {
    expect(lastFullWeek("2026-10-31")).toBe("2026-W43"); // a Saturday in W44
    expect(lastFullWeek("2026-10-26")).toBe("2026-W43"); // a Monday
    expect(lastFullWeek("2026-10-25")).toBe("2026-W42"); // a Sunday: its own week is not over
    expect(lastFullWeek("2027-01-04")).toBe("2026-W53");
  });
});

describe("profit honesty (FX-2)", () => {
  it("final only with every cost in and something delivered", () => {
    expect(profitQuality(facts())).toEqual({ costsComplete: true, delivered: true, provisional: false, ordersMissingCosts: 0, productsMissingCost: 0 });
  });

  it("missing costs make the period provisional and count what to fix", () => {
    expect(profitQuality(facts({ ordersMissingCosts: 14n, productsMissingCost: 12n }))).toEqual({ costsComplete: false, delivered: true, provisional: true, ordersMissingCosts: 14, productsMissingCost: 12 });
  });

  it("nothing delivered is provisional even with every cost in (no 100% margin on a new store)", () => {
    const q = profitQuality(facts({ delivered: 0n }));
    expect(q.provisional).toBe(true);
    expect(q.costsComplete).toBe(true);
    expect(q.delivered).toBe(false);
  });

  it("only the profit metrics are marked; counts and ad spend never are", () => {
    expect(METRICS.filter((m) => m.profit).map((m) => m.key).sort()).toEqual(["net_profit", "profit_per_completed_order"]);
  });

  it("missing inputs, not things on their way", () => {
    expect(COST_FLAGS).toContain("cost_missing");
    expect(COST_FLAGS).not.toContain("estimated" as never);
    expect(COST_FLAGS).not.toContain("awaiting_settlement" as never);
  });

  it("one list for the API and the screens, with both exchange-rate flags", () => {
    expect(COST_FLAGS).toBe(SHARED_COST_FLAGS);
    expect(COST_FLAGS).toContain("fx_missing");
    expect(COST_FLAGS).toContain("ads_fx_missing");
  });
});

describe("the export's provisional line (FX-2): the screen's words", () => {
  const q = (ordersMissingCosts: number, delivered: boolean) => ({ ordersMissingCosts, delivered, provisional: ordersMissingCosts > 0 || !delivered });

  it("nothing when the profit is final", () => {
    expect(provisionalLine(q(0, true), false)).toBeNull();
    expect(provisionalLine(q(0, true), true)).toBeNull();
  });

  it("never \"0 orders miss a cost\": nothing delivered says only that", () => {
    expect(provisionalLine(q(0, false), false)).toBe("Provisional profit: nothing is delivered yet.");
    expect(provisionalLine(q(0, false), true)).toBe("ربح مبدئي: لسه مفيش أوردر اتسلّم.");
  });

  it("English one and other", () => {
    expect(provisionalLine(q(1, true), false)).toBe("Provisional profit: 1 order misses a cost.");
    expect(provisionalLine(q(3, true), false)).toBe("Provisional profit: 3 orders miss a cost.");
    expect(provisionalLine(q(2, false), false)).toBe("Provisional profit: 2 orders miss a cost, and nothing is delivered yet.");
  });

  it("Arabic one, two, few and other", () => {
    expect(provisionalLine(q(1, true), true)).toBe("ربح مبدئي: أوردر واحد ناقصه تكلفة.");
    expect(provisionalLine(q(2, true), true)).toBe("ربح مبدئي: أوردرين ناقصهم تكلفة.");
    expect(provisionalLine(q(5, true), true)).toBe("ربح مبدئي: 5 أوردرات ناقصها تكلفة.");
    expect(provisionalLine(q(14, true), true)).toBe("ربح مبدئي: 14 أوردر ناقصه تكلفة.");
    expect(provisionalLine(q(1, false), true)).toBe("ربح مبدئي: أوردر واحد ناقصه تكلفة، ولسه مفيش أوردر اتسلّم.");
  });
});
