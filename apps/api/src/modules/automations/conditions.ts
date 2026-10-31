import { z } from "zod";

/**
 * Automation conditions (M13, E11-1): "If" as data. A rule compares one field of the run's
 * context ("order.total", "event.data.score") with a value; a group is ALL of / ANY of rules,
 * nested one level (docs/modules/M13). Pure: the runtime builds the context, this decides.
 */
export const OPERATORS = ["eq", "ne", "gt", "gte", "lt", "lte", "in", "not_in", "contains", "exists", "not_exists"] as const;
export type Operator = (typeof OPERATORS)[number];

const Scalar = z.union([z.string().max(200), z.number(), z.boolean()]);
export const RuleSchema = z.strictObject({
  field: z.string().regex(/^(event|order|item)\.[A-Za-z0-9_.]{1,80}$/, "a field like order.total or event.data.score"),
  op: z.enum(OPERATORS),
  value: z.union([Scalar, z.array(Scalar).max(50)]).optional(),
});
export type Rule = z.infer<typeof RuleSchema>;

const Group1 = z.strictObject({ all: z.array(RuleSchema).max(20) }).or(z.strictObject({ any: z.array(RuleSchema).max(20) }));
export const ConditionsSchema = z.strictObject({ all: z.array(z.union([RuleSchema, Group1])).max(20) })
  .or(z.strictObject({ any: z.array(z.union([RuleSchema, Group1])).max(20) }));
export type Conditions = z.infer<typeof ConditionsSchema>;
type Node = Rule | { all: Node[] } | { any: Node[] };

export const NO_CONDITIONS: Conditions = { all: [] };

/** A field's value in the context ("order.tags" → ["vip"]), or undefined. */
export function valueAt(ctx: Record<string, unknown>, path: string): unknown {
  let cur: unknown = ctx;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : NaN);
const same = (a: unknown, b: unknown) => (typeof a === "string" && typeof b === "string" ? a.toLowerCase() === b.toLowerCase() : !Number.isNaN(num(a)) && !Number.isNaN(num(b)) && typeof a !== "boolean" && typeof b !== "boolean" ? num(a) === num(b) : a === b);

export function check(rule: Rule, ctx: Record<string, unknown>): boolean {
  const v = valueAt(ctx, rule.field);
  const want = rule.value;
  switch (rule.op) {
    case "exists": return v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0);
    case "not_exists": return !check({ ...rule, op: "exists" }, ctx);
    case "eq": return Array.isArray(v) ? false : same(v, want);
    case "ne": return !check({ ...rule, op: "eq" }, ctx);
    case "gt": case "gte": case "lt": case "lte": {
      const a = num(v), b = num(want);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      return rule.op === "gt" ? a > b : rule.op === "gte" ? a >= b : rule.op === "lt" ? a < b : a <= b;
    }
    case "in": return Array.isArray(want) && want.some((w) => (Array.isArray(v) ? v.some((x) => same(x, w)) : same(v, w)));
    case "not_in": return !check({ ...rule, op: "in" }, ctx);
    case "contains":
      if (Array.isArray(v)) return v.some((x) => same(x, want));
      return typeof v === "string" && typeof want === "string" && v.toLowerCase().includes(want.toLowerCase());
  }
}

/** Does the context pass? An empty ALL passes; an empty ANY does not. */
export function evaluate(conditions: Conditions, ctx: Record<string, unknown>): boolean {
  const run = (n: Node): boolean => ("field" in n ? check(n, ctx) : "all" in n ? n.all.every(run) : n.any.some(run));
  return run(conditions as Node);
}

/** Every field a condition reads (the runtime loads only what is needed). */
export function fieldsOf(conditions: Conditions): string[] {
  const out: string[] = [];
  const walk = (n: Node) => ("field" in n ? out.push(n.field) : ("all" in n ? n.all : n.any).forEach(walk));
  walk(conditions as Node);
  return out;
}
