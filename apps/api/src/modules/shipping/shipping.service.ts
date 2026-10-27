import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import { trxQueryClient, type DB } from "@mizan/db";
import { cashToCollect, MizanEngine, ShipBlockedError, SqlStore, type ShipOutcome } from "@mizan/engine";
import { fromMinor, SHIPMENT_STATUSES, toMinor, type CanonicalOrder, type PaymentMode, type PaymentStatus } from "@mizan/shared";
import { ENGINE_RUNTIME, type RuntimeFactory } from "../../integrations/engine-registry.js";
import { auditActor, AuditService } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import { PiiCipher } from "../../platform/pii/pii-cipher.js";
import type { ShipmentResultSink } from "./ports.js";
import type { BOOKING_ERRORS, ShipmentView } from "./shipping.dto.js";

type Trx = Transaction<DB>;
type BookingError = (typeof BOOKING_ERRORS)[number];
type Row = {
  id: string; order_id: string; provider: string; booking: string; status: string; tracking_number: string | null; tracking_url: string | null;
  cod_minor: string | number | bigint; currency: string; error_code: string | null; error: string | null; created_at: Date; booked_at: Date | null;
};
const SHIPMENT_COLUMNS = ["id", "order_id", "provider", "booking", "status", "tracking_number", "tracking_url", "cod_minor", "currency", "error_code", "error", "created_at", "booked_at"] as const;
const DB_STATUSES = new Set<string>(SHIPMENT_STATUSES.filter((s) => s !== "exception"));

/**
 * M3 shipping (E7-1): a confirmed order handed to the courier. Asking to ship records the shipment
 * (booking = pending) and queues the courier job in one transaction (rule 3); the engine reads the
 * order through `loadOrder` (the address and phone never go into a job), books it once (a lost
 * answer is found by its reference) with cashToCollect(order), and reports back to `recordResult`:
 * the tracking number and the order shipped, or why the courier or the order refused.
 */
@Injectable()
export class ShippingService implements ShipmentResultSink {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(PiiCipher) private readonly cipher: PiiCipher,
    @Inject(ENGINE_RUNTIME) private readonly runtime: RuntimeFactory,
  ) {}

  /** Ship an order: idempotent — while a booking is pending or booked, asking again returns it. */
  async ship(auth: AuthContext, orderId: string, now = new Date()): Promise<{ created: boolean; shipment: ShipmentView }> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const o = await trx.selectFrom("orders as o").leftJoin("connections as c", "c.id", "o.connection_id")
        .select(["o.id", "o.number", "o.status", "o.currency", "o.total_minor", "o.paid_minor", "o.refunded_minor", "o.payment_mode", "o.payment_status",
          "o.ship_line1", "o.ship_city", "o.ship_phone", "o.external_id", "o.connection_id", "c.provider as store_provider", "c.status as store_status"])
        .where("o.id", "=", orderId).forUpdate("o").executeTakeFirst();
      if (!o) throw new ProblemError(404, "not_found", "order not found");
      const live = await trx.selectFrom("shipments").select([...SHIPMENT_COLUMNS]).where("order_id", "=", orderId).where("is_return_leg", "=", false)
        .where("booking", "!=", "failed").where("status", "!=", "cancelled").executeTakeFirst();
      if (live) return { created: false, shipment: view(live) };
      if (o.status !== "confirmed") throw new ProblemError(409, "not_confirmed", o.status === "cancelled" ? "the order is cancelled" : "only a confirmed order ships");
      if (!o.ship_line1 || !o.ship_city || !o.ship_phone) throw new ProblemError(409, "address_missing", "the order has no delivery address or phone");
      let cod: bigint;
      try {
        cod = toMinor(cashToCollect(paymentView(o)));
      } catch (e) {
        if (e instanceof ShipBlockedError) throw new ProblemError(409, "payment_blocks_shipping", `the payment does not allow shipping yet (${e.reason})`, [{ path: "payment", code: e.reason, message: e.reason }]);
        throw e;
      }

      const courier = await trx.selectFrom("connections").select(["id", "provider", "status"]).where("kind", "=", "courier").where("status", "!=", "disconnected")
        .orderBy("created_at").executeTakeFirst();
      if (!courier) throw new ProblemError(409, "no_courier", "connect a courier first");
      if (courier.status === "needs_attention") throw new ProblemError(409, "courier_needs_attention", "the courier connection needs attention (key refused)");
      // Jobs run in a store's engine: the order's own store, else the tenant's first (a courier is only connected after a store).
      const fromStore = o.store_provider === "shopify" && o.store_status !== "disconnected" ? o.connection_id : null;
      const storeId = fromStore ?? (await trx.selectFrom("connections").select("id").where("provider", "=", "shopify").where("status", "!=", "disconnected").orderBy("created_at").executeTakeFirst())?.id;
      if (!storeId) throw new ProblemError(409, "store_not_connected", "connect the store first");

      const row = await trx.insertInto("shipments").values({
        tenant_id: tenantId, order_id: orderId, connection_id: courier.id, provider: courier.provider, currency: o.currency, cod_minor: cod,
        booking: "pending", requested_by: auth.user.id, created_at: now, updated_at: now,
      }).returning([...SHIPMENT_COLUMNS]).executeTakeFirstOrThrow();
      const store = new SqlStore(trxQueryClient(trx), { tenantId, connections: { shopify: storeId, bosta: courier.id } });
      await store.enqueue(MizanEngine.bostaShipJob({ shipmentId: row.id, orderId, ...(fromStore && o.external_id ? { storeOrderId: o.external_id } : {}) }), this.runtime(tenantId).clock.now());
      await timeline(trx, tenantId, orderId, "ship_requested", { shipmentId: row.id, provider: courier.provider }, auth.user.id);
      await this.audit.record(trx, { action: "shipment.requested", tenantId, entity: { type: "order", id: orderId }, after: { shipmentId: row.id, provider: courier.provider, codMinor: String(cod) }, ...auditActor(auth) });
      return { created: true, shipment: view(row) };
    });
  }

  /** The order as the courier needs it: with the delivery contact (decrypted here, never in a job). */
  async loadOrder(tenantId: string, orderId: string): Promise<CanonicalOrder | undefined> {
    return this.db.tenant(tenantId, async (trx) => {
      const o = await trx.selectFrom("orders").selectAll().where("id", "=", orderId).executeTakeFirst();
      if (!o) return undefined;
      const lines = await trx.selectFrom("order_lines").select(["id", "external_line_id", "sku", "title", "quantity", "unit_price_minor"]).where("order_id", "=", orderId).orderBy("external_line_id").execute();
      const pii = await this.cipher.forTenant(trx, tenantId);
      const name = pii.decrypt(o.ship_name, "orders.ship_name") ?? "";
      const phone = pii.decrypt(o.ship_phone, "orders.ship_phone") ?? undefined;
      const line2 = pii.decrypt(o.ship_line2, "orders.ship_line2");
      const money = (minor: string | number | bigint) => fromMinor(BigInt(minor), o.currency);
      return {
        ...paymentView(o), connector: "mizan", externalId: o.id, createdAt: o.placed_at.toISOString(), updatedAt: o.updated_at.toISOString(),
        subtotal: money(o.subtotal_minor), shipping: money(o.shipping_minor), refunded: money(o.refunded_minor), cancelled: o.status === "cancelled", tags: o.tags,
        customer: { name, ...(phone ? { phone } : {}) },
        shippingAddress: {
          name, line1: pii.decrypt(o.ship_line1, "orders.ship_line1") ?? "", ...(line2 ? { line2 } : {}), city: o.ship_city ?? "",
          ...(o.ship_province ? { province: o.ship_province } : {}), ...(phone ? { phone } : {}), countryCode: o.ship_country ?? "EG",
        },
        lines: lines.map((l) => ({ externalLineId: l.external_line_id ?? l.id, ...(l.sku ? { sku: l.sku } : {}), title: l.title, quantity: l.quantity, unitPrice: money(l.unit_price_minor) })),
      } as CanonicalOrder;
    });
  }

  /** The courier's answer (once per booking: a repeat finds it no longer pending). */
  async recordResult(tenantId: string, shipmentId: string, result: ShipOutcome, now = new Date()): Promise<void> {
    await this.db.tenant(tenantId, async (trx) => {
      const s = await trx.selectFrom("shipments").select(["id", "order_id", "booking", "provider"]).where("id", "=", shipmentId).forUpdate().executeTakeFirst();
      if (!s || s.booking !== "pending") return;
      const o = await trx.selectFrom("orders").select(["id", "number", "status", "currency"]).where("id", "=", s.order_id).forUpdate().executeTakeFirstOrThrow();
      const actor = { type: "engine" as const };
      if (!result.ok) {
        const code = bookingError(result);
        await trx.updateTable("shipments").set({ booking: "failed", error_code: code, error: result.message.slice(0, 500), updated_at: now }).where("id", "=", s.id).execute();
        await timeline(trx, tenantId, o.id, "ship_failed", { shipmentId: s.id, code });
        await this.events.emit(trx, { type: "shipment.booking_failed", tenantId, entity: { type: "shipment", id: s.id }, actor, data: { orderId: o.id, number: o.number, provider: s.provider, code } });
        return;
      }
      const x = result.shipment;
      const status = DB_STATUSES.has(x.status) ? x.status : "unknown";
      const cod = toMinor({ amount: x.cod.amount, currency: o.currency });
      await trx.updateTable("shipments").set({
        booking: "booked", tracking_number: x.trackingNumber, external_id: x.externalId, tracking_url: x.trackingUrl ?? null, status, status_raw: x.rawStatus?.label ?? (x.rawStatus?.code !== undefined ? String(x.rawStatus.code) : null),
        status_at: now, needs_review: status === "unknown", cod_minor: cod, booked_at: now, updated_at: now,
      }).where("id", "=", s.id).execute();
      // The order is shipped once the courier has it (a cancel that raced the booking stays cancelled; the team terminates the delivery).
      const shipped = o.status === "confirmed";
      if (shipped) {
        await trx.updateTable("orders").set({ status: "shipped", shipped_at: now, updated_at: now }).where("id", "=", o.id).execute();
      }
      await trx.insertInto("order_events").values({
        tenant_id: tenantId, order_id: o.id, type: "shipped", from_status: o.status, to_status: shipped ? "shipped" : o.status, actor_type: "system",
        data: JSON.stringify({ shipmentId: s.id, provider: s.provider, trackingNumber: x.trackingNumber, adopted: result.adopted }),
      }).execute();
      await this.events.emit(trx, { type: "shipment.created", tenantId, entity: { type: "shipment", id: s.id }, actor, data: { orderId: o.id, number: o.number, provider: s.provider, trackingNumber: x.trackingNumber, codMinor: String(cod), currency: o.currency, adopted: result.adopted } });
      // Stock picks what the order held and profit moves it to "shipped": both follow the order's events.
      if (shipped) await this.events.emit(trx, { type: "order.updated", tenantId, entity: { type: "order", id: o.id }, actor, data: { number: o.number, status: "shipped", changed: ["status"] } });
    });
  }
}

/** The order's money as the payment rules read it (cashToCollect): the same numbers the order screen shows. */
function paymentView(o: { number: string; currency: string; total_minor: string | number | bigint; paid_minor: string | number | bigint; payment_mode: string; payment_status: string }) {
  const total = BigInt(o.total_minor);
  const paid = BigInt(o.paid_minor);
  return {
    number: o.number, currency: o.currency, total: fromMinor(total, o.currency), received: fromMinor(paid, o.currency),
    outstanding: fromMinor(total > paid ? total - paid : 0n, o.currency), paymentMode: o.payment_mode as PaymentMode, paymentStatus: o.payment_status as PaymentStatus, gateways: [],
  } as unknown as CanonicalOrder;
}

function bookingError(r: Extract<ShipOutcome, { ok: false }>): BookingError {
  switch (r.reason) {
    case "blocked": return "payment_blocks";
    case "not_found": return "not_found";
    case "permission": return "courier_refused_key";
    case "validation": return r.details && "city" in r.details ? "city_unknown" : r.details?.cancelled ? "cancelled" : "address_invalid";
    default: return "courier_failed";
  }
}

function view(r: Row): ShipmentView {
  return {
    id: r.id, orderId: r.order_id, provider: r.provider, booking: r.booking as ShipmentView["booking"], status: r.status,
    trackingNumber: r.tracking_number, trackingUrl: r.tracking_url, cod: fromMinor(BigInt(r.cod_minor), r.currency),
    error: r.error_code ? { code: r.error_code as BookingError, message: r.error ?? "" } : null,
    requestedAt: r.created_at.toISOString(), bookedAt: r.booked_at?.toISOString() ?? null,
  };
}

function timeline(trx: Trx, tenantId: string, orderId: string, type: string, data: Record<string, unknown>, userId?: string) {
  return trx.insertInto("order_events").values({
    tenant_id: tenantId, order_id: orderId, type, actor_type: userId ? "user" : "system", actor_id: userId ?? null, data: JSON.stringify(data),
  }).execute();
}
