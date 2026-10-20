import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { cashToCollect, type ShipBlockReason } from "@mizan/engine";
import { normalizePhone, toMinor, type CanonicalOrder } from "@mizan/shared";
import { phoneCountryOf } from "../../platform/pii/phone-country.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { PiiCipher, type TenantPii } from "../../platform/pii/pii-cipher.js";

/** Order statuses an incoming cancellation may still override (before it leaves the warehouse). */
const CANCELLABLE = new Set(["new", "pending_confirmation", "confirmed"]);
/** Canonical payment statuses the orders table stores as-is; "unknown" is stored as unpaid. */
const PAYMENT_STATUSES = new Set(["unpaid", "authorized", "partially_paid", "paid", "partially_refunded", "refunded", "failed", "voided"]);

/** Business fields compared to decide whether an update is worth an event. */
/** Personal data columns of an order, as they are after redaction. */
export const REDACTED_ORDER = { ship_name: null, ship_phone: null, ship_line1: null, ship_line2: null, ship_lat: null, ship_lng: null } as const;

const TRACKED = ["status", "payment_mode", "payment_status", "total_minor", "paid_minor", "refunded_minor", "cod_minor", "tags"] as const;
const PAYMENT_FIELDS = new Set<string>(["payment_status", "paid_minor", "refunded_minor"]);

type LedgerMethod = "cod" | "card" | "wallet" | "apple_pay" | "bnpl" | "bank_transfer" | "instapay";

/** Ledger method for money received on an order (docs/12 §3). Deposits are paid online; the rest of a deposit order is cash. */
export function ledgerMethod(order: CanonicalOrder, firstMoneyIn: boolean): LedgerMethod {
  const gw = order.gateways.join(" ").toLowerCase();
  switch (order.paymentMode) {
    case "cod": return "cod";
    case "partial": return firstMoneyIn ? onlineMethod(gw) : "cod";
    case "bnpl": return "bnpl";
    case "bank_transfer": return /instapay/.test(gw) ? "instapay" : "bank_transfer";
    default: return onlineMethod(gw);
  }
}
const onlineMethod = (gw: string): LedgerMethod => (/apple/.test(gw) ? "apple_pay" : /wallet|vodafone|meeza|fawry ?pay/.test(gw) ? "wallet" : "card");

export interface ProjectResult {
  orderId: string;
  created: boolean;
  changed: string[];
}

/**
 * Projects canonical orders from store connections into Mizan's orders,
 * order_lines and customers (module M1), in one tenant transaction:
 *
 * - idempotent: keyed by (tenant, connection, external id); replaying the same
 *   order changes nothing and emits nothing;
 * - personal data (names, phones, address lines, email) is encrypted with the
 *   tenant's key; customers are matched by an HMAC of the E.164 phone;
 * - emits order.created / order.updated / order.cancelled in the same transaction.
 */
@Injectable()
export class OrderProjector {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(PiiCipher) private readonly cipher: PiiCipher,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  async project(tenantId: string, connectionId: string, order: CanonicalOrder): Promise<ProjectResult> {
    return this.db.tenant(tenantId, async (trx) => {
      const pii = await this.cipher.forTenant(trx, tenantId);
      const phoneCountry = await phoneCountryOf(trx, tenantId);

      const existing = await trx.selectFrom("orders").select(["id", "customer_id", "pii_redacted_at", ...TRACKED])
        .where("connection_id", "=", connectionId).where("external_id", "=", order.externalId).forUpdate().executeTakeFirst();
      // A redacted order (E3-3) keeps its business facts; its personal data never comes back.
      const redacted = Boolean(existing?.pii_redacted_at);

      const rawPhone = order.shippingAddress?.phone ?? order.customer.phone;
      const phone = redacted ? undefined : normalizePhone(rawPhone, phoneCountry);
      const customerId = redacted ? existing!.customer_id : phone ? await this.upsertCustomer(trx, tenantId, pii, order, phone.e164) : null;

      const values = { ...this.orderValues(order, pii, phone?.e164 ?? rawPhone ?? null), ...(redacted ? REDACTED_ORDER : {}) };

      if (!existing) {
        const row = await trx.insertInto("orders").values({
          tenant_id: tenantId, connection_id: connectionId, external_id: order.externalId, customer_id: customerId,
          ...values, status: order.cancelled ? "cancelled" : "new", placed_at: order.createdAt,
        }).returning(["id", "status"]).executeTakeFirstOrThrow();
        await this.syncLines(trx, tenantId, row.id, order);
        await this.syncLedger(trx, tenantId, row.id, connectionId, order, { paid: 0n, refunded: 0n }, { paid: values.paid_minor, refunded: values.refunded_minor });
        if (customerId) {
          await trx.updateTable("customers").set((eb) => ({ orders_count: eb("orders_count", "+", 1) })).where("id", "=", customerId).execute();
        }
        await trx.insertInto("order_events").values({ tenant_id: tenantId, order_id: row.id, type: "created", to_status: row.status, actor_type: "system", data: JSON.stringify({ source: order.connector }) }).execute();
        await this.events.emit(trx, { type: "order.created", tenantId, entity: { type: "order", id: row.id }, actor: { type: "engine" }, data: this.eventData(order, row.status, values) });
        if (row.status === "cancelled") {
          await this.events.emit(trx, { type: "order.cancelled", tenantId, entity: { type: "order", id: row.id }, actor: { type: "engine" }, data: { number: order.number, reason: "cancelled_in_store" } });
        }
        return { orderId: row.id, created: true, changed: [] };
      }

      const status = order.cancelled && CANCELLABLE.has(existing.status) ? "cancelled" : existing.status;
      const next = { ...values, status };
      const changed = TRACKED.filter((k) => JSON.stringify(normalize(existing[k])) !== JSON.stringify(normalize(next[k])));
      await trx.updateTable("orders").set({
        ...values, status, customer_id: customerId, updated_at: new Date(),
        ...(status === "cancelled" && existing.status !== "cancelled" ? { cancelled_at: new Date() } : {}),
      }).where("id", "=", existing.id).execute();
      await this.syncLines(trx, tenantId, existing.id, order);
      await this.syncLedger(trx, tenantId, existing.id, connectionId, order,
        { paid: existing.paid_minor, refunded: existing.refunded_minor }, { paid: values.paid_minor, refunded: values.refunded_minor });

      if (changed.some((c) => PAYMENT_FIELDS.has(c))) {
        await trx.insertInto("order_events").values({
          tenant_id: tenantId, order_id: existing.id, type: "payment_changed", actor_type: "system",
          data: JSON.stringify({ from: existing.payment_status, to: values.payment_status }),
        }).execute();
        await this.events.emit(trx, {
          type: "order.payment_changed", tenantId, entity: { type: "order", id: existing.id }, actor: { type: "engine" },
          data: {
            number: order.number, mode: values.payment_mode, from: existing.payment_status, to: values.payment_status,
            paidMinor: String(values.paid_minor), refundedMinor: String(values.refunded_minor), currency: values.currency,
          },
        });
      }

      if (changed.length) {
        await trx.insertInto("order_events").values({
          tenant_id: tenantId, order_id: existing.id, type: "updated", from_status: existing.status, to_status: status,
          actor_type: "system", data: JSON.stringify({ changed, source: order.connector }),
        }).execute();
        await this.events.emit(trx, { type: "order.updated", tenantId, entity: { type: "order", id: existing.id }, actor: { type: "engine" }, data: { ...this.eventData(order, status, values), changed } });
        if (status === "cancelled" && existing.status !== "cancelled") {
          await this.events.emit(trx, { type: "order.cancelled", tenantId, entity: { type: "order", id: existing.id }, actor: { type: "engine" }, data: { number: order.number, reason: "cancelled_in_store" } });
        }
      }
      return { orderId: existing.id, created: false, changed };
    });
  }

  /**
   * A confirmed order is held because of its payment. Recorded once per
   * reason until the payment changes (webhooks re-deliver the same state).
   */
  async awaitingPayment(tenantId: string, connectionId: string, order: CanonicalOrder, reason: ShipBlockReason): Promise<boolean> {
    return this.db.tenant(tenantId, async (trx) => {
      const row = await trx.selectFrom("orders").select(["id"]).where("connection_id", "=", connectionId).where("external_id", "=", order.externalId).forUpdate().executeTakeFirst();
      if (!row) return false; // projected first by hooks.onOrder; nothing to flag otherwise
      const last = await trx.selectFrom("order_events").select(["type", "data"]).where("order_id", "=", row.id)
        .where("type", "in", ["awaiting_payment", "payment_changed"]).orderBy("created_at", "desc").orderBy("id", "desc").limit(1).executeTakeFirst();
      const lastReason = last?.type === "awaiting_payment" ? (typeof last.data === "string" ? JSON.parse(last.data) : last.data)?.reason : undefined;
      if (lastReason === reason) return false;
      await trx.insertInto("order_events").values({ tenant_id: tenantId, order_id: row.id, type: "awaiting_payment", actor_type: "system", data: JSON.stringify({ reason }) }).execute();
      await this.events.emit(trx, {
        type: "order.awaiting_payment", tenantId, entity: { type: "order", id: row.id }, actor: { type: "engine" },
        data: { number: order.number, reason, mode: order.paymentMode, status: order.paymentStatus },
      });
      return true;
    });
  }

  /**
   * Payment ledger (docs/12 §3) from the store's running totals: each change in
   * received or refunded becomes one line for the difference, keyed by the new
   * total, so replays never double-count. Keeps paid_minor = Σ money-in lines
   * and refunded_minor = −Σ refund lines.
   */
  private async syncLedger(
    trx: Transaction<DB>, tenantId: string, orderId: string, connectionId: string, order: CanonicalOrder,
    before: { paid: bigint; refunded: bigint }, after: { paid: bigint; refunded: bigint },
  ) {
    const lines: Array<{ kind: "sale" | "cod_collection" | "refund" | "void"; method: LedgerMethod; amount: bigint; ref: string }> = [];
    if (after.paid !== before.paid) {
      const method = ledgerMethod(order, before.paid === 0n);
      const kind = after.paid < before.paid ? "void" : method === "cod" ? "cod_collection" : "sale";
      lines.push({ kind, method, amount: after.paid - before.paid, ref: `${order.externalId}:in:${after.paid}` });
    }
    if (after.refunded > before.refunded) {
      lines.push({ kind: "refund", method: ledgerMethod(order, false), amount: -(after.refunded - before.refunded), ref: `${order.externalId}:refund:${after.refunded}` });
    }
    for (const l of lines) {
      await trx.insertInto("payments").values({
        tenant_id: tenantId, order_id: orderId, connection_id: connectionId, method: l.method, kind: l.kind, status: "succeeded",
        amount_minor: l.amount, currency: order.currency, external_ref: l.ref, occurred_at: order.updatedAt,
      }).onConflict((oc) => oc.columns(["connection_id", "external_ref", "kind"]).doNothing()).execute();
    }
  }

  private orderValues(order: CanonicalOrder, pii: TenantPii, shipPhone: string | null) {
    const minor = (m: CanonicalOrder["total"] | undefined) => (m ? toMinor({ ...m, currency: m.currency || order.currency }) : 0n);
    let cod = 0n;
    try {
      cod = minor(cashToCollect(order));
    } catch {
      cod = 0n; // not shippable yet (awaiting payment, unknown method): nothing to collect
    }
    const a = order.shippingAddress;
    return {
      number: order.number,
      currency: order.currency,
      subtotal_minor: minor(order.subtotal),
      shipping_minor: minor(order.shipping),
      total_minor: minor(order.total),
      cod_minor: cod,
      payment_mode: order.paymentMode,
      payment_status: PAYMENT_STATUSES.has(order.paymentStatus) ? order.paymentStatus : "unpaid",
      paid_minor: minor(order.received),
      refunded_minor: minor(order.refunded),
      tags: order.tags,
      ship_name: pii.encrypt(a?.name ?? order.customer.name, "orders.ship_name"),
      ship_phone: pii.encrypt(shipPhone, "orders.ship_phone"),
      ship_line1: pii.encrypt(a?.line1, "orders.ship_line1"),
      ship_line2: pii.encrypt(a?.line2, "orders.ship_line2"),
      ship_city: a?.city ?? null,
      ship_province: a?.province ?? null,
      ship_country: a?.countryCode ?? null,
    };
  }

  private async upsertCustomer(trx: Transaction<DB>, tenantId: string, pii: TenantPii, order: CanonicalOrder, e164: string): Promise<string> {
    const phoneHash = pii.phoneHash(e164);
    const inserted = await trx.insertInto("customers").values({
      tenant_id: tenantId,
      phone_hash: phoneHash,
      phone_e164: pii.encrypt(e164, "customers.phone_e164"),
      name: pii.encrypt(order.customer.name, "customers.name"),
      email: pii.encrypt(order.customer.email, "customers.email"),
    }).onConflict((oc) => oc.columns(["tenant_id", "phone_hash"]).doNothing()).returning("id").executeTakeFirst();
    if (inserted) return inserted.id;
    const row = await trx.selectFrom("customers").select("id").where("phone_hash", "=", phoneHash).executeTakeFirstOrThrow();
    return row.id;
  }

  /** Lines follow the store: update by external line id, add new ones, remove vanished ones. */
  private async syncLines(trx: Transaction<DB>, tenantId: string, orderId: string, order: CanonicalOrder) {
    const current = await trx.selectFrom("order_lines").select(["id", "external_line_id"]).where("order_id", "=", orderId).execute();
    const byExt = new Map(current.map((l) => [l.external_line_id, l.id]));
    const keep = new Set<string>();
    for (const line of order.lines.filter((l) => l.quantity > 0)) {
      const values = {
        sku: line.sku ?? null, title: line.title, quantity: line.quantity,
        unit_price_minor: toMinor({ ...line.unitPrice, currency: line.unitPrice.currency || order.currency }),
      };
      const id = byExt.get(line.externalLineId);
      if (id) {
        keep.add(id);
        await trx.updateTable("order_lines").set(values).where("id", "=", id).execute();
      } else {
        await trx.insertInto("order_lines").values({ tenant_id: tenantId, order_id: orderId, external_line_id: line.externalLineId, ...values }).execute();
      }
    }
    const remove = current.filter((l) => !keep.has(l.id)).map((l) => l.id);
    if (remove.length) await trx.deleteFrom("order_lines").where("id", "in", remove).execute();
  }

  /** Ids and business facts only: no names, phones or addresses in events. */
  private eventData(order: CanonicalOrder, status: string, v: Pick<ReturnType<OrderProjector["orderValues"]>, "currency" | "total_minor" | "cod_minor" | "payment_mode" | "payment_status">) {
    return {
      number: order.number, status, source: order.connector, externalId: order.externalId,
      currency: v.currency, totalMinor: String(v.total_minor), codMinor: String(v.cod_minor),
      paymentMode: v.payment_mode, paymentStatus: v.payment_status, lines: order.lines.length,
    };
  }
}

const normalize = (v: unknown) => (typeof v === "bigint" ? v.toString() : Array.isArray(v) ? [...v].sort() : v);
