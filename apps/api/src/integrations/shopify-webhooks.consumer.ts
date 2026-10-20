import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import { trxQueryClient, type DB } from "@mizan/db";
import { MizanEngine, SqlStore } from "@mizan/engine";
import type { DomainEvent } from "@mizan/shared";
import { EventConsumer, type EventHandler } from "../platform/events/consumer.js";
import { ENGINE_RUNTIME, type RuntimeFactory } from "./engine-registry.js";

/**
 * A Shopify store was connected or reconnected (E3-2): queue the webhook registration
 * as an engine job (rule 3), in the consumer's transaction, so the job and the delivery
 * mark commit together. Keyed by the event: every connect registers once — a reinstall
 * needs it, because uninstalling drops the app's subscriptions.
 */
@Injectable()
@EventConsumer({ name: "integrations.shopify-webhooks", events: ["connection.connected"] })
export class ShopifyWebhooksConsumer implements EventHandler {
  constructor(@Inject(ENGINE_RUNTIME) private readonly runtime: RuntimeFactory) {}

  async handle(event: DomainEvent, trx: Transaction<DB>): Promise<void> {
    if (event.data.provider !== "shopify") return;
    const store = new SqlStore(trxQueryClient(trx), { tenantId: event.tenantId, connections: { shopify: event.entity.id } });
    await store.enqueue(MizanEngine.shopifyWebhooksJob(event.id), this.runtime(event.tenantId).clock.now());
  }
}
