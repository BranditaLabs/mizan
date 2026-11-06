import { Inject, Injectable } from "@nestjs/common";
import { sql, type Selectable, type Transaction } from "kysely";
import type { DB, Subscriptions } from "@mizan/db";
import type { EventActor } from "@mizan/shared";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import type { Plan } from "./plans.js";
import { entitlementPlan, nextStatus, TransitionError, type SubscriptionEvent, type SubscriptionStatus } from "./state.js";

type Trx = Transaction<DB>;
export type SubscriptionRow = Selectable<Subscriptions>;
export type BillingInterval = "month" | "year";

/** Who changed a subscription: a member, Mizan staff (their staff id), or the platform itself. */
export interface SubscriptionActor { type: "user" | "mizan_staff" | "system"; id?: string }

export interface BillingSettings {
  trialDays: number;
  endOfTrial: "downgrade_free";
  existingStorePolicy: "trial" | "free";
}

interface Change {
  actor: SubscriptionActor;
  reason?: string;
  /** Refuse with 409 version_conflict unless the row is still at this version (the scheduler, the admin form). */
  expectedVersion?: number;
  plan?: Plan;
  interval?: BillingInterval;
  compPercent?: number;
  /** Facts for the history line and the domain event (ids and business facts only). */
  data?: Record<string, unknown>;
}

const statusOf = (r: SubscriptionRow) => r.status as SubscriptionStatus;
const planOf = (r: SubscriptionRow) => r.plan_code as Plan;
const eventActor = (a: SubscriptionActor): EventActor => (a.type === "user" ? { type: "user", ...(a.id ? { id: a.id } : {}) } : { type: "system" });

/**
 * Subscriptions (E12-2a1, docs/16 §7.3). Every change runs through `open` (a store's first
 * subscription, or the Free one after a trial) or `transition` (the table in state.ts), inside the
 * caller's tenant transaction: the row is locked and version-checked, a subscription_events line is
 * appended, and tenants.plan follows the plan the subscription entitles. This is the only writer of
 * tenants.plan (a trigger refuses any other: migration 0076).
 */
@Injectable()
export class SubscriptionService {
  constructor(@Inject(EventsService) private readonly events: EventsService) {}

  /** The platform's billing settings (one row, changed by staff). */
  async settings(trx: Trx): Promise<BillingSettings> {
    const s = await trx.selectFrom("billing_settings").select(["trial_days", "end_of_trial", "existing_store_policy"]).executeTakeFirstOrThrow();
    return { trialDays: s.trial_days, endOfTrial: s.end_of_trial as BillingSettings["endOfTrial"], existingStorePolicy: s.existing_store_policy as BillingSettings["existingStorePolicy"] };
  }

  /** The store's live subscription (trialing, active, past_due, restricted, paused or incomplete). */
  async live(trx: Trx, tenantId: string, lock = false): Promise<SubscriptionRow | undefined> {
    let q = trx.selectFrom("subscriptions").selectAll().where("tenant_id", "=", tenantId).where("status", "not in", ["cancelled", "expired"]);
    if (lock) q = q.forUpdate();
    return q.executeTakeFirst();
  }

  /** Open the store's subscription: a trial of `plan` until `trialEndsAt`, or an active plan. 409 when one is live already. */
  async open(trx: Trx, tenantId: string, input: Change & { event: "start_trial" | "start"; plan: Plan; trialEndsAt?: Date; now?: Date }): Promise<SubscriptionRow> {
    const status = nextStatus(null, input.event);
    if (status === "trialing" && !input.trialEndsAt) throw new Error("a trial needs its end");
    const now = input.now ?? new Date();
    let row: SubscriptionRow;
    try {
      row = await trx.insertInto("subscriptions").values({
        tenant_id: tenantId, plan_code: input.plan, billing_interval: input.interval ?? "month", status, comp_percent: input.compPercent ?? 0,
        trial_started_at: status === "trialing" ? now : null, trial_ends_at: status === "trialing" ? input.trialEndsAt! : null,
        current_period_start: status === "active" ? now : null, started_at: now, created_at: now, updated_at: now,
      }).returningAll().executeTakeFirstOrThrow();
    } catch (err) {
      if ((err as { code?: string }).code === "23505") throw new ProblemError(409, "subscription_exists", "this store already has a live subscription");
      throw err;
    }
    await this.history(trx, row, input.event, null, null, input);
    if (status === "trialing") {
      await this.events.emit(trx, {
        type: "subscription.trial_started", tenantId, entity: { type: "subscription", id: row.id }, actor: eventActor(input.actor),
        data: { plan: input.plan, interval: row.billing_interval, endsAt: row.trial_ends_at!.toISOString(), ...input.data },
      });
    }
    await this.writePlan(trx, tenantId, entitlementPlan({ status, plan: input.plan }), input);
    return row;
  }

  /** Move a subscription along one edge of the state machine. 409 invalid_transition or version_conflict. */
  async transition(trx: Trx, tenantId: string, subscriptionId: string, event: SubscriptionEvent, change: Change): Promise<SubscriptionRow> {
    const cur = await trx.selectFrom("subscriptions").selectAll().where("id", "=", subscriptionId).forUpdate().executeTakeFirst();
    if (!cur) throw new ProblemError(404, "subscription_not_found", "no such subscription");
    if (change.expectedVersion !== undefined && cur.version !== change.expectedVersion) {
      throw new ProblemError(409, "version_conflict", "the subscription changed since it was read; read it again");
    }
    let to: SubscriptionStatus;
    try {
      to = nextStatus(statusOf(cur), event, cur.previous_status as SubscriptionStatus | null);
    } catch (err) {
      if (err instanceof TransitionError) throw new ProblemError(409, "invalid_transition", err.message);
      throw err;
    }
    const now = new Date();
    const ending = to === "cancelled" || to === "expired";
    const row = await trx.updateTable("subscriptions").set({
      status: to,
      plan_code: change.plan ?? cur.plan_code,
      billing_interval: change.interval ?? cur.billing_interval,
      previous_status: to === "incomplete" ? cur.status : null,
      comp_percent: change.compPercent ?? cur.comp_percent,
      cancel_at_period_end: event === "cancel" ? true : event === "uncancel" || ending ? false : cur.cancel_at_period_end,
      current_period_start: to === "active" && statusOf(cur) !== "active" ? now : cur.current_period_start,
      ended_at: ending ? now : null,
      version: cur.version + 1,
      updated_at: now,
    }).where("id", "=", cur.id).where("version", "=", cur.version).returningAll().executeTakeFirst();
    if (!row) throw new ProblemError(409, "version_conflict", "the subscription changed since it was read; read it again");
    await this.history(trx, row, event, statusOf(cur), planOf(cur), change);
    if (event === "trial_end") {
      await this.events.emit(trx, {
        type: "subscription.trial_ended", tenantId, entity: { type: "subscription", id: row.id }, actor: eventActor(change.actor),
        data: { plan: planOf(cur), outcome: change.data?.outcome ?? "expired" },
      });
    }
    await this.writePlan(trx, tenantId, entitlementPlan({ status: to, plan: planOf(row), previousStatus: row.previous_status as SubscriptionStatus | null }), change);
    return row;
  }

  /**
   * The trial is over (the scheduler, at trial_ends_at): with `end_of_trial = downgrade_free` (D3)
   * the trial expires and a Free subscription opens. Orders, webhooks and courier sync never stop.
   */
  async endTrial(trx: Trx, tenantId: string, sub: SubscriptionRow, actor: SubscriptionActor = { type: "system" }): Promise<SubscriptionRow> {
    const { endOfTrial } = await this.settings(trx);
    await this.transition(trx, tenantId, sub.id, "trial_end", { actor, expectedVersion: sub.version, reason: "trial ended", data: { outcome: endOfTrial } });
    return this.open(trx, tenantId, { event: "start", plan: "free", actor, reason: "trial ended without payment", data: { after: sub.id } });
  }

  /**
   * Mizan staff set a store's plan (A-2's PUT /v1/platform/stores/{id}/plan, now through here): the
   * store becomes active on that plan, comped 100% (no payment path before E12-2b0), or Free.
   * null when the store is already active on it.
   */
  async override(trx: Trx, tenantId: string, plan: Plan, change: Change): Promise<SubscriptionRow | null> {
    const cur = await this.live(trx, tenantId, true);
    const comp = plan === "free" ? 0 : 100;
    if (!cur) return this.open(trx, tenantId, { ...change, event: "start", plan, compPercent: comp });
    if (planOf(cur) === plan && statusOf(cur) === "active") return null;
    return this.transition(trx, tenantId, cur.id, "staff_override", { ...change, plan, compPercent: comp, data: { ...change.data, comp } });
  }

  private async history(trx: Trx, row: SubscriptionRow, event: SubscriptionEvent, fromStatus: SubscriptionStatus | null, fromPlan: Plan | null, c: Change) {
    await trx.insertInto("subscription_events").values({
      tenant_id: row.tenant_id, subscription_id: row.id, event, from_status: fromStatus, to_status: row.status, from_plan: fromPlan, to_plan: row.plan_code,
      version: row.version, actor_type: c.actor.type, actor_id: c.actor.id ?? null, reason: c.reason ?? null, data: JSON.stringify(c.data ?? {}),
    }).execute();
  }

  /** tenants.plan = the entitled plan; the only place it is written (mizan.plan_writer lets the trigger through for this transaction). */
  private async writePlan(trx: Trx, tenantId: string, plan: Plan, c: Change): Promise<void> {
    const t = await trx.selectFrom("tenants").select("plan").where("id", "=", tenantId).forUpdate().executeTakeFirstOrThrow();
    if (t.plan === plan) return;
    await sql`SELECT set_config('mizan.plan_writer', 'subscription', true)`.execute(trx);
    await trx.updateTable("tenants").set({ plan, updated_at: new Date() }).where("id", "=", tenantId).execute();
    await sql`SELECT set_config('mizan.plan_writer', '', true)`.execute(trx);
    await this.events.emit(trx, {
      type: "subscription.plan_changed", tenantId, entity: { type: "tenant", id: tenantId }, actor: eventActor(c.actor),
      data: { from: t.plan, to: plan, by: c.actor.type }, // never the free-text reason: it may name people
    });
  }
}
