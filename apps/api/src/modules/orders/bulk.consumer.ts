import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { DomainEvent } from "@mizan/shared";
import { EventConsumer, type EventHandler } from "../../platform/events/consumer.js";
import { BulkActionsService } from "./bulk.service.js";

/** E5-4: each bulk event runs one chunk and, while orders remain, queues the next. */
@Injectable()
@EventConsumer({ name: "orders.bulk", events: ["orders.bulk_requested", "orders.bulk_continue"] })
export class BulkActionsConsumer implements EventHandler {
  constructor(@Inject(BulkActionsService) private readonly bulk: BulkActionsService) {}

  async handle(event: DomainEvent, trx: Transaction<DB>): Promise<void> {
    await this.bulk.runChunk(trx, event.tenantId, event.entity.id);
  }
}
