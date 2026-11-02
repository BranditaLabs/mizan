import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { DomainEvent } from "@mizan/shared";
import { EventConsumer, type EventHandler } from "../../platform/events/consumer.js";
import { EventsService } from "../../platform/events/events.service.js";
import { limitAlerts, monthOf, PLAN_LIMITS, type Plan } from "./plans.js";
import { UsageService } from "./usage.service.js";

/**
 * Plan limits (E12-1): when an order arrives, a member joins or a store connects, the store's
 * usage is checked against its plan. Getting close (80%) and going past a limit each tell the
 * owner and admins once a month (a notification, and `plan.limit_reached` for automations and
 * Brandita). Soft: nothing is ever blocked.
 */
@Injectable()
@EventConsumer({ name: "billing.limits", events: ["order.created", "member.joined", "connection.connected"] })
export class LimitsConsumer implements EventHandler {
  constructor(
    @Inject(UsageService) private readonly usage: UsageService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  async handle(event: DomainEvent, trx: Transaction<DB>): Promise<void> {
    const t = await trx.selectFrom("tenants").select(["plan", "timezone"]).where("id", "=", event.tenantId).executeTakeFirst();
    if (!t) return;
    const plan = t.plan as Plan;
    const month = monthOf(new Date(), t.timezone);
    const used = await this.usage.count(trx, month, t.timezone);
    for (const a of limitAlerts(used, PLAN_LIMITS[plan])) {
      const r = await trx.insertInto("notifications").values({
        tenant_id: event.tenantId, roles: ["owner", "admin"], text: `${a.metric}|${a.level}|${a.used}|${a.limit}|${plan}`, entity_type: "plan", entity_id: event.tenantId,
        source: "plan.limit", dedupe_key: `plan:${a.metric}:${a.level}:${month}`,
      }).onConflict((oc) => oc.columns(["tenant_id", "dedupe_key"]).where("dedupe_key", "is not", null).doNothing()).returning("id").executeTakeFirst();
      if (r) await this.events.emit(trx, { type: "plan.limit_reached", tenantId: event.tenantId, entity: { type: "tenant", id: event.tenantId }, actor: { type: "system" }, data: { ...a, plan, month: month.slice(0, 7) } });
    }
  }
}
