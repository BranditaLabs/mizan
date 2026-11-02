import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import { trxQueryClient, type DB } from "@mizan/db";
import { MizanEngine, SqlStore } from "@mizan/engine";
import type { DomainEvent } from "@mizan/shared";
import { EventConsumer, type EventHandler } from "../platform/events/consumer.js";
import { ENGINE_RUNTIME, type RuntimeFactory } from "./engine-registry.js";

/** Shopify serves 60 days of orders without the read_all_orders scope. */
export const BACKFILL_DAYS = 60;

/**
 * A Shopify store was connected or reconnected: queue its webhook registration (E3-2) and
 * history import (E3-5) as engine jobs (rule 3), in the consumer's transaction, so the jobs
 * and the delivery mark commit together. Keyed by the event: every connect runs both once.
 */
@Injectable()
@EventConsumer({ name: "integrations.shopify-connected", events: ["connection.connected"] })
export class ShopifyConnectedConsumer implements EventHandler {
  constructor(@Inject(ENGINE_RUNTIME) private readonly runtime: RuntimeFactory) {}

  async handle(event: DomainEvent, trx: Transaction<DB>): Promise<void> {
    if (event.data.provider !== "shopify") return;
    const store = new SqlStore(trxQueryClient(trx), { tenantId: event.tenantId, connections: { shopify: event.entity.id } });
    const now = this.runtime(event.tenantId).clock.now();
    await store.enqueue(MizanEngine.shopifyWebhooksJob(event.id), now);
    await store.enqueue(MizanEngine.shopifyBackfillJob(event.id, now - BACKFILL_DAYS * 86_400_000, now), now);
  }
}
