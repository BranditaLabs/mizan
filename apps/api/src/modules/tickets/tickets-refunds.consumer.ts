import { Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { DomainEvent } from "@mizan/shared";
import { EventConsumer, type EventHandler } from "../../platform/events/consumer.js";

const STEP: Record<string, string> = { "refund.created": "requested", "refund.approved": "approved", "refund.rejected": "rejected", "refund.completed": "completed" };

/**
 * A refund on a ticket shows in the ticket's history (E14-4, M6): asked, approved, rejected,
 * money back. Once per refund step, however often its event is delivered.
 */
@Injectable()
@EventConsumer({ name: "tickets.refunds", events: ["refund.created", "refund.approved", "refund.rejected", "refund.completed"] })
export class TicketsRefundsConsumer implements EventHandler {
  async handle(event: DomainEvent, trx: Transaction<DB>): Promise<void> {
    const d = event.data as { ticketId?: unknown; refundId?: unknown; refund?: unknown; amountMinor?: unknown; currency?: unknown; destination?: unknown };
    if (typeof d.ticketId !== "string" || typeof d.refundId !== "string") return;
    const step = STEP[event.type]!;
    const amount = typeof d.amountMinor === "string" ? d.amountMinor.replace(/^-/, "") : null;
    await trx.insertInto("ticket_events").values({
      tenant_id: event.tenantId, ticket_id: d.ticketId, type: "refund", actor_id: event.actor?.type === "user" ? event.actor.id ?? null : null,
      data: JSON.stringify({ refundId: d.refundId, refund: d.refund ?? null, step, amountMinor: amount, currency: d.currency ?? null, ...(typeof d.destination === "string" ? { destination: d.destination } : {}) }),
      dedupe_key: `${d.refundId}:${step}`,
    }).onConflict((oc) => oc.doNothing()).execute();
    await trx.updateTable("tickets").set({ updated_at: new Date() }).where("id", "=", d.ticketId).execute();
  }
}
