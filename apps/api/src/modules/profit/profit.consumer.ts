import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { DomainEvent } from "@mizan/shared";
import { EventConsumer, type EventHandler } from "../../platform/events/consumer.js";
import { ProfitService } from "./profit.service.js";

/**
 * Keeps order_pnl current (E9-2): an order that changes (created, updated in the store, confirmed,
 * cancelled, paid) is recomputed; a cost or exchange-rate change recomputes the provisional orders
 * it touches (bounded per event; POST /profit/recalculate for the rest). Ad spend (E9-3): a changed
 * day re-splits over that store day's orders, and an order that joins or leaves a day (created,
 * cancelled) re-splits its day.
 */
/** A CSV covers at most MAX_AGE_DAYS days; one event re-splits them all (each day bounded by RECOMPUTE_BATCH). */
const MAX_DAYS_PER_EVENT = 400;

@Injectable()
@EventConsumer({
  name: "profit.recompute",
  events: ["order.created", "order.updated", "order.cancelled", "order.confirmed", "order.payment_changed", "costs.changed", "fx.rate_overridden", "ads.spend_changed", "return.inspected"],
})
export class ProfitConsumer implements EventHandler {
  constructor(@Inject(ProfitService) private readonly profit: ProfitService) {}

  async handle(event: DomainEvent, trx: Transaction<DB>): Promise<void> {
    const d = event.data as { kind?: string; validFrom?: string; variantIds?: string[]; quote?: string; day?: string; connectionId?: string; days?: string[] };
    if (event.type === "ads.spend_changed") {
      for (const day of (d.days ?? []).slice(0, MAX_DAYS_PER_EVENT)) await this.profit.respreadDay(trx, event.tenantId, d.connectionId!, day);
      return;
    }
    if (event.type === "costs.changed") {
      if (d.kind === "product_cost") await this.profit.recomputeOpen(trx, event.tenantId, { variantIds: d.variantIds ?? [] });
      else await this.profit.recomputeOpen(trx, event.tenantId, d.validFrom ? { fromDay: d.validFrom } : {});
      return;
    }
    if (event.type === "fx.rate_overridden") {
      if (d.quote && d.day) await this.profit.recomputeOpen(trx, event.tenantId, { currency: d.quote, day: d.day });
      return;
    }
    await this.profit.recompute(trx, event.tenantId, event.entity.id);
    if (event.type === "order.created" || event.type === "order.cancelled") await this.profit.respreadDayOf(trx, event.tenantId, event.entity.id);
  }
}
