import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { trxQueryClient, type DB } from "@mizan/db";
import { MizanEngine, SqlStore, type CancelOutcome } from "@mizan/engine";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { AuditService, auditActor } from "../../platform/audit/audit.service.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import { ORDER_ANSWERS, type OrderAnswers } from "./ports.js";

export const BULK_ACTIONS = ["assign", "tag", "confirm", "cancel"] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];
export const CANCEL_REASONS = ["customer_cancelled", "duplicate", "out_of_stock", "fraud", "other"] as const;
export type BulkParams =
  | { action: "assign"; userId: string | null }
  | { action: "tag"; tags: string[] }
  | { action: "confirm" }
  | { action: "cancel"; reason: (typeof CANCEL_REASONS)[number] };

/** Orders per chunk: each chunk commits on its own, so progress shows and a long list never holds one transaction. */
export const BULK_CHUNK = 25;
const ASSIGNABLE = new Set(["owner", "admin", "ops_manager", "agent"]);
const CANCELLABLE = new Set(["new", "pending_confirmation", "confirmed"]);
const SHOPIFY_REASON = { customer_cancelled: "CUSTOMER", duplicate: "OTHER", out_of_stock: "INVENTORY", fraud: "FRAUD", other: "OTHER" } as const;

class Skip extends Error {
  constructor(readonly code: string) { super(code); }
}

/**
 * Bulk actions on orders (M1, E5-4): assign, tag, confirm, cancel up to 500 orders at once. The
 * request records the action and its orders and returns; the worker applies it in chunks
 * (orders.bulk_requested → orders.bulk_continue …), each order in its own savepoint so one
 * failure never undoes the rest. Every order ends done, skipped (with a reason code) or failed.
 * Cancelling also cancels the store's order (outbox job: no refund, restocked, the customer not
 * emailed); a paid order is skipped, its money goes back through a refund.
 */
@Injectable()
export class BulkActionsService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ORDER_ANSWERS) private readonly confirmations: OrderAnswers,
  ) {}

  async request(auth: AuthContext, body: BulkParams & { orderIds: string[] }) {
    const tenantId = auth.tenant!.id;
    const ids = [...new Set(body.orderIds)];
    return this.db.tenant(tenantId, async (trx) => {
      if (body.action === "assign" && body.userId) {
        const m = await trx.selectFrom("memberships").select("role").where("user_id", "=", body.userId).where("status", "=", "active").executeTakeFirst();
        if (!m || !ASSIGNABLE.has(m.role)) throw new ProblemError(422, "not_assignable", "assign orders to an active member of this store's team");
      }
      const found = await trx.selectFrom("orders").select("id").where("id", "in", ids).execute();
      if (found.length !== ids.length) throw new ProblemError(422, "unknown_orders", `${ids.length - found.length} of the orders are not in this store`);
      const { orderIds: _, ...params } = body;
      const b = await trx.insertInto("bulk_actions").values({ tenant_id: tenantId, action: body.action, params: JSON.stringify(params), total: ids.length, created_by: auth.user.id })
        .returning(["id", "action", "status", "total", "done", "skipped", "failed", "created_at", "finished_at"]).executeTakeFirstOrThrow();
      await trx.insertInto("bulk_action_items").values(ids.map((order_id) => ({ bulk_id: b.id, tenant_id: tenantId, order_id }))).execute();
      await this.events.emit(trx, { type: "orders.bulk_requested", tenantId, entity: { type: "bulk_action", id: b.id }, actor: { type: "user", id: auth.user.id }, data: { action: body.action, total: ids.length } });
      await this.audit.record(trx, { action: "orders.bulk_requested", tenantId, ...auditActor(auth), entity: { type: "bulk_action", id: b.id }, after: { ...params, total: ids.length } });
      return view(b, []);
    });
  }

  async get(tenantId: string, id: string) {
    return this.db.tenant(tenantId, async (trx) => {
      const b = await trx.selectFrom("bulk_actions").select(["id", "action", "status", "total", "done", "skipped", "failed", "created_at", "finished_at"]).where("id", "=", id).executeTakeFirst();
      if (!b) throw new ProblemError(404, "not_found", "no such bulk action in this store");
      const issues = await trx.selectFrom("bulk_action_items as i").innerJoin("orders as o", "o.id", "i.order_id").select(["i.order_id", "o.number", "i.status", "i.reason"])
        .where("i.bulk_id", "=", id).where("i.status", "in", ["skipped", "failed"]).orderBy("o.number").limit(200).execute();
      return view(b, issues);
    });
  }

  /** One chunk of a bulk action, inside the consumer's transaction; queues the next chunk while orders remain. */
  async runChunk(trx: Transaction<DB>, tenantId: string, bulkId: string, now = new Date()): Promise<void> {
    const b = await trx.selectFrom("bulk_actions").select(["id", "action", "params", "status", "created_by"]).where("id", "=", bulkId).forUpdate().executeTakeFirst();
    if (!b || b.status === "done") return;
    const params = { ...(b.params as object), action: b.action } as BulkParams;
    const items = await trx.selectFrom("bulk_action_items").select("order_id").where("bulk_id", "=", bulkId).where("status", "=", "pending").orderBy("order_id").limit(BULK_CHUNK).execute();
    const counts = { done: 0, skipped: 0, failed: 0 };
    for (const { order_id } of items) {
      let status: "done" | "skipped" | "failed" = "done";
      let reason: string | null = null;
      await sql`savepoint bulk_item`.execute(trx);
      try {
        await this.apply(trx, tenantId, order_id, params, b.created_by, bulkId, now);
        await sql`release savepoint bulk_item`.execute(trx);
      } catch (e) {
        await sql`rollback to savepoint bulk_item`.execute(trx);
        if (e instanceof Skip) { status = "skipped"; reason = e.code; }
        else if (e instanceof ProblemError) { status = "skipped"; reason = e.code; }
        else { status = "failed"; reason = "error"; }
      }
      counts[status]++;
      await trx.updateTable("bulk_action_items").set({ status, reason, updated_at: now }).where("bulk_id", "=", bulkId).where("order_id", "=", order_id).execute();
    }
    const left = await trx.selectFrom("bulk_action_items").select((eb) => eb.fn.countAll<string>().as("n")).where("bulk_id", "=", bulkId).where("status", "=", "pending").executeTakeFirstOrThrow();
    const finished = Number(left.n) === 0;
    const after = await trx.updateTable("bulk_actions").set((eb) => ({
      done: eb("done", "+", counts.done), skipped: eb("skipped", "+", counts.skipped), failed: eb("failed", "+", counts.failed),
      ...(finished ? { status: "done", finished_at: now } : {}),
    })).where("id", "=", bulkId).returning(["total", "done", "skipped", "failed"]).executeTakeFirstOrThrow();
    const actor = b.created_by ? { type: "user" as const, id: b.created_by } : { type: "system" as const };
    await this.events.emit(trx, finished
      ? { type: "orders.bulk_finished", tenantId, entity: { type: "bulk_action", id: bulkId }, actor, data: { action: b.action, ...after } }
      : { type: "orders.bulk_continue", tenantId, entity: { type: "bulk_action", id: bulkId }, actor, data: { action: b.action, ...after } });
  }

  /** The store's order could not be cancelled (E5-4): the team sees it on the order. */
  async recordStoreCancel(tenantId: string, connectionId: string, externalId: string, result: CancelOutcome): Promise<void> {
    if (result.ok) return; // the order is read again: the store's cancellation comes back as an update
    await this.db.tenant(tenantId, async (trx) => {
      const o = await trx.selectFrom("orders").select(["id", "number"]).where("connection_id", "=", connectionId).where("external_id", "=", externalId).executeTakeFirst();
      if (!o) return;
      await trx.insertInto("order_events").values({ tenant_id: tenantId, order_id: o.id, type: "store_cancel_failed", actor_type: "system", data: JSON.stringify({ reason: result.reason }) }).execute();
      await this.events.emit(trx, { type: "order.store_cancel_failed", tenantId, entity: { type: "order", id: o.id }, actor: { type: "engine" }, data: { number: o.number, reason: result.reason } });
    });
  }

  private async apply(trx: Transaction<DB>, tenantId: string, orderId: string, p: BulkParams, userId: string | null, bulkId: string, now: Date) {
    const o = await trx.selectFrom("orders as o").leftJoin("connections as c", "c.id", "o.connection_id")
      .select(["o.id", "o.number", "o.status", "o.assigned_to", "o.tags", "o.paid_minor", "o.duplicate_status", "o.external_id", "o.connection_id", "c.provider"])
      .where("o.id", "=", orderId).forUpdate("o").executeTakeFirst();
    if (!o) throw new Skip("not_found");
    const actor = userId ? { type: "user" as const, id: userId } : { type: "system" as const };
    const event = (type: string, data: Record<string, unknown>, from?: string, to?: string) => trx.insertInto("order_events").values({
      tenant_id: tenantId, order_id: o.id, type, from_status: from ?? null, to_status: to ?? null, actor_type: userId ? "user" : "system", actor_id: userId, data: JSON.stringify({ ...data, bulk: bulkId }),
    }).execute();
    const store = () => (o.provider === "shopify" && o.external_id && o.connection_id ? new SqlStore(trxQueryClient(trx), { tenantId, connections: { shopify: o.connection_id } }) : null);

    switch (p.action) {
      case "assign": {
        if (o.status === "cancelled") throw new Skip("cancelled");
        if (o.assigned_to === p.userId) throw new Skip("unchanged");
        await trx.updateTable("orders").set({ assigned_to: p.userId, updated_at: now }).where("id", "=", o.id).execute();
        await event("assigned", { to: p.userId });
        await this.events.emit(trx, { type: "order.assigned", tenantId, entity: { type: "order", id: o.id }, actor, data: { number: o.number, assignedTo: p.userId } });
        return;
      }
      case "tag": {
        const add = p.tags.filter((t) => !o.tags.includes(t));
        if (!add.length) throw new Skip("unchanged");
        await trx.updateTable("orders").set({ tags: [...o.tags, ...add], updated_at: now }).where("id", "=", o.id).execute();
        await event("tagged", { tags: add });
        await this.events.emit(trx, { type: "order.tagged", tenantId, entity: { type: "order", id: o.id }, actor, data: { number: o.number, tags: add } });
        // The merchant sees the tags in Shopify too, and the next sync keeps them (rule 3: an outbox job).
        await store()?.enqueue(MizanEngine.shopifyTagJob(o.external_id!, add, bulkId), now.getTime());
        return;
      }
      case "confirm": {
        if (o.duplicate_status === "suspected") throw new Skip("duplicate_suspected");
        if (!["new", "pending_confirmation"].includes(o.status)) throw new Skip(o.status === "cancelled" ? "cancelled" : "already_confirmed");
        const run = await this.confirmations.liveRun(trx, o.id);
        await this.confirmations.applyAnswer(trx, tenantId, o.id, run, { answer: "confirm", channel: "agent", actor: userId ? { type: "user", id: userId } : { type: "system" } }, now);
        return;
      }
      case "cancel": {
        if (o.status === "cancelled") throw new Skip("cancelled");
        if (!CANCELLABLE.has(o.status)) throw new Skip("shipped");
        if (BigInt(o.paid_minor) > 0n) throw new Skip("paid_needs_refund");
        await trx.updateTable("orders").set({ status: "cancelled", cancelled_at: now, updated_at: now }).where("id", "=", o.id).execute();
        await event("cancelled", { reason: p.reason }, o.status, "cancelled");
        await this.events.emit(trx, { type: "order.cancelled", tenantId, entity: { type: "order", id: o.id }, actor, data: { number: o.number, reason: p.reason } });
        await store()?.enqueue(MizanEngine.shopifyCancelJob({ orderId: o.external_id!, reason: SHOPIFY_REASON[p.reason], note: "Mizan: cancelled by the team" }), now.getTime());
        return;
      }
    }
  }
}

function view(
  b: { id: string; action: string; status: string; total: number; done: number; skipped: number; failed: number; created_at: Date; finished_at: Date | null },
  issues: Array<{ order_id: string; number: string; status: string; reason: string | null }>,
) {
  return {
    id: b.id, action: b.action as BulkAction, status: b.status as "running" | "done", total: b.total, done: b.done, skipped: b.skipped, failed: b.failed,
    createdAt: b.created_at.toISOString(), finishedAt: b.finished_at?.toISOString() ?? null,
    issues: issues.map((i) => ({ orderId: i.order_id, number: i.number, status: i.status as "skipped" | "failed", reason: i.reason ?? "error" })),
  };
}
