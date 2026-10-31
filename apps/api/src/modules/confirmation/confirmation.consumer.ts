import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { DomainEvent } from "@mizan/shared";
import { EventConsumer, type EventHandler } from "../../platform/events/consumer.js";
import { ConfirmationService } from "./confirmation.service.js";

/**
 * Starts confirmation for every new cash-on-delivery order (E6-7; a likely duplicate once the team keeps it, E5-3) and stops it when the store
 * cancels the order or it gets paid meanwhile. Runs in the event's tenant transaction, so the run,
 * its first step and the delivery mark commit together; sends happen later in the runner (rule 3).
 */
@Injectable()
@EventConsumer({ name: "confirmation.orders", events: ["order.created", "order.updated", "order.cancelled", "order.duplicate_resolved"] })
export class ConfirmationConsumer implements EventHandler {
  constructor(@Inject(ConfirmationService) private readonly confirmations: ConfirmationService) {}

  async handle(event: DomainEvent, trx: Transaction<DB>): Promise<void> {
    const orderId = event.entity.id;
    if (event.type === "order.created" || (event.type === "order.duplicate_resolved" && event.data.resolution === "kept")) {
      await this.confirmations.start(trx, event.tenantId, orderId);
      return;
    }
    if (event.type === "order.duplicate_resolved") return; // merged: its order.cancelled stops it
    if (event.type === "order.cancelled") {
      // A cancellation the confirmation itself made has no live run left; one from the store stops it.
      await this.confirmations.stop(trx, orderId, "cancelled_in_store");
      return;
    }
    const d = event.data as { status?: string; paymentStatus?: string; paymentMode?: string };
    if (d.paymentStatus === "paid" || (d.paymentMode && !["cod", "partial"].includes(d.paymentMode))) {
      await this.confirmations.stop(trx, orderId, "paid");
    }
  }
}
