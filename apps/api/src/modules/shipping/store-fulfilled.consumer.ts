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
    const d = event.data as { company?: string | null; trackingNumber?: string | null; trackingUrl?: string | null; fulfillmentId?: string };
    if (!d.trackingNumber && !d.fulfillmentId) return;
    await this.shipping.recordStoreFulfillment(trx, event.tenantId, event.entity.id, { company: d.company ?? null, trackingNumber: d.trackingNumber ?? null, trackingUrl: d.trackingUrl ?? null, fulfillmentId: d.fulfillmentId ?? null });
  }
}

/** Shipping's watch on an order with a live delivery: the store cancelled it, the cash changed, a store fulfillment was cancelled. */
@Injectable()
@EventConsumer({ name: "shipping.watch-order", events: ["order.cancelled_after_shipping", "order.store_fulfillment_cancelled", "order.payment_changed", "order.updated"] })
export class ShippingWatchConsumer implements EventHandler {
  constructor(@Inject(ShippingService) private readonly shipping: ShippingService) {}

  async handle(event: DomainEvent, trx: Transaction<DB>): Promise<void> {
    await this.shipping.watch(trx, event);
  }
}
