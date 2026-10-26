import { Inject, Injectable } from "@nestjs/common";
import type { DB } from "@mizan/db";
import type { Selectable } from "kysely";
import { auditActor, AuditService } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { ProblemError } from "../../platform/http/problem.js";
import { ACTIONS, contextOf, FIELDS, parseStep, type ActionName } from "./catalog.js";
import { check, ConditionsSchema, evaluate, fieldsOf, type Rule } from "./conditions.js";
import type { AutomationInput } from "./automations.dto.js";
import { AutomationRuntime, fill } from "./runtime.js";

type Row = Selectable<DB["automations"]>;

/**
 * Automations (M13, E11-1): create, change (each change is a new version; runs keep the version
 * they ran), turn on and off, read the run log, and dry-run against a past event or an order
 * (every rule shown with its actual value, nothing done). Saved definitions are checked against
 * the catalogue: known trigger, fields the trigger's context has, actions it can do, valid params.
 */
@Injectable()
export class AutomationsService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AutomationRuntime) private readonly runtime: AutomationRuntime,
  ) {}

  async list(tenantId: string) {
    return this.db.tenant(tenantId, async (trx) => ({ data: (await trx.selectFrom("automations").selectAll().orderBy("created_at").execute()).map(view) }));
  }

  async get(tenantId: string, id: string) {
    return this.db.tenant(tenantId, async (trx) => {
      const a = await trx.selectFrom("automations").selectAll().where("id", "=", id).executeTakeFirst();
      if (!a) throw notFound();
      const runs = await trx.selectFrom("automation_runs").selectAll().where("automation_id", "=", id).orderBy("created_at", "desc").limit(50).execute();
      return {
        ...view(a),
        runs: runs.map((r) => ({
          id: r.id, at: r.created_at.toISOString(), event: r.event_type, entityId: r.entity_id, status: r.status as "skipped" | "succeeded" | "failed",
          reason: r.reason, version: r.version, depth: r.depth, steps: ((r.log as { steps?: unknown[] } | null)?.steps ?? []) as Array<{ action: string; result: string; detail?: string }>,
        })),
      };
    });
  }

  async create(auth: AuthContext, body: AutomationInput) {
    const tenantId = auth.tenant!.id;
    const steps = validate(body);
    return this.db.tenant(tenantId, async (trx) => {
      const a = await trx.insertInto("automations").values({
        tenant_id: tenantId, name: body.name, description: body.description ?? null, trigger_event: body.trigger, conditions: JSON.stringify(body.conditions),
        actions: JSON.stringify(steps), enabled: body.enabled, created_by: auth.user.id,
      }).returningAll().executeTakeFirstOrThrow();
      await this.audit.record(trx, { action: "automation.created", tenantId, entity: { type: "automation", id: a.id }, after: { name: a.name, trigger: a.trigger_event, enabled: a.enabled }, ...auditActor(auth) });
      return view(a);
    });
  }

  /** A change is a new version; runs already recorded keep theirs. Saving clears an error pause. */
  async update(auth: AuthContext, id: string, body: AutomationInput) {
    const tenantId = auth.tenant!.id;
    const steps = validate(body);
    return this.db.tenant(tenantId, async (trx) => {
      const before = await trx.selectFrom("automations").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
      if (!before) throw notFound();
      const a = await trx.updateTable("automations").set({
        name: body.name, description: body.description ?? null, trigger_event: body.trigger, conditions: JSON.stringify(body.conditions), actions: JSON.stringify(steps),
        enabled: body.enabled, paused_reason: null, version: before.version + 1, updated_at: new Date(),
      }).where("id", "=", id).returningAll().executeTakeFirstOrThrow();
      await this.audit.record(trx, { action: "automation.updated", tenantId, entity: { type: "automation", id }, before: { version: before.version }, after: { version: a.version, trigger: a.trigger_event, enabled: a.enabled }, ...auditActor(auth) });
      return view(a);
    });
  }

  async setEnabled(auth: AuthContext, id: string, enabled: boolean) {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const a = await trx.updateTable("automations").set({ enabled, ...(enabled ? { paused_reason: null } : {}), updated_at: new Date() }).where("id", "=", id).returningAll().executeTakeFirst();
      if (!a) throw notFound();
      await this.audit.record(trx, { action: enabled ? "automation.enabled" : "automation.disabled", tenantId, entity: { type: "automation", id }, ...auditActor(auth) });
      return view(a);
    });
  }

  async remove(auth: AuthContext, id: string) {
    const tenantId = auth.tenant!.id;
    await this.db.tenant(tenantId, async (trx) => {
      const a = await trx.deleteFrom("automations").where("id", "=", id).returning(["id", "name"]).executeTakeFirst();
      if (!a) throw notFound();
      await this.audit.record(trx, { action: "automation.deleted", tenantId, entity: { type: "automation", id }, before: { name: a.name }, ...auditActor(auth) });
    });
  }

  /** What the automation would do for a past event, or for an order as if its trigger happened now. Nothing is done. */
  async dryRun(tenantId: string, id: string, body: { eventId?: string | undefined; orderId?: string | undefined }) {
    return this.db.tenant(tenantId, async (trx) => {
      const a = await trx.selectFrom("automations").selectAll().where("id", "=", id).executeTakeFirst();
      if (!a) throw notFound();
      let event: { type: string; data: Record<string, unknown>; entity: { type: string; id: string } };
      if (body.eventId) {
        const e = await trx.selectFrom("domain_events").select(["type", "data", "entity_type", "entity_id"]).where("id", "=", body.eventId).executeTakeFirst();
        if (!e) throw new ProblemError(404, "not_found", "no such event in this store");
        if (e.type !== a.trigger_event) throw new ProblemError(422, "wrong_trigger", `this automation starts on ${a.trigger_event}, not ${e.type}`);
        event = { type: e.type, data: (e.data ?? {}) as Record<string, unknown>, entity: { type: e.entity_type, id: e.entity_id } };
      } else {
        if (contextOf(a.trigger_event) !== "order") throw new ProblemError(422, "not_an_order_trigger", "try this automation with a past event instead");
        const o = await trx.selectFrom("orders").select("id").where("id", "=", body.orderId!).executeTakeFirst();
        if (!o) throw new ProblemError(404, "not_found", "no such order in this store");
        event = { type: a.trigger_event, data: {}, entity: { type: "order", id: o.id } };
      }
      const ctx = await this.runtime.context(trx, event);
      const conditions = ConditionsSchema.parse(a.conditions);
      const rules = flatten(conditions).map((r) => ({
        field: r.field, op: r.op, value: r.value ?? null, actual: read(ctx, r.field) ?? null, pass: check(r, ctx as unknown as Record<string, unknown>),
      }));
      const matched = evaluate(conditions, ctx as unknown as Record<string, unknown>);
      const steps = ((a.actions as Array<{ action: ActionName; params: Record<string, unknown> }>) ?? []).map((s) => {
        const params = s.action === "notify.team" ? { ...s.params, message: fill(String(s.params.message ?? ""), ctx) } : s.params;
        const note = ACTIONS[s.action]?.needs === "order" && !ctx.order ? "no order in this event: this step would fail" : null;
        return { action: s.action, params, note };
      });
      return { matched, rules, steps };
    });
  }
}

const notFound = () => new ProblemError(404, "not_found", "no such automation in this store");
const read = (ctx: object, path: string) => path.split(".").reduce<unknown>((cur, k) => (cur && typeof cur === "object" ? (cur as Record<string, unknown>)[k] : undefined), ctx);
function flatten(c: unknown): Rule[] {
  const n = c as { field?: string; all?: unknown[]; any?: unknown[] };
  if (n.field) return [n as Rule];
  return [...(n.all ?? []), ...(n.any ?? [])].flatMap(flatten);
}

/** Check a definition against the catalogue; returns its steps with parsed params, or a 422 naming each problem. */
function validate(body: AutomationInput) {
  const problems: Array<{ path: string; code: string; message: string }> = [];
  const ctx = contextOf(body.trigger);
  for (const field of fieldsOf(body.conditions)) {
    const [root, name, ...rest] = field.split(".");
    if (root === "event") continue;
    if (root !== ctx) problems.push({ path: "conditions", code: "field_not_in_context", message: `${field}: ${body.trigger} has no ${root}` });
    else if (!(name! in FIELDS[root as "order" | "item"]) || rest.length) problems.push({ path: "conditions", code: "unknown_field", message: field });
  }
  const steps = body.steps.map((s, i) => {
    const p = parseStep(s);
    if (!p.ok) problems.push({ path: `steps.${i}.params`, code: "invalid_params", message: p.message });
    if (ACTIONS[s.action].needs === "order" && ctx !== "order") problems.push({ path: `steps.${i}.action`, code: "needs_order", message: `${s.action} needs an order; ${body.trigger} has none` });
    return { action: s.action, params: p.ok ? p.params : s.params };
  });
  if (problems.length) throw new ProblemError(422, "automation_invalid", "the automation cannot run as written", problems);
  return steps;
}

function view(a: Row) {
  return {
    id: a.id, name: a.name, description: a.description, trigger: a.trigger_event, conditions: a.conditions,
    steps: (a.actions ?? []) as Array<{ action: string; params: Record<string, unknown> }>,
    enabled: a.enabled, pausedReason: (a.paused_reason as "errors" | null) ?? null, version: a.version,
    stats: { runs: a.runs, failures: a.failures, lastRunAt: a.last_run_at?.toISOString() ?? null }, updatedAt: a.updated_at.toISOString(),
  };
}
