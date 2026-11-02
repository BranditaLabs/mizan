import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { fromMinor, type DomainEvent, type EventActor } from "@mizan/shared";
import { auditActor, AuditService } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import { PiiCipher } from "../../platform/pii/pii-cipher.js";
import { buildManualOrder, type CatalogueVariant } from "../orders/manual-order.js";
import { OrderProjector } from "../orders/order-projector.js";
import { LedgerService } from "../payments/ledger.service.js";
import type { ExchangeView, NewExchange } from "./exchanges.dto.js";

type Trx = Transaction<DB>;
type Item = { lineId: string; quantity: number };
const minOf = (a: bigint, b: bigint) => (a < b ? a : b);

/**
 * Exchanges (M6, E10-2): items from a delivered order come back, others go out on a replacement
 * order linked both ways. What the customer already paid for the returned items (the original's
 * money in, less refunds and earlier exchanges) moves as store credit — a refund line on the
 * original and a sale line on the replacement — so revenue is counted once; the difference is
 * collected on delivery, or is a refund due when the replacement costs less. The replacement is
 * confirmed (the customer asked for it) and ships like any order. The exchange waits until the
 * return inspection on the original covers the items (stock and profit follow inspection, E10-3).
 */
@Injectable()
export class ExchangesService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(PiiCipher) private readonly cipher: PiiCipher,
    @Inject(OrderProjector) private readonly projector: OrderProjector,
    @Inject(LedgerService) private readonly ledger: LedgerService,
  ) {}

  async create(auth: AuthContext, body: NewExchange, now = new Date()): Promise<ExchangeView> {
    const tenantId = auth.tenant!.id;
    const actor: EventActor = { type: "user", id: auth.user.id };
    return this.db.tenant(tenantId, async (trx) => {
      const o = await trx.selectFrom("orders").selectAll().where("id", "=", body.orderId).forUpdate().executeTakeFirst();
      if (!o) throw new ProblemError(404, "not_found", "order not found");
      if (o.status !== "delivered") throw new ProblemError(409, "not_delivered", "only a delivered order's items can be exchanged");
      if (o.pii_redacted_at) throw new ProblemError(409, "redacted", "the customer's details were deleted");
      if (body.ticketId) {
        const tk = await trx.selectFrom("tickets").select("order_id").where("id", "=", body.ticketId).executeTakeFirst();
        if (!tk || tk.order_id !== o.id) throw new ProblemError(422, "validation_failed", "the ticket is not on this order", [{ path: "ticketId", code: "not_found", message: body.ticketId }]);
      }

      // What comes back: never more than the line holds, less what earlier exchanges took.
      const lines = new Map((await trx.selectFrom("order_lines").select(["id", "title", "quantity", "unit_price_minor"]).where("order_id", "=", o.id).execute()).map((l) => [l.id, l]));
      const earlier = await trx.selectFrom("exchanges").select(["items", "credit_minor"]).where("original_order_id", "=", o.id).execute();
      const taken = new Map<string, number>();
      for (const e of earlier) for (const i of e.items as Item[]) taken.set(i.lineId, (taken.get(i.lineId) ?? 0) + i.quantity);
      const asked = new Map<string, number>();
      for (const [n, i] of body.items.entries()) {
        if (!lines.has(i.lineId)) throw new ProblemError(422, "validation_failed", "this line is not on the order", [{ path: `items.${n}.lineId`, code: "not_found", message: i.lineId }]);
        asked.set(i.lineId, (asked.get(i.lineId) ?? 0) + i.quantity);
      }
      const over = [...asked].filter(([id, q]) => q > lines.get(id)!.quantity - (taken.get(id) ?? 0));
      if (over.length) throw new ProblemError(409, "over_quantity", "more units than the order has left to exchange", over.map(([id, q]) => ({ path: "items", code: "over_quantity", message: `${lines.get(id)!.title}: ${q}` })));
      const items: Item[] = [...asked].map(([lineId, quantity]) => ({ lineId, quantity }));
      const returnedValue = items.reduce((a, i) => a + BigInt(lines.get(i.lineId)!.unit_price_minor) * BigInt(i.quantity), 0n);

      // The replacement: the same customer and address, confirmed, numbered after the original.
      const pii = await this.cipher.forTenant(trx, tenantId);
      const ids = [...new Set(body.lines.flatMap((l) => (l.variantId ? [l.variantId] : [])))];
      const rows = ids.length ? await trx.selectFrom("variants as v").innerJoin("products as p", "p.id", "v.product_id")
        .select(["v.id", "v.sku", "v.title", "p.title as product", "v.price_minor", "v.currency"]).where("v.id", "in", ids).where("p.status", "=", "active").execute() : [];
      const variants = new Map<string, CatalogueVariant>(rows.map((v) => [v.id, { id: v.id, sku: v.sku, title: v.title ? `${v.product} — ${v.title}` : v.product, priceMinor: BigInt(v.price_minor), currency: v.currency.trim() }]));
      const t = await trx.selectFrom("tenants").select(["country", "base_currency"]).where("id", "=", tenantId).executeTakeFirstOrThrow();
      const built = buildManualOrder({
        source: "other",
        customer: { name: pii.decrypt(o.ship_name, "orders.ship_name") ?? "", phone: pii.decrypt(o.ship_phone, "orders.ship_phone") ?? "" },
        address: { line1: pii.decrypt(o.ship_line1, "orders.ship_line1") ?? "", line2: pii.decrypt(o.ship_line2, "orders.ship_line2") ?? undefined, city: o.ship_city ?? "", province: o.ship_province ?? undefined },
        lines: body.lines, shipping: body.shipping, discount: "0", payment: { mode: "cod" },
      }, { variants, baseCurrency: o.currency.trim(), country: t.country.trim(), number: `${o.number}-X${earlier.length + 1}`, externalId: `exchange:${randomUUID()}`, now });
      if ("error" in built) throw new ProblemError(422, built.error, built.error === "currency_mismatch" ? "the products are in different currencies" : "the replacement is not valid");
      if (built.order.currency !== o.currency.trim()) throw new ProblemError(422, "currency_mismatch", `the original order is in ${o.currency.trim()}`);
      const r = await this.projector.projectIn(trx, tenantId, null, built.order, { channel: "manual", actor: { type: "user", id: auth.user.id }, variantIds: built.variantIds });
      const replacement = await trx.selectFrom("orders").select(["id", "number", "total_minor"]).where("id", "=", r.orderId).executeTakeFirstOrThrow();
      await trx.updateTable("orders").set({ status: "confirmed", confirmed_at: now, updated_at: now }).where("id", "=", replacement.id).execute();

      // Credit: what the customer paid for the returned items, never more than the original still holds.
      const held = BigInt(o.paid_minor) - BigInt(o.refunded_minor);
      const credit = minOf(returnedValue, held > 0n ? held : 0n);
      const applied = minOf(credit, BigInt(replacement.total_minor));
      const refundDue = credit - applied;
      const exchange = await trx.insertInto("exchanges").values({
        tenant_id: tenantId, original_order_id: o.id, replacement_order_id: replacement.id, ticket_id: body.ticketId ?? null, reason: body.reason, note: body.note ?? null,
        items: JSON.stringify(items), currency: o.currency.trim(), returned_value_minor: returnedValue, credit_minor: applied, refund_due_minor: refundDue, created_by: auth.user.id, created_at: now,
      }).returning("id").executeTakeFirstOrThrow();
      if (applied > 0n) {
        const line = { method: "store_credit", source: "manual" as const, currency: o.currency.trim(), recordedBy: auth.user.id, note: `exchange ${replacement.number}`, eventData: { exchangeId: exchange.id } };
        await this.ledger.post(trx, tenantId, o.id, { ...line, kind: "refund", amountMinor: -applied, externalRef: `exchange:${exchange.id}:out` }, actor);
        await this.ledger.post(trx, tenantId, replacement.id, { ...line, kind: "sale", amountMinor: applied, externalRef: `exchange:${exchange.id}:in` }, actor);
      }
      const link = { exchangeId: exchange.id, original: o.number, replacement: replacement.number };
      await trx.insertInto("order_events").values([
        { tenant_id: tenantId, order_id: o.id, type: "exchange_created", actor_type: "user", actor_id: auth.user.id, data: JSON.stringify({ ...link, into: replacement.number }) },
        { tenant_id: tenantId, order_id: replacement.id, type: "exchange_created", actor_type: "user", actor_id: auth.user.id, data: JSON.stringify({ ...link, of: o.number }) },
      ]).execute();
      const data = { ...link, originalId: o.id, replacementId: replacement.id, reason: body.reason, items: items.length, returnedValueMinor: String(returnedValue), creditMinor: String(applied), refundDueMinor: String(refundDue), currency: o.currency.trim() };
      await this.events.emit(trx, { type: "exchange.created", tenantId, entity: { type: "order", id: o.id }, actor, data });
      // The replacement is confirmed: stock reserves it and profit follows, like any confirmed order.
      await this.events.emit(trx, { type: "order.confirmed", tenantId, entity: { type: "order", id: replacement.id }, actor, data: { number: replacement.number, channel: "exchange" } });
      await this.audit.record(trx, { action: "exchange.created", tenantId, entity: { type: "order", id: o.id }, after: data, ...auditActor(auth) });
      return (await this.views(trx, sql`e.id = ${exchange.id}`))[0]!;
    });
  }

  async forOrder(tenantId: string, orderId: string) {
    return this.db.tenant(tenantId, async (trx) => {
      if (!(await trx.selectFrom("orders").select("id").where("id", "=", orderId).executeTakeFirst())) throw new ProblemError(404, "not_found", "order not found");
      const outgoing = await this.views(trx, sql`e.original_order_id = ${orderId}`);
      const of = await this.views(trx, sql`e.replacement_order_id = ${orderId}`);
      return { outgoing, exchangeOf: of[0] ?? null };
    });
  }

  /** E10-3 inspected what came back: an exchange whose items are all inspected is returned. */
  async onInspected(trx: Trx, event: DomainEvent, now = new Date()) {
    const orderId = event.entity.id;
    const open = await trx.selectFrom("exchanges").select(["id", "items", "replacement_order_id"]).where("original_order_id", "=", orderId).where("status", "=", "awaiting_return")
      .orderBy("created_at").forUpdate().execute();
    if (!open.length) return;
    const inspected = new Map((await trx.selectFrom("return_inspections").select(["order_line_id", sql<string>`sum(quantity)`.as("n")]).where("order_id", "=", orderId).groupBy("order_line_id").execute())
      .map((r) => [r.order_line_id, Number(r.n)]));
    // Earlier exchanges take the inspected units first.
    for (const e of open) {
      const items = e.items as Item[];
      if (!items.every((i) => (inspected.get(i.lineId) ?? 0) >= i.quantity)) break;
      for (const i of items) inspected.set(i.lineId, inspected.get(i.lineId)! - i.quantity);
      await trx.updateTable("exchanges").set({ status: "returned", returned_at: now }).where("id", "=", e.id).execute();
      await this.events.emit(trx, { type: "exchange.returned", tenantId: event.tenantId, entity: { type: "order", id: orderId }, actor: event.actor ?? { type: "system" }, data: { exchangeId: e.id, replacementId: e.replacement_order_id } });
    }
  }

  private async views(trx: Trx, where: ReturnType<typeof sql>): Promise<ExchangeView[]> {
    const rows = await trx.selectFrom("exchanges as e").innerJoin("orders as o", "o.id", "e.original_order_id").innerJoin("orders as r", "r.id", "e.replacement_order_id")
      .select(["e.id", "e.reason", "e.note", "e.status", "e.items", "e.currency", "e.returned_value_minor", "e.credit_minor", "e.refund_due_minor", "e.created_at", "e.returned_at",
        "o.id as original_id", "o.number as original_number", "r.id as replacement_id", "r.number as replacement_number", "r.status as replacement_status", "r.cod_minor as replacement_cod"])
      .where(where as never).orderBy("e.created_at").execute();
    const titles = new Map((rows.length ? await trx.selectFrom("order_lines").select(["id", "title"]).where("id", "in", rows.flatMap((r) => (r.items as Item[]).map((i) => i.lineId))).execute() : []).map((l) => [l.id, l.title]));
    return rows.map((r) => {
      const m = (minor: string | number | bigint) => fromMinor(BigInt(minor), r.currency.trim());
      return {
        id: r.id, original: { id: r.original_id, number: r.original_number }, replacement: { id: r.replacement_id, number: r.replacement_number, status: r.replacement_status },
        reason: r.reason as ExchangeView["reason"], note: r.note, status: r.status as ExchangeView["status"],
        items: (r.items as Item[]).map((i) => ({ lineId: i.lineId, title: titles.get(i.lineId) ?? "", quantity: i.quantity })),
        returnedValue: m(r.returned_value_minor), credit: m(r.credit_minor), toCollect: m(r.replacement_cod), refundDue: m(r.refund_due_minor),
        createdAt: r.created_at.toISOString(), returnedAt: r.returned_at?.toISOString() ?? null,
      };
    });
  }
}
