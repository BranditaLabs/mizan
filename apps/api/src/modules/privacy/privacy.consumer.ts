import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { DomainEvent } from "@mizan/shared";
import { EventConsumer, type EventHandler } from "../../platform/events/consumer.js";
import { PrivacyService } from "./privacy.service.js";

/** Carries out a recorded privacy request (redact or compile), in the event's tenant transaction. */
@Injectable()
@EventConsumer({ name: "privacy.shopify", events: ["privacy.requested"] })
export class PrivacyConsumer implements EventHandler {
  constructor(@Inject(PrivacyService) private readonly privacy: PrivacyService) {}

  handle(event: DomainEvent, trx: Transaction<DB>): Promise<void> {
    return this.privacy.process(trx, event.tenantId, event.entity.id);
  }
}
