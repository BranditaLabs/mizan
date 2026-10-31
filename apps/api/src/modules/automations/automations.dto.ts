import { z } from "zod";
import { StepSchema, TRIGGER_NAMES } from "./catalog.js";
import { ConditionsSchema, OPERATORS } from "./conditions.js";

export const AutomationInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  trigger: z.string().refine((t) => TRIGGER_NAMES.has(t), "not a trigger in GET /v1/catalog").describe("An event from GET /v1/catalog, e.g. order.scored"),
  conditions: ConditionsSchema.default({ all: [] }).describe("ALL of / ANY of rules { field, op, value }, nested one level"),
  steps: z.array(StepSchema).min(1).max(10).describe("Actions run in order; one failing stops the rest"),
  enabled: z.boolean().default(false),
});
export type AutomationInput = z.infer<typeof AutomationInputSchema>;

export const AutomationPatchSchema = z.strictObject({ enabled: z.boolean() });

const StatsSchema = z.object({ runs: z.number().int(), failures: z.number().int(), lastRunAt: z.iso.datetime().nullable() });
const ConditionsOut = z.unknown().describe("As saved (see AutomationInput.conditions)");

export const AutomationSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  recipe: z.string().nullable().describe("The built-in recipe it was installed from"),
  trigger: z.string(),
  conditions: ConditionsOut,
  steps: z.array(z.object({ action: z.string(), params: z.record(z.string(), z.unknown()) })),
  enabled: z.boolean(),
  pausedReason: z.enum(["errors"]).nullable().describe("errors: too many recent runs failed; fix and turn it on again"),
  version: z.number().int(),
  stats: StatsSchema,
  updatedAt: z.iso.datetime(),
});

export const AutomationListSchema = z.object({ data: z.array(AutomationSchema) });

export const AutomationRunSchema = z.object({
  id: z.uuid(),
  at: z.iso.datetime(),
  event: z.string(),
  entityId: z.uuid().nullable(),
  status: z.enum(["skipped", "succeeded", "failed"]),
  reason: z.string().nullable().describe("skipped: conditions, loop_guard, invalid_conditions; failed: the step's error"),
  version: z.number().int(),
  depth: z.number().int(),
  steps: z.array(z.object({ action: z.string(), result: z.string(), detail: z.string().optional() })),
});
export const AutomationDetailSchema = AutomationSchema.extend({ runs: z.array(AutomationRunSchema).describe("The last 50 runs, newest first") });

export const DryRunSchema = z.strictObject({
  eventId: z.uuid().optional().describe("A past event of this trigger"),
  orderId: z.uuid().optional().describe("Or an order: the trigger's event is imagined for it"),
}).refine((b) => Boolean(b.eventId) !== Boolean(b.orderId), { message: "give eventId or orderId" });

export const DryRunResultSchema = z.object({
  matched: z.boolean().describe("The conditions pass"),
  rules: z.array(z.object({ field: z.string(), op: z.enum(OPERATORS), value: z.unknown(), actual: z.unknown(), pass: z.boolean() })),
  steps: z.array(z.object({ action: z.string(), params: z.record(z.string(), z.unknown()), note: z.string().nullable() })).describe("What would run; nothing is done"),
});

export const CatalogSchema = z.object({
  triggers: z.array(z.object({ event: z.string(), context: z.enum(["order", "item", "none"]) })),
  fields: z.object({
    event: z.array(z.object({ field: z.string(), type: z.string() })),
    order: z.array(z.object({ field: z.string(), type: z.string() })),
    item: z.array(z.object({ field: z.string(), type: z.string() })),
  }),
  operators: z.array(z.string()),
  actions: z.array(z.object({ action: z.string(), needs: z.enum(["order", "none"]), params: z.unknown() })),
  guards: z.object({ maxDepth: z.number().int(), errorPause: z.object({ minRuns: z.number().int(), rate: z.number() }) }),
});

export const NotificationListSchema = z.object({
  data: z.array(z.object({
    id: z.uuid(), at: z.iso.datetime(), text: z.string(), source: z.string(),
    entity: z.object({ type: z.string(), id: z.uuid() }).nullable(), read: z.boolean(),
  })),
  unread: z.number().int(),
});
export const NotificationsQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) });
export const MarkReadSchema = z.strictObject({ ids: z.array(z.uuid()).min(1).max(100).optional(), all: z.literal(true).optional() })
  .refine((b) => Boolean(b.ids) !== Boolean(b.all), { message: "give ids or all" });
export const MarkedSchema = z.object({ marked: z.number().int() });

export const RecipeListSchema = z.object({
  data: z.array(z.object({
    key: z.string(), domain: z.enum(["orders", "verification", "fulfilment", "platform"]), name: z.string(), trigger: z.string(),
    conditions: z.unknown(), steps: z.array(z.object({ action: z.string(), params: z.record(z.string(), z.unknown()) })),
    installed: z.uuid().nullable().describe("The store's copy, if installed"),
  })),
});
export const RecipeQuerySchema = z.object({ lang: z.enum(["ar", "en"]).default("ar") });
export const InstallRecipeSchema = z.strictObject({ language: z.enum(["ar", "en"]).optional().describe("Messages in this language (default: the store's)") });
