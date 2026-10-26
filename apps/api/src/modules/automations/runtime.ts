import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { fromMinor, type DomainEvent, type EventActor } from "@mizan/shared";
import { EventsService } from "../../platform/events/events.service.js";
import { OrderActions } from "../orders/order-actions.js";
import { ACTIONS, contextOf, ERROR_MIN_RUNS, ERROR_RATE, MAX_DEPTH, parseStep, type ActionName, type Step } from "./catalog.js";
import { ConditionsSchema, evaluate, valueAt } from "./conditions.js";

type Trx = Transaction<DB>;
export type RunContext = { event: { type: string; data: Record<string, unknown> }; order?: Record<string, unknown>; item?: Record<string, unknown> };
export interface StepResult { action: string; result: string; detail?: string }

/** Who acted: the automation (its run is in the event data, which carries the chain depth). */
export const automationActor = (automationId: string): EventActor => ({ type: "system", id: automationId });

/**
 * The automation runtime (M13, E11-1; docs/13 §4). For each event, every enabled automation on
 * that trigger runs once (UNIQUE (automation_id, event_id)): the context is read fresh (the
 * order, or the stock item), the conditions decide, then the steps run in order, each in its own
 * savepoint, with an idempotency reference `automation:<run>:<step>`. A run's own events carry
 * the chain depth; past MAX_DEPTH a chain stops (loop guard). An automation whose recent runs
 * fail too often pauses itself and tells the team (error guard).
 */
@Injectable()
export class AutomationRuntime {
  constructor(
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(OrderActions) private readonly orders: OrderActions,
  ) {}

  async onEvent(trx: Trx, event: DomainEvent): Promise<void> {
    const automations = await trx.selectFrom("automations").selectAll()
      .where("enabled", "=", true).where("trigger_event", "=", event.type).orderBy("created_at").execute();
    if (!automations.length) return;
    const depth = Number((event.data as { automationDepth?: unknown }).automationDepth ?? 0) + 1;
    let ctx: RunContext | null = null;
    for (const a of automations) {
      const run = await trx.insertInto("automation_runs").values({
        tenant_id: event.tenantId, automation_id: a.id, event_id: event.id, status: "skipped", version: a.version, event_type: event.type,
        entity_id: event.entity.id, depth,
      }).onConflict((oc) => oc.columns(["automation_id", "event_id"]).doNothing()).returning("id").executeTakeFirst();
      if (!run) continue; // this event already ran it
      if (depth > MAX_DEPTH) {
        await this.finish(trx, a.id, run.id, "skipped", "loop_guard", []);
        continue;
      }
      ctx ??= await this.context(trx, event);
      const conditions = ConditionsSchema.safeParse(a.conditions);
      if (!conditions.success || !evaluate(conditions.data, ctx)) {
        await this.finish(trx, a.id, run.id, "skipped", conditions.success ? "conditions" : "invalid_conditions", []);
        continue;
      }
      const results: StepResult[] = [];
      let failed: string | null = null;
      const steps = (Array.isArray(a.actions) ? a.actions : []) as Step[];
      for (const [i, step] of steps.entries()) {
        await sql`savepoint automation_step`.execute(trx);
        try {
          const result = await this.step(trx, event, ctx, step, { automation: a.id, automationRun: run.id, automationStep: String(i), automationDepth: String(depth) });
          results.push({ action: step.action, result });
          await sql`release savepoint automation_step`.execute(trx);
        } catch (e) {
          await sql`rollback to savepoint automation_step`.execute(trx);
          failed = e instanceof Error ? e.message.slice(0, 200) : "failed";
          results.push({ action: step.action, result: "failed", detail: failed });
          break; // the next steps may depend on this one
        }
      }
      await this.finish(trx, a.id, run.id, failed ? "failed" : "succeeded", failed, results);
      if (failed) await this.guard(trx, event.tenantId, a.id, a.name, run.id, failed);
    }
  }

  /** The run's context: the event, and the order or stock item it is about (no personal data). */
  async context(trx: Trx, event: { type: string; data: Record<string, unknown>; entity: { type: string; id: string } }): Promise<RunContext> {
    const ctx: RunContext = { event: { type: event.type, data: event.data } };
    const kind = contextOf(event.type);
    if (kind === "order") {
      const orderId = event.entity.type === "order" ? event.entity.id : typeof event.data.orderId === "string" ? event.data.orderId : null;
      if (orderId) ctx.order = await this.order(trx, orderId);
    }
    if (kind === "item" && event.entity.type === "variant") {
      const v = await trx.selectFrom("variants as v").leftJoin("stock_levels as s", "s.variant_id", "v.id")
        .select(["v.sku", "s.on_hand", "s.reserved", "s.low_stock_at"]).where("v.id", "=", event.entity.id).executeTakeFirst();
      if (v) ctx.item = { sku: v.sku, onHand: v.on_hand, reserved: v.reserved, available: v.on_hand === null ? null : v.on_hand - v.reserved!, lowStockAt: v.low_stock_at };
    }
    return ctx;
  }

  async order(trx: Trx, orderId: string): Promise<Record<string, unknown> | undefined> {
    const o = await trx.selectFrom("orders as o").leftJoin("connections as c", "c.id", "o.connection_id")
      .select(["o.id", "o.number", "o.status", "o.channel", "o.payment_mode", "o.payment_status", "o.total_minor", "o.cod_minor", "o.currency", "o.risk_score",
        "o.tags", "o.ship_city", "o.ship_province", "o.ship_country", "o.assigned_to", "o.duplicate_status", "o.stock_status", "c.external_account"])
      .where("o.id", "=", orderId).executeTakeFirst();
    if (!o) return undefined;
    const lines = await trx.selectFrom("order_lines").select(sql<string>`coalesce(sum(quantity), 0)`.as("n")).where("order_id", "=", orderId).executeTakeFirstOrThrow();
    return {
      id: o.id, number: o.number, status: o.status, channel: o.channel, paymentMode: o.payment_mode, paymentStatus: o.payment_status,
      total: Number(fromMinor(BigInt(o.total_minor), o.currency).amount), cod: Number(fromMinor(BigInt(o.cod_minor), o.currency).amount), currency: o.currency,
      risk: o.risk_score, tags: o.tags, city: o.ship_city, province: o.ship_province, country: o.ship_country, assigned: o.assigned_to !== null,
      duplicate: o.duplicate_status, stock: o.stock_status, lines: Number(lines.n), store: o.external_account,
    };
  }

  private async step(trx: Trx, event: DomainEvent, ctx: RunContext, step: Step, ref: Record<string, string>): Promise<string> {
    const parsed = parseStep(step);
    if (!parsed.ok) throw new Error(`invalid params: ${parsed.message}`);
    const p = parsed.params;
    const actor = automationActor(ref.automation!);
    const needs = ACTIONS[step.action as ActionName].needs;
    const orderId = ctx.order?.id as string | undefined;
    if (needs === "order" && !orderId) throw new Error("no order in this event");
    switch (step.action) {
      case "order.add_tag": return this.orders.tag(trx, event.tenantId, orderId!, p.tags as string[], actor, ref);
      case "order.assign": {
        const userId = p.userId as string | null;
        if (userId) {
          const member = await trx.selectFrom("memberships").select("user_id").where("user_id", "=", userId).where("status", "=", "active").executeTakeFirst();
          if (!member) throw new Error("the person to assign is not an active member");
        }
        return this.orders.assign(trx, event.tenantId, orderId!, userId, actor, ref);
      }
      case "notify.team": {
        const text = fill(p.message as string, ctx).slice(0, 400);
        const entity = ctx.order ? { type: "order", id: orderId! } : ctx.item ? { type: "variant", id: event.entity.id } : null;
        const r = await trx.insertInto("notifications").values({
          tenant_id: event.tenantId, roles: p.roles as string[], text, entity_type: entity?.type ?? null, entity_id: entity?.id ?? null,
          source: `automation:${ref.automation}`, dedupe_key: `automation:${ref.automationRun}:${ref.automationStep}`,
        }).onConflict((oc) => oc.columns(["tenant_id", "dedupe_key"]).where("dedupe_key", "is not", null).doNothing()).returning("id").executeTakeFirst();
        return r ? "done" : "unchanged";
      }
    }
  }

  private async finish(trx: Trx, automationId: string, runId: string, status: "skipped" | "succeeded" | "failed", reason: string | null, steps: StepResult[]) {
    await trx.updateTable("automation_runs").set({ status, reason, log: JSON.stringify({ steps }) }).where("id", "=", runId).execute();
    if (status !== "skipped") {
      await trx.updateTable("automations").set((eb) => ({
        runs: eb("runs", "+", 1), failures: eb("failures", "+", status === "failed" ? 1 : 0), last_run_at: new Date(),
      })).where("id", "=", automationId).execute();
    }
  }

  /** Error guard: over ERROR_RATE of the last 20 real runs failed (at least ERROR_MIN_RUNS) → pause and tell the team. */
  private async guard(trx: Trx, tenantId: string, automationId: string, name: string, runId: string, error: string) {
    await this.events.emit(trx, { type: "automation.run_failed", tenantId, entity: { type: "automation", id: automationId }, actor: { type: "system" }, data: { runId, error } });
    const recent = await trx.selectFrom("automation_runs").select("status").where("automation_id", "=", automationId)
      .where("status", "!=", "skipped").orderBy("created_at", "desc").limit(20).execute();
    const failures = recent.filter((r) => r.status === "failed").length;
    if (recent.length < ERROR_MIN_RUNS || failures / recent.length <= ERROR_RATE) return;
    await trx.updateTable("automations").set({ enabled: false, paused_reason: "errors", updated_at: new Date() }).where("id", "=", automationId).execute();
    await this.events.emit(trx, { type: "automation.paused", tenantId, entity: { type: "automation", id: automationId }, actor: { type: "system" }, data: { failures, runs: recent.length } });
    await trx.insertInto("notifications").values({
      tenant_id: tenantId, roles: ["owner", "admin", "ops_manager"], text: name.slice(0, 400), entity_type: "automation", entity_id: automationId,
      source: "automation.paused", dedupe_key: `automation.paused:${runId}`,
    }).onConflict((oc) => oc.columns(["tenant_id", "dedupe_key"]).where("dedupe_key", "is not", null).doNothing()).execute();
  }
}

/** "Order {{order.number}} is waiting" → "Order #1042 is waiting"; unknown fields become "". */
export function fill(template: string, ctx: RunContext): string {
  return template.replace(/\{\{\s*((?:event|order|item)\.[A-Za-z0-9_.]{1,80})\s*\}\}/g, (_m, path: string) => {
    const v = valueAt(ctx as unknown as Record<string, unknown>, path);
    return v === undefined || v === null ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? "" : String(v);
  });
}
