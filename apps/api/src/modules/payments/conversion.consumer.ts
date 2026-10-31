import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { DomainEvent } from "@mizan/shared";
import { EventConsumer, type EventHandler } from "../../platform/events/consumer.js";
import { ConversionService } from "./conversion.service.js";

/** Money in on an order (E14-3): an open COD conversion offer it completes is marked paid. */
@Injectable()
@EventConsumer({ name: "payments.conversion", events: ["payment.received"] })
export class ConversionConsumer implements EventHandler {
  constructor(@Inject(ConversionService) private readonly conversions: ConversionService) {}

  async handle(event: DomainEvent, trx: Transaction<DB>): Promise<void> {
    if (event.entity.type !== "order") return;
    await this.conversions.onPayment(trx, event.tenantId, event.entity.id);
  }
}
