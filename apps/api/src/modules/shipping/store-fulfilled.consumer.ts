import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { DomainEvent } from "@mizan/shared";
import { EventConsumer, type EventHandler } from "../../platform/events/consumer.js";
import { ShippingService } from "./shipping.service.js";

/** Two-way delivery, store → Mizan: an order the merchant shipped in the store becomes a Mizan shipment. */
@Injectable()
@EventConsumer({ name: "shipping.store-fulfilled", events: ["order.store_fulfilled"] })
export class StoreFulfilledConsumer implements EventHandler {
  constructor(@Inject(ShippingService) private readonly shipping: ShippingService) {}

  async handle(event: DomainEvent, trx: Transaction<DB>): Promise<void> {
    const d = event.data as { company?: string | null; trackingNumber?: string; trackingUrl?: string | null; fulfillmentId?: string };
    if (!d.trackingNumber) return;
    await this.shipping.recordStoreFulfillment(trx, event.tenantId, event.entity.id, { company: d.company ?? null, trackingNumber: d.trackingNumber, trackingUrl: d.trackingUrl ?? null, fulfillmentId: d.fulfillmentId ?? null });
  }
}
