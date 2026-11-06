import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { DomainEvent } from "@mizan/shared";
import { AuditService } from "../../platform/audit/audit.service.js";
import { EventsService } from "../../platform/events/events.service.js";
import { EventConsumer, type EventHandler } from "../../platform/events/consumer.js";
import { ProblemError } from "../../platform/http/problem.js";
import { ShippingService } from "./shipping.service.js";

/**
 * A confirmed order released for automatic booking (E6-23a, order.ready_to_ship): booked with the
 * courier through the same path as the Ship button (a shipments row, the courier job, the cash to
 * collect read when the job runs: rule 13). Everything that could have changed since the release
 * is checked again here, in the booking's transaction. A refusal never fails the event: it is
 * said as order.auto_ship_blocked (with retry when an offer or edit is still being applied).
 */
@Injectable()
@EventConsumer({ name: "shipping.auto-book", events: ["order.ready_to_ship"] })
export class AutoBookConsumer implements EventHandler {
  constructor(
    @Inject(ShippingService) private readonly shipping: ShippingService,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async handle(event: DomainEvent, trx: Transaction<DB>): Promise<void> {
    const t = event.tenantId;
    const orderId = event.entity.id;
    const d = event.data as { number?: string; followupId?: string; courierConnectionId?: string | null };
    const blocked = async (code: string, retry = false): Promise<void> => {
      await this.events.emit(trx, {
        type: "order.auto_ship_blocked", tenantId: t, entity: { type: "order", id: orderId }, actor: { type: "system" },
        data: { number: d.number ?? "", followupId: d.followupId ?? null, code, retry, source: "shipping" },
      });
    };
    const o = await trx.selectFrom("orders").select(["status", "payment_mode", "stock_status", "duplicate_status"]).where("id", "=", orderId).forUpdate().executeTakeFirst();
    if (!o || o.status !== "confirmed") return blocked("order_moved");
    if (o.payment_mode === "unknown") return blocked("payment_mode_not_allowed");
    if (o.stock_status === "short") return blocked("stock_short");
    if (o.duplicate_status === "suspected") return blocked("duplicate_suspected");
    const settling = await trx.selectFrom("order_offers").select("id").where("order_id", "=", orderId).where("status", "in", ["accepted", "applying"]).executeTakeFirst()
      ?? await trx.selectFrom("order_edits").select("id").where("order_id", "=", orderId).where("status", "=", "sending").executeTakeFirst();
    if (settling) return blocked("offer_settling", true);

    const now = new Date(event.occurredAt);
    await sql`savepoint auto_book`.execute(trx);
    try {
      const r = await this.shipping.book(trx, t, orderId, null, now, { source: "auto" }, { courierConnectionId: d.courierConnectionId ?? null });
      await sql`release savepoint auto_book`.execute(trx);
      if (r.created) {
        await this.audit.record(trx, { action: "shipment.requested", tenantId: t, entity: { type: "order", id: orderId }, after: { shipmentId: r.shipment.id, provider: r.shipment.provider, source: "after_confirmation" }, actor: { type: "system" } });
      }
    } catch (err) {
      await sql`rollback to savepoint auto_book`.execute(trx);
      if (err instanceof ProblemError && err.code) return blocked(err.code === "payment_blocks_shipping" ? "payment_blocks_shipping" : err.code);
      throw err;
    }
  }
}
