import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { DomainEvent } from "@mizan/shared";
import { EventConsumer, type EventHandler } from "../../platform/events/consumer.js";
import { ProductEventsService } from "./product-events.service.js";

/**
 * Domain events → product-event milestones (E4-5). Runs in the event's tenant transaction, keyed by
 * consumer and event, and the milestones are deduplicated: replays record nothing twice. The time of
 * the domain event is kept, so a slow worker does not stretch time-to-first-value.
 */
@Injectable()
@EventConsumer({ name: "onboarding.product-events", events: ["tenant.created", "connection.connected", "order.created"] })
export class ProductEventsConsumer implements EventHandler {
  constructor(@Inject(ProductEventsService) private readonly events: ProductEventsService) {}

  async handle(event: DomainEvent, trx: Transaction<DB>): Promise<void> {
    const at = new Date(event.occurredAt);
    const userId = event.actor?.type === "user" ? event.actor.id ?? null : null;
    if (event.type === "tenant.created") {
      await this.events.record(trx, event.tenantId, { name: "signup", once: true, userId, at, data: { country: String(event.data.country ?? "") } });
    } else if (event.type === "connection.connected") {
      const kind = event.data.kind === "courier" ? "courier_connected" : event.data.kind === "store" ? "store_connected" : null;
      if (kind) await this.events.record(trx, event.tenantId, { name: kind, once: true, userId, at, data: { provider: String(event.data.provider ?? ""), connectionId: event.entity.id } });
    } else if (event.type === "order.created") {
      await this.events.record(trx, event.tenantId, { name: "first_order_synced", once: true, at, data: { orderId: event.entity.id } });
    }
  }
}
