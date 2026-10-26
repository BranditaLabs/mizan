import { describe, expect, it } from "vitest";
import { ConditionsSchema, evaluate, fieldsOf, type Conditions } from "../src/modules/automations/conditions.js";

const ctx = {
  event: { type: "order.scored", data: { score: 72, band: "high", reasons: ["first_order", "high_value"] } },
  order: { number: "#1042", total: 1650, paymentMode: "cod", status: "pending_confirmation", tags: ["VIP", "ramadan"], city: "Nasr City", assigned: false, risk: null },
};
const is = (c: Conditions) => evaluate(ConditionsSchema.parse(c), ctx);

describe("automation conditions (E11-1)", () => {
  it("compares numbers, text (any case) and lists", () => {
    expect(is({ all: [{ field: "order.total", op: "gte", value: 1500 }, { field: "order.paymentMode", op: "eq", value: "COD" }] })).toBe(true);
    expect(is({ all: [{ field: "event.data.score", op: "gt", value: "61" }] })).toBe(true); // numbers typed as text still compare
    expect(is({ all: [{ field: "order.tags", op: "contains", value: "vip" }] })).toBe(true);
    expect(is({ all: [{ field: "order.city", op: "contains", value: "nasr" }] })).toBe(true);
    expect(is({ all: [{ field: "order.status", op: "in", value: ["new", "pending_confirmation"] }] })).toBe(true);
    expect(is({ all: [{ field: "event.data.reasons", op: "in", value: ["refused_before", "high_value"] }] })).toBe(true);
    expect(is({ all: [{ field: "order.paymentMode", op: "not_in", value: ["card", "bnpl"] }] })).toBe(true);
  });

  it("missing and empty values never pass a comparison", () => {
    expect(is({ all: [{ field: "order.risk", op: "gt", value: 10 }] })).toBe(false);
    expect(is({ all: [{ field: "order.nothing", op: "eq", value: "x" }] })).toBe(false);
    expect(is({ all: [{ field: "order.risk", op: "not_exists" }] })).toBe(true);
    expect(is({ all: [{ field: "order.assigned", op: "eq", value: false }] })).toBe(true);
    expect(is({ all: [{ field: "order.total", op: "eq", value: true }] })).toBe(false); // a boolean never equals a number
  });

  it("ALL / ANY, nested one level; empty ALL passes, empty ANY does not", () => {
    const c: Conditions = { all: [{ field: "order.paymentMode", op: "eq", value: "cod" }, { any: [{ field: "order.total", op: "gt", value: 5000 }, { field: "order.tags", op: "contains", value: "vip" }] }] };
    expect(is(c)).toBe(true);
    expect(is({ all: [] })).toBe(true);
    expect(is({ any: [] })).toBe(false);
    expect(fieldsOf(ConditionsSchema.parse(c))).toEqual(["order.paymentMode", "order.total", "order.tags"]);
  });

  it("refuses what it cannot read: unknown roots, deeper nesting", () => {
    expect(ConditionsSchema.safeParse({ all: [{ field: "customer.phone", op: "eq", value: "1" }] }).success).toBe(false);
    expect(ConditionsSchema.safeParse({ all: [{ any: [{ all: [] }] }] }).success).toBe(false);
    expect(ConditionsSchema.safeParse({ all: [{ field: "order.total", op: "between", value: 1 }] }).success).toBe(false);
  });
});
