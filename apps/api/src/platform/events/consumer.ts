import { SetMetadata } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { DomainEvent } from "@mizan/shared";

export const EVENT_CONSUMER = "mizan:event-consumer";

export interface EventConsumerOptions {
  /** Stable name: it keys exactly-once delivery. Renaming a consumer replays history to it. */
  name: string;
  /** Event types or patterns: "order.created", "order.*", "*". */
  events: string[];
}

/**
 * A consumer runs inside a tenant transaction (RLS on) that also records the
 * delivery; its database writes and the delivery mark commit together.
 * Throw to retry later (with backoff). Calls to the outside world must be
 * outbox jobs, not direct calls (CLAUDE.md rule 3).
 */
export interface EventHandler {
  handle(event: DomainEvent, trx: Transaction<DB>): Promise<void>;
}

/** Mark a provider as a domain event consumer. */
export const EventConsumer = (options: EventConsumerOptions) => SetMetadata(EVENT_CONSUMER, options);
