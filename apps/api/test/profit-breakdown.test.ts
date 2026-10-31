import { describe, expect, it } from "vitest";
import { aggregate, allocate, netOf, splitByLines, zeroComps, COMPONENTS, type Components, type OrderFact } from "../src/modules/profit/breakdown.js";

/** E9-5: an order's profit split over its products adds up exactly, and groups sum to the total. */
const comps = (over: Partial<Components>): Components => ({ ...zeroComps(), ...over });
const order = (id: string, over: Partial<Components>, status: Partial<OrderFact> = {}): OrderFact => ({ orderId: id, delivered: true, returned: false, comps: comps(over), ...status });

describe("profit breakdown", () => {
  it("allocate: proportional, exact, remainders by largest fraction; negatives mirror; zero weights split evenly", () => {
    expect(allocate(100n, [1n, 1n, 1n])).toEqual([34n, 33n, 33n]);
    expect(allocate(1000n, [250n, 750n])).toEqual([250n, 750n]);
    expect(allocate(-101n, [1n, 1n])).toEqual([-51n, -50n]);
    expect(allocate(7n, [0n, 0n])).toEqual([4n, 3n]);
    expect(allocate(10n, [0n, 5n])).toEqual([0n, 10n]);
    expect(allocate(0n, [3n, 4n])).toEqual([0n, 0n]);
  });

  it("an order split over two products: product cost by line cost, the rest by line value", () => {
    // Abaya 1,000 (cost 400) + scarf 250 (cost 100); delivered; shipping 50, COD fee 10, ads 30.
    const o = order("o1", { revenue: 125000n, cogs: 50000n, shipping: 5000n, cod_fee: 1000n, ads: 3000n, expected_net: 66000n });
    const [abaya, scarf] = splitByLines(o, [
      { key: "v-abaya", label: "Abaya", valueMinor: 100000n, costMinor: 40000n },
      { key: "v-scarf", label: "Scarf", valueMinor: 25000n, costMinor: 10000n },
    ], { key: "no_products", label: "no_products" });
    expect(abaya!.comps).toMatchObject({ revenue: 100000n, cogs: 40000n, shipping: 4000n, cod_fee: 800n, ads: 2400n });
    expect(scarf!.comps).toMatchObject({ revenue: 25000n, cogs: 10000n, shipping: 1000n, cod_fee: 200n, ads: 600n });
    expect(netOf(abaya!.comps) + netOf(scarf!.comps)).toBe(netOf(o.comps));
  });

  it("groups by product: an order counts once per product, totals equal the orders' totals", () => {
    const a = order("o1", { revenue: 100000n, cogs: 40000n, shipping: 5000n });
    const b = order("o2", { cogs: 40000n, shipping: 5000n, rto: 5000n }, { delivered: false, returned: true });
    const line = { key: "v-abaya", label: "Abaya", valueMinor: 100000n, costMinor: 40000n };
    const slices = [...splitByLines(a, [line], { key: "x", label: "x" }), ...splitByLines(b, [line], { key: "x", label: "x" }), ...splitByLines(order("o3", { ads: 2000n }), [], { key: "no_products", label: "no_products" })];
    const { rows, total } = aggregate(slices, "product");
    // Abaya: delivered 1,000 − 400 − 50 = 550; refused −400 − 50 − 50 = −500 → 50. No products: −20 of ads.
    expect(rows.map((r) => [r.key, r.orders, r.delivered, r.returned, r.net])).toEqual([["v-abaya", 2, 1, 1, 5000n], ["no_products", 1, 1, 0, -2000n]]);
    expect(total).toMatchObject({ orders: 3, revenue: 100000n, productCost: 80000n, shippingAndCod: 10000n, returns: 5000n, ads: 2000n, net: 3000n });
    expect(rows.find((r) => r.key === "v-abaya")!.margin).toBe("5.0");
  });

  it("by day: date order; otherwise biggest profit first", () => {
    const s = (key: string, revenue: bigint) => ({ key, label: key, orderId: key, delivered: true, returned: false, comps: comps({ revenue }) });
    expect(aggregate([s("2026-10-02", 5n), s("2026-10-01", 9n)], "day").rows.map((r) => r.key)).toEqual(["2026-10-01", "2026-10-02"]);
    expect(aggregate([s("EG", 5n), s("SA", 9n)], "country").rows.map((r) => r.key)).toEqual(["SA", "EG"]);
  });

  it("over 1,000 generated orders with up to 5 lines: every split adds back to its order, to the minor unit", () => {
    let seed = 3;
    const r = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const big = (n: number) => BigInt(Math.floor(r() * n));
    for (let i = 0; i < 1000; i++) {
      const o = order(`o${i}`, Object.fromEntries(COMPONENTS.map((c) => [c, big(200000) - (c === "expected_net" ? 100000n : 0n)])) as Partial<Components>);
      const lines = Array.from({ length: Math.floor(r() * 5) + 1 }, (_, j) => ({ key: `v${j}`, label: `v${j}`, valueMinor: big(50000), costMinor: big(20000) }));
      const parts = splitByLines(o, lines, { key: "x", label: "x" });
      for (const c of COMPONENTS) expect(parts.reduce((a, p) => a + p.comps[c], 0n)).toBe(o.comps[c]);
    }
  });
});
