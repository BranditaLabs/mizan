import { Inject, Injectable } from "@nestjs/common";
import type { DB } from "@mizan/db";
import { fromMinor, toMinor, type EventActor } from "@mizan/shared";
import type { Transaction } from "kysely";
import { auditActor, AuditService } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import { LedgerService } from "../payments/ledger.service.js";
import type { PartialDeliveryBody, RefusalBody } from "./door.dto.js";

type Trx = Transaction<DB>;
const COLLECTS = new Set(["cod", "partial"]);
const max0 = (v: bigint) => (v > 0n ? v : 0n);

/**
 * What happened at the door (M6, E10-4). A partial delivery: the customer kept some items, the rest
 * comes back — the order is delivered, what they owe becomes the kept items (plus shipping, less
 * discount), the courier's cash goes in the ledger, anything paid beyond it is a refund due, and
 * the rest is inspected when it arrives (E10-3: stock and product cost follow). A refusal: the
 * reason and whether the customer opened the box first (المعاينة), on the order and in an event,
 * so refusals are told apart from plain RTO. Both audited.
 */
@Injectable()
export class DoorService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
  ) {}

  async partialDelivery(auth: AuthContext, orderId: string, body: PartialDeliveryBody, now = new Date()) {
    const tenantId = auth.tenant!.id;
    const actor: EventActor = { type: "user", id: auth.user.id };
    return this.db.tenant(tenantId, async (trx) => {
      const o = await this.lock(trx, orderId);
      if (!["shipped", "delivered"].includes(o.status)) throw new ProblemError(409, "not_shipped", "only an order with the courier, or just delivered, can be partly delivered");
      if (o.partial_items !== null) throw new ProblemError(409, "already_recorded", "this order's partial delivery is already recorded");
      const lines = await trx.selectFrom("order_lines").select(["id", "title", "quantity", "unit_price_minor"]).where("order_id", "=", orderId).orderBy("external_line_id").execute();
      const byId = new Map(lines.map((l) => [l.id, l]));
      const kept = new Map<string, number>();
      for (const [n, k] of body.kept.entries()) {
        if (!byId.has(k.lineId)) throw new ProblemError(422, "validation_failed", "this line is not on the order", [{ path: `kept.${n}.lineId`, code: "not_found", message: k.lineId }]);
        kept.set(k.lineId, (kept.get(k.lineId) ?? 0) + k.quantity);
      }
      const over = [...kept].filter(([id, q]) => q > byId.get(id)!.quantity);
      if (over.length) throw new ProblemError(409, "over_quantity", "more units kept than the order has", over.map(([id, q]) => ({ path: "kept", code: "over_quantity", message: `${byId.get(id)!.title}: ${q}` })));
      const back = lines.map((l) => ({ lineId: l.id, title: l.title, quantity: l.quantity - (kept.get(l.id) ?? 0) })).filter((l) => l.quantity > 0);
      if (!back.length) throw new ProblemError(422, "nothing_returned", "the customer kept everything: that is a full delivery");

      const keptValue = [...kept].reduce((a, [id, q]) => a + BigInt(byId.get(id)!.unit_price_minor) * BigInt(q), 0n);
      const due = max0(keptValue + BigInt(o.shipping_minor) - BigInt(o.discount_minor));
      const held = BigInt(o.paid_minor) - BigInt(o.refunded_minor);
      const owed = max0(due - held);
      const collects = COLLECTS.has(o.payment_mode);
      const collected = collects ? (body.collected !== undefined ? toMinor({ amount: body.collected, currency: o.currency.trim() }) : owed) : 0n;
      if (collected > owed) throw new ProblemError(409, "over_collected", "more cash than the kept items owe");

      const items = [...kept].map(([lineId, quantity]) => ({ lineId, quantity }));
      await trx.updateTable("orders").set({
        partial_items: JSON.stringify(items), partial_due_minor: due, partial_at: now, status: "delivered", delivered_at: o.delivered_at ?? now,
        ...(collects ? { cod_minor: owed } : {}),
        // Paid beforehand at least what they kept (a deposit): nothing is owed any more.
        ...(held >= due && held > 0n && ["unpaid", "partially_paid", "authorized"].includes(o.payment_status) ? { payment_status: "paid" } : {}),
        updated_at: now,
      }).where("id", "=", orderId).execute();
      if (collected > 0n) {
        await this.ledger.post(trx, tenantId, orderId, {
          kind: "cod_collection", method: "cod", source: "courier", amountMinor: collected, currency: o.currency.trim(),
          externalRef: `partial:${orderId}`, recordedBy: auth.user.id, note: body.note ?? null, eventData: { partial: true },
        }, actor);
      }
      const m = (minor: bigint) => fromMinor(minor, o.currency.trim());
      const data = { number: o.number, kept: items.length, comingBack: back.reduce((a, b) => a + b.quantity, 0), dueMinor: String(due), collectedMinor: String(collected), currency: o.currency.trim() };
      await trx.insertInto("order_events").values({
        tenant_id: tenantId, order_id: orderId, type: "partially_delivered", from_status: o.status, to_status: "delivered", actor_type: "user", actor_id: auth.user.id,
        data: JSON.stringify({ ...data, ...(body.note ? { note: body.note } : {}) }),
      }).execute();
      await this.events.emit(trx, { type: "order.partially_delivered", tenantId, entity: { type: "order", id: orderId }, actor, data });
      // Delivered now: stock, profit and automations follow the order like any status change.
      await this.events.emit(trx, { type: "order.updated", tenantId, entity: { type: "order", id: orderId }, actor, data: { number: o.number, status: "delivered", changed: ["status", "due"] } });
      await this.audit.record(trx, { action: "order.partial_delivery_recorded", tenantId, entity: { type: "order", id: orderId }, after: data, ...auditActor(auth) });
      return {
        orderId, status: "delivered", due: m(due), collected: m(collected), refundDue: m(max0(held - due)),
        kept: items.map((i) => ({ ...i, title: byId.get(i.lineId)!.title })), comingBack: back,
      };
    });
  }

  async refusal(auth: AuthContext, orderId: string, body: RefusalBody, now = new Date()) {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const o = await this.lock(trx, orderId);
      if (!["shipped", "returned"].includes(o.status)) throw new ProblemError(409, "not_shipped", "only an order with the courier, or returned, was refused at the door");
      await trx.updateTable("orders").set({ refusal_reason: body.reason, refusal_open_box: body.openBox, refused_at: now, updated_at: now }).where("id", "=", orderId).execute();
      const data = { number: o.number, reason: body.reason, openBox: body.openBox, status: o.status, ...(o.refusal_reason ? { corrected: o.refusal_reason } : {}) };
      await trx.insertInto("order_events").values({
        tenant_id: tenantId, order_id: orderId, type: "refused", actor_type: "user", actor_id: auth.user.id, data: JSON.stringify({ ...data, ...(body.note ? { note: body.note } : {}) }),
      }).execute();
      await this.events.emit(trx, { type: "order.refused", tenantId, entity: { type: "order", id: orderId }, actor: { type: "user", id: auth.user.id }, data });
      await this.audit.record(trx, { action: "order.refusal_recorded", tenantId, entity: { type: "order", id: orderId }, after: data, ...auditActor(auth) });
      return { orderId, reason: body.reason, openBox: body.openBox, at: now.toISOString() };
    });
  }

  private async lock(trx: Trx, orderId: string) {
    const o = await trx.selectFrom("orders").select(["id", "number", "status", "currency", "payment_mode", "payment_status", "paid_minor", "refunded_minor", "shipping_minor", "discount_minor", "delivered_at", "partial_items", "refusal_reason"])
      .where("id", "=", orderId).forUpdate().executeTakeFirst();
    if (!o) throw new ProblemError(404, "not_found", "order not found");
    return o;
  }
}
