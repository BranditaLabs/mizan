import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { DomainEvent } from "@mizan/shared";
import { EventConsumer, type EventHandler } from "../../platform/events/consumer.js";
import { StockService } from "./stock.service.js";

/**
 * Orders hold stock (E8-2): confirmed → reserve, cancelled → release, shipped → pick, lines changed
 * (an accepted offer, a store edit) → the difference. Each event re-reads the order, so repeats
 * and events out of order end in the same place.
 */
@Injectable()
@EventConsumer({ name: "stock.orders", events: ["order.created", "order.confirmed", "order.updated", "order.cancelled", "offer.applied"] })
export class StockConsumer implements EventHandler {
  constructor(@Inject(StockService) private readonly stock: StockService) {}

  async handle(event: DomainEvent, trx: Transaction<DB>): Promise<void> {
    if (event.entity.type === "order") await this.stock.syncOrder(trx, event.tenantId, event.entity.id, event.actor ?? { type: "system" });
  }
}
