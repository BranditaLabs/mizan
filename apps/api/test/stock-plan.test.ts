import { describe, expect, it } from "vitest";
import { planOrder, type PlanInput } from "../src/modules/stock/plan.js";

const m = (o: Record<string, number> = {}) => new Map(Object.entries(o));
const plan = (p: Partial<PlanInput>) => planOrder({ status: "confirmed", lines: m(), available: m(), held: m(), picked: m(), ...p });
const plain = (p: ReturnType<typeof planOrder>) => ({ release: Object.fromEntries(p.release), reserve: Object.fromEntries(p.reserve), pick: Object.fromEntries(p.pick), short: p.short, status: p.status });

describe("what an order holds (E8-2)", () => {
  it("a confirmed order reserves its counted items; uncounted ones stay the store's", () => {
    expect(plain(plan({ lines: m({ a: 2, b: 1 }), available: m({ a: 5 }) }))).toEqual({ release: {}, reserve: { a: 2 }, pick: {}, short: [], status: "reserved" });
    expect(plan({ lines: m({ b: 1 }) }).status).toBe("untracked");
  });

  it("repeats change nothing; a bigger order reserves only the difference", () => {
    expect(plain(plan({ lines: m({ a: 2 }), available: m({ a: 0 }), held: m({ a: 2 }) }))).toEqual({ release: {}, reserve: {}, pick: {}, short: [], status: "reserved" });
    expect(plan({ lines: m({ a: 3 }), available: m({ a: 1 }), held: m({ a: 2 }) }).reserve).toEqual(m({ a: 1 }));
  });

  it("oversell is blocked: nothing new is held when any item is short, and what was held stays", () => {
    const p = plan({ lines: m({ a: 2, b: 5 }), available: m({ a: 10, b: 4 }) });
    expect(plain(p)).toEqual({ release: {}, reserve: {}, pick: {}, short: ["b"], status: "short" });
    const grown = plan({ lines: m({ a: 2, b: 1 }), available: m({ a: 10, b: 0 }), held: m({ a: 2 }) });
    expect(plain(grown)).toMatchObject({ release: {}, reserve: {}, short: ["b"], status: "short" });
  });

  it("cancelled or back to waiting: everything held is released", () => {
    expect(plain(plan({ status: "cancelled", lines: m({ a: 2 }), available: m({ a: 0 }), held: m({ a: 2 }) }))).toEqual({ release: { a: 2 }, reserve: {}, pick: {}, short: [], status: null });
    expect(plan({ status: "pending_confirmation", lines: m({ a: 1 }), available: m({ a: 3 }) }).reserve.size).toBe(0);
  });

  it("an item removed from the order, or no longer counted, is released", () => {
    expect(plan({ lines: m({ a: 1 }), available: m({ a: 0, b: 0 }), held: m({ a: 1, b: 3 }) }).release).toEqual(m({ b: 3 }));
  });

  it("shipped: the hold is released and the items leave on hand, once", () => {
    expect(plain(plan({ status: "shipped", lines: m({ a: 2, c: 1 }), available: m({ a: 0 }), held: m({ a: 2 }) }))).toEqual({ release: { a: 2 }, reserve: {}, pick: { a: 2 }, short: [], status: null });
    expect(plain(plan({ status: "delivered", lines: m({ a: 2 }), available: m({ a: 0 }), picked: m({ a: 2 }) }))).toMatchObject({ release: {}, pick: {} });
    // Shipped without ever being held (counted after confirmation, or shipped by the store): still leaves on hand.
    expect(plan({ status: "shipped", lines: m({ a: 1 }), available: m({ a: 4 }) }).pick).toEqual(m({ a: 1 }));
  });
});
