import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { MetricsService } from "../../platform/metrics/metrics.service.js";

/** Product events (docs/02 §8). Milestones happen once per store; the others may repeat. */
export const MILESTONES = ["signup", "store_connected", "courier_connected", "costs_entered", "first_order_synced"] as const;
export type Milestone = (typeof MILESTONES)[number];

export interface ProductEventInput {
  name: string;
  /** Record at most once per store (milestones). */
  once?: boolean;
  userId?: string | null;
  /** Ids and business facts only: never names, phones, addresses or emails. */
  data?: Record<string, string | number | boolean | null>;
  at?: Date;
}

@Injectable()
export class ProductEventsService {
  constructor(@Inject(MetricsService) private readonly metrics: MetricsService) {}

  /** Record in the caller's tenant transaction; returns false when a milestone was already there. */
  async record(trx: Transaction<DB>, tenantId: string, e: ProductEventInput): Promise<boolean> {
    const row = await trx.insertInto("product_events").values({
      tenant_id: tenantId, name: e.name, dedupe_key: e.once ? e.name : null, user_id: e.userId ?? null,
      data: JSON.stringify(e.data ?? {}), ...(e.at ? { occurred_at: e.at } : {}),
    }).onConflict((oc) => oc.columns(["tenant_id", "dedupe_key"]).where("dedupe_key", "is not", null).doNothing())
      .returning("occurred_at").executeTakeFirst();
    if (!row) return false;
    if (e.name === "first_order_synced") {
      const signup = await trx.selectFrom("product_events").select("occurred_at").where("dedupe_key", "=", "signup").executeTakeFirst();
      if (signup) this.metrics.timeToFirstValue.observe(Math.max(0, (row.occurred_at.getTime() - signup.occurred_at.getTime()) / 1000));
    }
    return true;
  }

  /** When each milestone happened (null until it does). */
  async milestones(trx: Transaction<DB>): Promise<Record<Milestone, Date | null>> {
    const rows = await trx.selectFrom("product_events").select(["dedupe_key", "occurred_at"]).where("dedupe_key", "in", [...MILESTONES]).execute();
    const at = new Map(rows.map((r) => [r.dedupe_key, r.occurred_at]));
    return Object.fromEntries(MILESTONES.map((m) => [m, at.get(m) ?? null])) as Record<Milestone, Date | null>;
  }
}
