import { Inject, Injectable } from "@nestjs/common";
import { sql, type ExpressionBuilder } from "kysely";
import type { DB } from "@mizan/db";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";

type Eb = ExpressionBuilder<DB & { r: DB["confirmation_runs"]; o: DB["orders"] }, "r" | "o">;

/**
 * The team's call queue (M2, E6-3): orders whose confirmation is waiting for a call, the caller's
 * own first, then nobody's. Next claims one by assigning it to the caller (locked rows are skipped,
 * so two agents never get the same customer). Retries due before fresh orders, the unreachable
 * last. Outcomes go through the order's confirmation (confirm, cancel, no answer → retry later).
 */
@Injectable()
export class CallQueueService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  /** Mine and nobody's: a caller never takes an order someone else is already calling. */
  private visible(eb: Eb, auth: AuthContext) {
    return eb.or([eb("o.assigned_to", "=", auth.user.id), eb("o.assigned_to", "is", null)]);
  }

  async summary(auth: AuthContext) {
    return this.db.tenant(auth.tenant!.id, async (trx) => {
      const r = await trx.selectFrom("confirmation_runs as r").innerJoin("orders as o", "o.id", "r.order_id")
        .select([
          sql<string>`count(*) filter (where r.call_after is null or r.call_after <= now())`.as("waiting"),
          sql<string>`count(*) filter (where (r.call_after is null or r.call_after <= now()) and o.assigned_to = ${auth.user.id})`.as("mine"),
          sql<string>`count(*) filter (where r.call_after > now())`.as("later"),
          sql<Date | null>`min(r.call_after) filter (where r.call_after > now())`.as("next_at"),
          sql<string>`count(*) filter (where r.reason = 'unreachable')`.as("unreachable"),
        ])
        .where("r.status", "=", "needs_agent").where((eb) => this.visible(eb as never, auth)).executeTakeFirstOrThrow();
      return { waiting: Number(r.waiting), mine: Number(r.mine), later: Number(r.later), nextAt: r.next_at ? new Date(r.next_at).toISOString() : null, unreachable: Number(r.unreachable) };
    });
  }

  /** The next order to call, claimed for the caller; null when nothing is due. */
  async next(auth: AuthContext) {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const row = await trx.selectFrom("confirmation_runs as r").innerJoin("orders as o", "o.id", "r.order_id")
        .select(["o.id", "o.number", "o.assigned_to", "r.call_attempts", "r.reason"])
        .where("r.status", "=", "needs_agent")
        .where((eb) => eb.or([eb("r.call_after", "is", null), eb("r.call_after", "<=", sql<Date>`now()`)]))
        .where((eb) => this.visible(eb as never, auth))
        .orderBy(sql`(o.assigned_to = ${auth.user.id})`, sql`desc nulls last`)
        .orderBy(sql`(r.reason = 'unreachable')`, "asc")
        .orderBy(sql`(r.call_after is null)`, "asc")
        .orderBy(sql`coalesce(r.call_after, r.started_at)`, "asc")
        .limit(1).forUpdate("o").skipLocked().executeTakeFirst();
      if (!row) return { order: null };
      if (row.assigned_to !== auth.user.id) {
        await trx.updateTable("orders").set({ assigned_to: auth.user.id, updated_at: new Date() }).where("id", "=", row.id).execute();
        await trx.insertInto("order_events").values({ tenant_id: tenantId, order_id: row.id, type: "assigned", actor_type: "user", actor_id: auth.user.id, data: JSON.stringify({ to: auth.user.id, via: "call_queue" }) }).execute();
        await this.events.emit(trx, { type: "order.assigned", tenantId, entity: { type: "order", id: row.id }, actor: { type: "user", id: auth.user.id }, data: { number: row.number, assignedTo: auth.user.id } });
      }
      return { order: { id: row.id, number: row.number, attempts: row.call_attempts, unreachable: row.reason === "unreachable" } };
    });
  }
}
