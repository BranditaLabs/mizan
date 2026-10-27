import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { DomainEvent } from "@mizan/shared";
import { EventConsumer, type EventHandler } from "../../platform/events/consumer.js";
import { ProblemError } from "../../platform/http/problem.js";
import { LedgerService } from "./ledger.service.js";

type Delivered = { orderId?: string; codMinor?: string; currency?: string; connectionId?: string };

/**
 * The courier's cash in the ledger (M15, E10-2): a delivered shipment with cash to collect is a
 * `cod_collection` line (source courier), once per shipment, for orders Mizan holds the money of —
 * the team's own orders. A store's order gets its payment from the store (marked paid there), so
 * counting the courier too would count it twice; settlements (M8) reconcile both later.
 */
@Injectable()
@EventConsumer({ name: "payments.cod-collection", events: ["shipment.delivered"] })
export class CodCollectionConsumer implements EventHandler {
  private readonly log = new Logger("CodCollection");
  constructor(@Inject(LedgerService) private readonly ledger: LedgerService) {}

  async handle(event: DomainEvent, trx: Transaction<DB>): Promise<void> {
    const d = event.data as Delivered;
    const cod = BigInt(d.codMinor ?? "0");
    if (!d.orderId || cod <= 0n || !d.currency) return;
    const o = await trx.selectFrom("orders").select(["connection_id", "payment_mode"]).where("id", "=", d.orderId).executeTakeFirst();
    if (!o || o.connection_id !== null || !["cod", "partial"].includes(o.payment_mode)) return;
    try {
      await this.ledger.post(trx, event.tenantId, d.orderId, {
        kind: "cod_collection", method: "cod", source: "courier", amountMinor: cod, currency: d.currency,
        externalRef: `shipment:${event.entity.id}:cod`, connectionId: d.connectionId ?? null, eventData: { shipmentId: event.entity.id },
      }, { type: "system" });
    } catch (e) {
      // Paid in full some other way meanwhile (the team recorded it): nothing more to collect.
      if (e instanceof ProblemError && e.code === "over_payment") { this.log.warn({ orderId: d.orderId }, "cod already paid"); return; }
      throw e;
    }
  }
}
