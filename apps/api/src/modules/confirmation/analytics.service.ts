import { Inject, Injectable } from "@nestjs/common";
import { sql } from "kysely";
import { Database } from "../../platform/db/database.js";
import { summarize, type ConfirmationSummary } from "./analytics.js";

/**
 * Confirmation analytics (E6-6): orders placed in the last N days that went through confirmation
 * (routed, or a run started), each with its latest run. A duplicate held or merged is not a
 * confirmation outcome and is left out.
 */
@Injectable()
export class ConfirmationAnalytics {
  constructor(@Inject(Database) private readonly db: Database) {}

  async summary(tenantId: string, days: number, now = new Date()): Promise<ConfirmationSummary & { days: number }> {
    const since = new Date(now.getTime() - days * 86_400_000);
    const rows = await this.db.tenant(tenantId, (trx) => trx.selectFrom("orders as o")
      .leftJoinLateral((eb) => eb.selectFrom("confirmation_runs as r").select(["r.status", "r.answered_channel"])
        .whereRef("r.order_id", "=", "o.id").orderBy("r.started_at", "desc").limit(1).as("r"), (j) => j.onTrue())
      .select(["o.confirm_route", "o.status", "o.placed_at", "o.confirmed_at", "r.status as run_status", "r.answered_channel"])
      .where("o.placed_at", ">=", since)
      .where((eb) => eb.or([eb("o.confirm_route", "is not", null), eb("r.status", "is not", null)]))
      .where(sql<boolean>`coalesce(o.duplicate_status, '') not in ('suspected', 'merged')`)
      .execute());
    return {
      days,
      ...summarize(rows.map((r) => ({
        route: r.confirm_route, status: r.status, runStatus: r.run_status, answeredChannel: r.answered_channel, placedAt: r.placed_at, confirmedAt: r.confirmed_at,
      }))),
    };
  }
}
