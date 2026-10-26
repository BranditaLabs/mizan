import { DOMAIN_EVENT_TYPES, MEMBER_ROLES, type DomainEventType } from "@mizan/shared";
import { z } from "zod";
import { OPERATORS } from "./conditions.js";

/**
 * The automation catalogue (M13, E11-3): one registry in code for what can start an automation
 * (triggers), what it can test (fields, operators) and what it can do (actions). The API serves
 * it at GET /v1/catalog and validates every automation against it; docs/13 lists the same names.
 */

/** What a run's context holds besides the event itself. */
export type ContextEntity = "order" | "item" | "none";

/** Events used for the platform's own plumbing: never a trigger. */
const INTERNAL: ReadonlySet<DomainEventType> = new Set(["orders.bulk_continue", "stock.changed", "pnl.recomputed"]);

/** The entity an event's context loads: the order (orders, confirmation, offers, payments), the stock item, or nothing. */
export function contextOf(type: string): ContextEntity {
  if (/^(order|offer|confirmation|payment|refund|dispute)\./.test(type)) return "order";
  if (/^stock\./.test(type)) return "item";
  return "none";
}

export const TRIGGERS = DOMAIN_EVENT_TYPES.filter((t) => !INTERNAL.has(t)).map((event) => ({ event, context: contextOf(event) }));
export const TRIGGER_NAMES: ReadonlySet<string> = new Set(TRIGGERS.map((t) => t.event));

type FieldType = "text" | "number" | "boolean" | "list";
/** Fields a condition can read. Never personal data: no names, phones or addresses (the city and country are areas). */
export const FIELDS: Record<"order" | "item", Record<string, FieldType>> = {
  order: {
    number: "text", status: "text", channel: "text", paymentMode: "text", paymentStatus: "text", total: "number", cod: "number", currency: "text",
    risk: "number", tags: "list", city: "text", province: "text", country: "text", assigned: "boolean", duplicate: "text", stock: "text", lines: "number", store: "text",
  },
  item: { sku: "text", onHand: "number", reserved: "number", available: "number", lowStockAt: "number" },
};

const Tag = z.string().trim().toLowerCase().regex(/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,39}$/u);
/** What each action does and the parameters it takes. Actions touching an order need an order in the context. */
export const ACTIONS = {
  "order.add_tag": { needs: "order", params: z.strictObject({ tags: z.array(Tag).min(1).max(5) }) },
  "order.assign": { needs: "order", params: z.strictObject({ userId: z.uuid().nullable().describe("null: unassign") }) },
  "notify.team": {
    needs: "none",
    params: z.strictObject({
      message: z.string().trim().min(1).max(300).describe("Shown to the team; {{order.number}}, {{item.sku}}, {{event.data.…}} are filled in"),
      roles: z.array(z.enum(MEMBER_ROLES)).min(1).max(7).default(["owner", "admin", "ops_manager"]),
    }),
  },
} as const;
export type ActionName = keyof typeof ACTIONS;
export const ACTION_NAMES = Object.keys(ACTIONS) as ActionName[];

export const StepSchema = z.strictObject({ action: z.enum(ACTION_NAMES as [ActionName, ...ActionName[]]), params: z.record(z.string(), z.unknown()).default({}) });
export type Step = z.infer<typeof StepSchema>;

/** Validate a step's params against its action; returns the parsed params or the problems. */
export function parseStep(step: Step): { ok: true; params: Record<string, unknown> } | { ok: false; message: string } {
  const r = ACTIONS[step.action].params.safeParse(step.params);
  return r.success ? { ok: true, params: r.data as Record<string, unknown> } : { ok: false, message: r.error.issues.map((i) => `${i.path.join(".") || "params"}: ${i.message}`).join("; ") };
}

/** GET /v1/catalog: what the builder offers (labels are translated by the apps). */
export function catalog() {
  return {
    triggers: TRIGGERS,
    fields: {
      event: [{ field: "event.data.*", type: "any" as const }],
      order: Object.entries(FIELDS.order).map(([k, type]) => ({ field: `order.${k}`, type })),
      item: Object.entries(FIELDS.item).map(([k, type]) => ({ field: `item.${k}`, type })),
    },
    operators: [...OPERATORS],
    actions: ACTION_NAMES.map((name) => ({ action: name, needs: ACTIONS[name].needs, params: z.toJSONSchema(ACTIONS[name].params, { io: "input" }) })),
    guards: { maxDepth: MAX_DEPTH, errorPause: { minRuns: ERROR_MIN_RUNS, rate: ERROR_RATE } },
  };
}

/** Loop guard: an automation's own events may start at most this many automations in a chain. */
export const MAX_DEPTH = 3;
/** Error guard: over this share of failed runs among the last runs (at least this many), the automation pauses. */
export const ERROR_RATE = 0.2;
export const ERROR_MIN_RUNS = 5;
