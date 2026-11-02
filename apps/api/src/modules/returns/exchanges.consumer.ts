import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { DomainEvent } from "@mizan/shared";
import { EventConsumer, type EventHandler } from "../../platform/events/consumer.js";
import { ExchangesService } from "./exchanges.service.js";

/** An exchange is returned once inspection (E10-3) covers its items (E10-2). */
@Injectable()
@EventConsumer({ name: "returns.exchanges", events: ["return.inspected"] })
export class ExchangesConsumer implements EventHandler {
  constructor(@Inject(ExchangesService) private readonly exchanges: ExchangesService) {}

  async handle(event: DomainEvent, trx: Transaction<DB>): Promise<void> {
    await this.exchanges.onInspected(trx, event);
  }
}
