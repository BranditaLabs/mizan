import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { DomainEvent } from "@mizan/shared";
import { EventConsumer, type EventHandler } from "../../platform/events/consumer.js";
import { AutomationRuntime } from "./runtime.js";

/** Every domain event reaches the automations listening for it (M13, E11-1), once per event. */
@Injectable()
@EventConsumer({ name: "automations.run", events: ["*"] })
export class AutomationsConsumer implements EventHandler {
  constructor(@Inject(AutomationRuntime) private readonly runtime: AutomationRuntime) {}

  handle(event: DomainEvent, trx: Transaction<DB>): Promise<void> {
    return this.runtime.onEvent(trx, event);
  }
}
