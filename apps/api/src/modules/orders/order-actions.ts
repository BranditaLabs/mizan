import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import { trxQueryClient, type DB } from "@mizan/db";
import { MizanEngine, SqlStore } from "@mizan/engine";
import type { EventActor } from "@mizan/shared";
import { EventsService } from "../../platform/events/events.service.js";

/** Why an action left the order as it was. */
export type Unchanged = "not_found" | "cancelled" | "unchanged";

/**
 * Small changes to one order that other parts of Mizan ask for (M1): bulk actions (E5-4) and
 * automations (E11-1). Each runs in the caller's transaction, writes the order's timeline and
 * emits the order event; tags also reach the Shopify order through the outbox. `ref` names what
 * asked (a bulk action or an automation run), so a repeat is a no-op and the timeline says why.
 */
@Injectable()
export class OrderActions {
  constructor(@Inject(EventsService) private readonly events: EventsService) {}

  async assign(trx: Transaction<DB>, tenantId: string, orderId: string, userId: string | null, actor: EventActor, ref: Record<string, string>, now = new Date()): Promise<Unchanged | "done"> {
    const o = await trx.selectFrom("orders").select(["id", "number", "status", "assigned_to"]).where("id", "=", orderId).forUpdate().executeTakeFirst();
    if (!o) return "not_found";
    if (o.status === "cancelled") return "cancelled";
    if (o.assigned_to === userId) return "unchanged";
    await trx.updateTable("orders").set({ assigned_to: userId, updated_at: now }).where("id", "=", o.id).execute();
    await this.timeline(trx, tenantId, o.id, "assigned", { to: userId, ...ref }, actor);
    await this.events.emit(trx, { type: "order.assigned", tenantId, entity: { type: "order", id: o.id }, actor, data: { number: o.number, assignedTo: userId, ...ref } });
    return "done";
  }

  async tag(trx: Transaction<DB>, tenantId: string, orderId: string, tags: string[], actor: EventActor, ref: Record<string, string>, now = new Date()): Promise<Unchanged | "done"> {
    const o = await trx.selectFrom("orders as o").leftJoin("connections as c", "c.id", "o.connection_id")
      .select(["o.id", "o.number", "o.tags", "o.external_id", "o.connection_id", "c.provider"]).where("o.id", "=", orderId).forUpdate("o").executeTakeFirst();
    if (!o) return "not_found";
    const add = tags.filter((t) => !o.tags.includes(t));
    if (!add.length) return "unchanged";
    await trx.updateTable("orders").set({ tags: [...o.tags, ...add], updated_at: now }).where("id", "=", o.id).execute();
    await this.timeline(trx, tenantId, o.id, "tagged", { tags: add, ...ref }, actor);
    await this.events.emit(trx, { type: "order.tagged", tenantId, entity: { type: "order", id: o.id }, actor, data: { number: o.number, tags: add, ...ref } });
    // The merchant sees the tags in Shopify too, and the next sync keeps them (rule 3: an outbox job).
    if (o.provider === "shopify" && o.external_id && o.connection_id) {
      const store = new SqlStore(trxQueryClient(trx), { tenantId, connections: { shopify: o.connection_id } });
      await store.enqueue(MizanEngine.shopifyTagJob(o.external_id, add, Object.values(ref).join(":")), now.getTime());
    }
    return "done";
  }

  private timeline(trx: Transaction<DB>, tenantId: string, orderId: string, type: string, data: Record<string, unknown>, actor: EventActor) {
    return trx.insertInto("order_events").values({
      tenant_id: tenantId, order_id: orderId, type, actor_type: actor.type === "user" ? "user" : "system", actor_id: actor.type === "user" ? (actor.id ?? null) : null, data: JSON.stringify(data),
    }).execute();
  }
}
