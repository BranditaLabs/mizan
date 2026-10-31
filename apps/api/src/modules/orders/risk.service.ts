import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { EventsService } from "../../platform/events/events.service.js";
import { scoreOrder, type RiskFacts, type RiskScore } from "./risk.js";

/** What only the projector knows in the clear (personal data is encrypted once stored). */
export interface PlainFacts { line1Length: number; hasCity: boolean; phoneValid: boolean; totalQuantity: number }

/**
 * Scores a new order (M2, E6-1) as it is projected: the customer's history with this store (by
 * phone), the store's average order, and what the order itself says. Writes risk_score and the
 * reasons (codes and points, no personal data) and emits order.scored.
 */
@Injectable()
export class RiskService {
  constructor(@Inject(EventsService) private readonly events: EventsService) {}

  async score(trx: Transaction<DB>, tenantId: string, orderId: string, plain: PlainFacts): Promise<RiskScore | null> {
    const o = await trx.selectFrom("orders").select(["id", "number", "customer_id", "payment_mode", "payment_status", "paid_minor", "total_minor", "currency", "placed_at", "duplicate_status", "status"])
      .where("id", "=", orderId).executeTakeFirst();
    if (!o || o.status === "cancelled") return null;
    const history = { delivered: 0, refused: 0, cancelled: 0, chargebacks: 0, last24h: 0 };
    if (o.customer_id) {
      const h = await trx.selectFrom("orders").where("customer_id", "=", o.customer_id).where("id", "<>", o.id).select([
        sql<string>`count(*) filter (where status = 'delivered')`.as("delivered"),
        sql<string>`count(*) filter (where status = 'returned' or (status = 'cancelled' and shipped_at is not null))`.as("refused"),
        sql<string>`count(*) filter (where status = 'cancelled' and shipped_at is null and duplicate_status is distinct from 'merged')`.as("cancelled"),
        sql<string>`count(*) filter (where placed_at > ${new Date(o.placed_at.getTime() - 86_400_000)} and placed_at <= ${o.placed_at})`.as("last24h"),
      ]).executeTakeFirstOrThrow();
      const cb = await trx.selectFrom("payments as p").innerJoin("orders as x", "x.id", "p.order_id").select(sql<string>`count(*)`.as("n"))
        .where("x.customer_id", "=", o.customer_id).where("p.kind", "=", "chargeback").executeTakeFirstOrThrow();
      Object.assign(history, { delivered: Number(h.delivered), refused: Number(h.refused), cancelled: Number(h.cancelled), last24h: Number(h.last24h), chargebacks: Number(cb.n) });
    }
    const avg = await trx.selectFrom("orders").select([sql<string | null>`avg(total_minor)`.as("avg"), sql<string>`count(*)`.as("n")])
      .where("currency", "=", o.currency).where("id", "<>", o.id).where("status", "<>", "cancelled")
      .where("placed_at", ">", new Date(o.placed_at.getTime() - 90 * 86_400_000)).executeTakeFirstOrThrow();
    // An average needs a few orders to mean anything.
    const valueRatio = avg.avg && Number(avg.n) >= 5 && Number(avg.avg) > 0 ? Number(o.total_minor) / Number(avg.avg) : null;
    const facts: RiskFacts = {
      paymentMode: o.payment_mode, paid: BigInt(o.paid_minor) > 0n || ["paid", "partially_paid"].includes(o.payment_status), history,
      duplicate: o.duplicate_status === "suspected", address: { line1Length: plain.line1Length, hasCity: plain.hasCity }, phoneValid: plain.phoneValid,
      valueRatio, totalQuantity: plain.totalQuantity,
    };
    const r = scoreOrder(facts);
    await trx.updateTable("orders").set({ risk_score: r.score, risk_reasons: JSON.stringify(r.reasons) }).where("id", "=", o.id).execute();
    await this.events.emit(trx, {
      type: "order.scored", tenantId, entity: { type: "order", id: o.id }, actor: { type: "system" },
      data: { number: o.number, score: r.score, band: r.band, reasons: r.reasons.map((x) => x.code) },
    });
    return r;
  }
}
