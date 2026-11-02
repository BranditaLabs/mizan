import { Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { DomainEventType, EventActor } from "@mizan/shared";

export interface EmitInput {
  type: DomainEventType;
  tenantId: string;
  entity: { type: string; id: string };
  /** Ids and business facts only; never personal data. */
  data?: Record<string, unknown>;
  actor?: EventActor | null;
  version?: number;
}

/**
 * Writes domain events to the outbox (domain_events) inside the caller's
 * transaction, so the event exists if and only if the state change committed.
 * `trx` must be a tenant transaction for `tenantId` (RLS enforces it).
 */
@Injectable()
export class EventsService {
  async emit(trx: Transaction<DB>, input: EmitInput): Promise<string> {
    const row = await trx.insertInto("domain_events").values({
      tenant_id: input.tenantId,
      type: input.type,
      entity_type: input.entity.type,
      entity_id: input.entity.id,
      actor: input.actor ? JSON.stringify(input.actor) : null,
      data: JSON.stringify(input.data ?? {}),
      version: input.version ?? 1,
    }).returning("id").executeTakeFirstOrThrow();
    return row.id;
  }
}
