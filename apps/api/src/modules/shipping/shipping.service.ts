import type { DomainEvent } from "@mizan/shared";
import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import { trxQueryClient, type DB } from "@mizan/db";
import { cashToCollect, MizanEngine, ShipBlockedError, SqlStore, type ShipmentStatusUpdate, type ShipOutcome } from "@mizan/engine";
import { fromMinor, SHIPMENT_STATUSES, toMinor, type CanonicalOrder, type EventActor, type PaymentMode, type PaymentStatus } from "@mizan/shared";
import { ENGINE_RUNTIME, type RuntimeFactory } from "../../integrations/engine-registry.js";
import { auditActor, AuditService } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import { PiiCipher } from "../../platform/pii/pii-cipher.js";
import { TrackingService } from "./tracking.service.js";
import { STORE_PROVIDERS } from "../../integrations/connection-resolver.js";
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
/** Why a delivery waits for a person after the store cancelled the order. */
export const STORE_CANCELLED = "Cancelled in the store after booking: cancel at the courier, or keep it";

@Injectable()
export class ShippingService implements ShipmentResultSink {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(PiiCipher) private readonly cipher: PiiCipher,
    @Inject(ENGINE_RUNTIME) private readonly runtime: RuntimeFactory,
    @Inject(TrackingService) private readonly tracking: TrackingService,
  ) {}

  /** The courier's status for a booked shipment (E7-3). */
  recordStatus(tenantId: string, connectionId: string, update: ShipmentStatusUpdate): Promise<void> {
    return this.tracking.recordStatus(tenantId, connectionId, update);
  }

  /** Ship an order: idempotent — while a booking is pending or booked, asking again returns it. */
  async ship(auth: AuthContext, orderId: string, now = new Date()): Promise<{ created: boolean; shipment: ShipmentView }> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const r = await this.book(trx, tenantId, orderId, auth.user.id, now);
      if (r.created) await this.audit.record(trx, { action: "shipment.requested", tenantId, entity: { type: "order", id: orderId }, after: { shipmentId: r.shipment.id, provider: r.shipment.provider, codMinor: String(toMinor(r.shipment.cod)) }, ...auditActor(auth) });
      return r;
    });
  }

  /**
   * Book the courier inside the caller's transaction (the order screen, and bulk ship from the
   * shipping screen, E7-2): the shipment row and the courier job commit together. Refusals are
   * ProblemErrors with a code (not_confirmed, address_missing, payment_blocks_shipping, no_courier…).
   */
  async book(trx: Trx, tenantId: string, orderId: string, userId: string | null, now = new Date(), data: Record<string, unknown> = {}, opts: { courierConnectionId?: string | null } = {}): Promise<{ created: boolean; shipment: ShipmentView }> {
    const ready = await this.shippable(trx, orderId, true);
    if (ready.kind === "live") return { created: false, shipment: ready.live };
    const { o, cod } = ready;

    // Couriers Mizan books through an API (Bosta for now); others are recorded by hand (shipManual).
    const courier = await apiCourier(trx, opts.courierConnectionId);
    if (!courier) throw new ProblemError(409, "no_courier", "connect a courier first");
    if (courier.status === "needs_attention") throw new ProblemError(409, "courier_needs_attention", "the courier connection needs attention (key refused)");
    // Jobs run in a store's engine: the order's own store, else the tenant's first (a courier is only connected after a store).
    const fromStore = o.store_provider && (STORE_PROVIDERS as readonly string[]).includes(o.store_provider) && o.store_status !== "disconnected" ? o.connection_id
      : o.store_copy_id && (await trx.selectFrom("connections").select("status").where("id", "=", o.store_copy_connection_id!).executeTakeFirst())?.status !== "disconnected"
        ? o.store_copy_connection_id : null; // a Mizan order with its copy in the store: fulfilled there too
    const storeId = fromStore ?? (await trx.selectFrom("connections").select("id").where("provider", "in", [...STORE_PROVIDERS]).where("status", "!=", "disconnected").orderBy("created_at").executeTakeFirst())?.id;
    if (!storeId) throw new ProblemError(409, "store_not_connected", "connect the store first");

    const row = await trx.insertInto("shipments").values({
      tenant_id: tenantId, order_id: orderId, connection_id: courier.id, provider: courier.provider, currency: o.currency, cod_minor: cod,
      booking: "pending", requested_by: userId, created_at: now, updated_at: now,
    }).returning([...SHIPMENT_COLUMNS]).executeTakeFirstOrThrow();
    const store = new SqlStore(trxQueryClient(trx), { tenantId, store: storeId, connections: { bosta: courier.id } });
    // Only a Shopify order is fulfilled in the store with the tracking number (WooCommerce has no core shipment tracking).
    const storeOrderId = o.connection_id ? (o.store_provider === "shopify" ? o.external_id : null) : o.store_copy_id;
    await store.enqueue(MizanEngine.bostaShipJob({ shipmentId: row.id, orderId, ...(fromStore && storeOrderId ? { storeOrderId } : {}) }), this.runtime(tenantId).clock.now());
    await timeline(trx, tenantId, orderId, "ship_requested", { ...data, shipmentId: row.id, provider: courier.provider }, userId ?? undefined);
    return { created: true, shipment: view(row) };
  }

  /** The courier Mizan books through an API, if one is connected (bulk ship checks it before queueing). */
  courier(trx: Trx) {
    return apiCourier(trx);
  }

  /**
   * E7-6: a courier without an API — the team hands the parcel over and types the courier and its
   * tracking number. Booked at once; its statuses come from the courier's report (CSV) or a person.
   */
  async shipManual(auth: AuthContext, orderId: string, body: { courier: string; trackingNumber: string; trackingUrl?: string | undefined }, now = new Date()): Promise<ShipmentView> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const ready = await this.shippable(trx, orderId, false);
      if (ready.kind === "live") throw new ProblemError(409, "already_shipping", "the order already has a shipment with a courier");
      const { o, cod } = ready;
      const key = body.courier.trim().toLowerCase().replace(/\s+/g, " ");
      let courier = await trx.selectFrom("connections").select(["id", "display_name", "config"]).where("kind", "=", "courier").where("provider", "=", "manual").where("external_account", "=", key).executeTakeFirst();
      courier ??= await trx.insertInto("connections").values({ tenant_id: tenantId, kind: "courier", provider: "manual", external_account: key, display_name: body.courier.trim(), status: "active" })
        .returning(["id", "display_name", "config"]).executeTakeFirstOrThrow();
      // The tracking link: the one typed, else the courier's page learned from an earlier parcel ({tn} for the number).
      const config = (courier.config ?? {}) as { trackingUrlTemplate?: string };
      const trackingUrl = body.trackingUrl ?? config.trackingUrlTemplate?.replaceAll("{tn}", encodeURIComponent(body.trackingNumber)) ?? null;
      const template = body.trackingUrl ? trackingTemplate(body.trackingUrl, body.trackingNumber) : null;
      if (template && template !== config.trackingUrlTemplate) {
        await trx.updateTable("connections").set({ config: JSON.stringify({ ...config, trackingUrlTemplate: template }), updated_at: now }).where("id", "=", courier.id).execute();
      }
      const taken = await trx.selectFrom("shipments").select("id").where("connection_id", "=", courier.id).where("tracking_number", "=", body.trackingNumber).executeTakeFirst();
      if (taken) throw new ProblemError(409, "tracking_taken", "this courier's tracking number is already on another shipment");
      const name = courier.display_name ?? body.courier.trim();
      const row = await trx.insertInto("shipments").values({
        tenant_id: tenantId, order_id: orderId, connection_id: courier.id, provider: name, currency: o.currency, cod_minor: cod, booking: "booked", status: "created",
        tracking_number: body.trackingNumber, tracking_url: trackingUrl, status_at: now, requested_by: auth.user.id, booked_at: now, created_at: now, updated_at: now,
      }).returning([...SHIPMENT_COLUMNS]).executeTakeFirstOrThrow();
      await timeline(trx, tenantId, orderId, "ship_requested", { shipmentId: row.id, provider: name, manual: true }, auth.user.id);
      await this.shipped(trx, tenantId, { id: row.id, provider: name }, o, { trackingNumber: body.trackingNumber, codMinor: cod, adopted: false }, now, { type: "user", id: auth.user.id });
      await this.audit.record(trx, { action: "shipment.recorded", tenantId, entity: { type: "order", id: orderId }, after: { shipmentId: row.id, courier: name, codMinor: String(cod) }, ...auditActor(auth) });
      return view(row);
    });
  }

  /**
   * Two-way delivery, store → Mizan: the merchant shipped the order in the store with another
   * courier (a Shopify fulfillment Mizan did not make). It becomes a booked shipment with that
   * courier (a courier without an API, statuses by a person or a report), the order is shipped
   * (out of confirmation), and `shipment.created` says it came from the store, so nothing is sent back.
   */
  async recordStoreFulfillment(trx: Trx, tenantId: string, orderId: string, f: { company: string | null; trackingNumber: string | null; trackingUrl: string | null; fulfillmentId?: string | null }, now = new Date()): Promise<"recorded" | "skipped"> {
    const o = await trx.selectFrom("orders").select(["id", "number", "status", "currency", "total_minor", "paid_minor", "refunded_minor", "payment_mode", "payment_status"])
      .where("id", "=", orderId).forUpdate().executeTakeFirst();
    if (!o || !["new", "pending_confirmation", "confirmed", "shipped"].includes(o.status)) return "skipped";
    const live = await trx.selectFrom("shipments").select(["id", "tracking_number", "external_id"]).where("order_id", "=", orderId).where("is_return_leg", "=", false)
      .where("booking", "!=", "failed").where("status", "!=", "cancelled").executeTakeFirst();
    if (live) {
      // Shipped twice: Mizan has a delivery and the store recorded another. A person decides which goes.
      const same = f.trackingNumber ? live.tracking_number === f.trackingNumber : live.external_id === f.fulfillmentId;
      if (!same) await this.tracking.flag(trx, tenantId, live.id, `Also shipped in the store: ${f.company ?? "another courier"} ${f.trackingNumber ?? "(no tracking number)"}`);
      return "skipped";
    }
    const name = f.company?.trim() || "Store courier";
    const key = name.toLowerCase().replace(/\s+/g, " ");
    let courier = await trx.selectFrom("connections").select(["id", "display_name"]).where("kind", "=", "courier").where("provider", "=", "manual").where("external_account", "=", key).executeTakeFirst();
    courier ??= await trx.insertInto("connections").values({ tenant_id: tenantId, kind: "courier", provider: "manual", external_account: key, display_name: name, status: "active" })
      .returning(["id", "display_name"]).executeTakeFirstOrThrow();
    // Marked fulfilled in the store with no tracking number: known by the store's fulfillment id.
    const taken = f.trackingNumber
      ? await trx.selectFrom("shipments").select("id").where("connection_id", "=", courier.id).where("tracking_number", "=", f.trackingNumber).executeTakeFirst()
      : await trx.selectFrom("shipments").select("id").where("order_id", "=", orderId).where("external_id", "=", f.fulfillmentId ?? "-").executeTakeFirst();
    if (taken) return "skipped";
    let cod = 0n;
    try { cod = toMinor(cashToCollect(paymentView(o))); } catch { /* the store shipped it anyway: nothing Mizan can collect */ }
    const provider = courier.display_name ?? name;
    const row = await trx.insertInto("shipments").values({
      tenant_id: tenantId, order_id: orderId, connection_id: courier.id, provider, currency: o.currency, cod_minor: cod, booking: "booked", status: "created",
      tracking_number: f.trackingNumber, tracking_url: f.trackingUrl, external_id: f.fulfillmentId ?? null, status_at: now, booked_at: now, created_at: now, updated_at: now,
    }).returning(["id"]).executeTakeFirstOrThrow();
    const actor = { type: "engine" as const };
    await trx.updateTable("orders").set({ status: "shipped", shipped_at: now, updated_at: now }).where("id", "=", orderId).execute();
    await trx.insertInto("order_events").values({
      tenant_id: tenantId, order_id: orderId, type: "shipped", from_status: o.status, to_status: "shipped", actor_type: "system",
      data: JSON.stringify({ shipmentId: row.id, provider, trackingNumber: f.trackingNumber, source: "store" }),
    }).execute();
    await this.events.emit(trx, { type: "shipment.created", tenantId, entity: { type: "shipment", id: row.id }, actor, data: { orderId, number: o.number, provider, trackingNumber: f.trackingNumber, codMinor: String(cod), currency: o.currency, adopted: false, source: "store" } });
    await this.events.emit(trx, { type: "order.updated", tenantId, entity: { type: "order", id: orderId }, actor, data: { number: o.number, status: "shipped", changed: ["status"] } });
    return "recorded";
  }

  /**
   * Cancel a booked delivery at the courier (Bosta: terminate). Queued once per shipment; the shipment is
   * cancelled when Bosta confirms (recordCancelled), so a parcel already picked up is never shown cancelled.
   */
  async cancelAtCourier(auth: AuthContext, shipmentId: string): Promise<{ queued: boolean }> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const s = await trx.selectFrom("shipments as s").innerJoin("connections as k", "k.id", "s.connection_id")
        .select(["s.id", "s.order_id", "s.status", "s.booking", "s.tracking_number", "s.connection_id", "k.provider as courier"]).where("s.id", "=", shipmentId).executeTakeFirst();
      if (!s) throw new ProblemError(404, "not_found", "shipment not found");
      if (s.courier !== "bosta") throw new ProblemError(409, "no_courier_api", "this courier has no API: set the status by hand");
      if (s.booking !== "booked" || !s.tracking_number) throw new ProblemError(409, "not_booked", "the courier has not booked this shipment");
      if (["delivered", "returned", "lost", "cancelled"].includes(s.status)) throw new ProblemError(409, "already_final", "this delivery is over");
      const storeId = await this.engineStoreOf(trx, s.order_id);
      if (!storeId) throw new ProblemError(409, "store_not_connected", "connect the store first");
      const store = new SqlStore(trxQueryClient(trx), { tenantId, store: storeId, connections: { bosta: s.connection_id } });
      // One request at a time; after a refusal or a failure, a new one (Bosta is read before anything is said).
      const asked = await trx.selectFrom("mz_outbox").select(["status"]).where("idempotency_key", "like", `bosta:cancel:${s.id}%`).execute();
      if (asked.some((j) => j.status === "pending" || j.status === "running")) return { queued: false };
      const r = await store.enqueue(MizanEngine.bostaCancelJob({ shipmentId: s.id, trackingNumber: s.tracking_number }, asked.length), this.runtime(tenantId).clock.now());
      if (r.created) {
        await timeline(trx, tenantId, s.order_id, "cancel_requested", { shipmentId: s.id }, auth.user.id);
        await this.audit.record(trx, { action: "shipment.cancel_requested", tenantId, entity: { type: "shipment", id: s.id }, after: { trackingNumber: s.tracking_number }, ...auditActor(auth) });
      }
      return { queued: r.created };
    });
  }

  /** Bosta's answer to a cancel: the shipment cancelled and the order freed to ship again (or cancelled, when the store cancelled it); or why not. */
  async recordCancelled(tenantId: string, shipmentId: string, result: { ok: true } | { ok: false; reason: string; message: string }): Promise<void> {
    await this.db.tenant(tenantId, async (trx) => {
      const before = await trx.selectFrom("shipments").select(["status"]).where("id", "=", shipmentId).executeTakeFirst();
      if (!before) return;
      if (!result.ok) {
        await this.tracking.flag(trx, tenantId, shipmentId, `Bosta refused to cancel: ${result.message}`);
        return;
      }
      if (before.status === "cancelled") return;
      // The shipment is cancelled; the order follows (shipped → confirmed, or cancelled when the store had cancelled it).
      await this.tracking.courierCancelled(trx, tenantId, shipmentId);
    });
  }

  /** The store whose engine queue carries this order's courier jobs (as book() picks it). */
  private async engineStoreOf(trx: Trx, orderId: string): Promise<string | null> {
    const o = await trx.selectFrom("orders as o").leftJoin("connections as c", "c.id", "o.connection_id")
      .select(["o.connection_id", "c.provider", "c.status", "o.store_copy_connection_id", "o.store_copy_id"]).where("o.id", "=", orderId).executeTakeFirst();
    if (!o) return null;
    const own = o.provider && (STORE_PROVIDERS as readonly string[]).includes(o.provider) && o.status !== "disconnected" ? o.connection_id : null;
    if (own) return own;
    if (o.store_copy_id && o.store_copy_connection_id) {
      const k = await trx.selectFrom("connections").select("status").where("id", "=", o.store_copy_connection_id).executeTakeFirst();
      if (k && k.status !== "disconnected") return o.store_copy_connection_id;
    }
    return (await trx.selectFrom("connections").select("id").where("provider", "in", [...STORE_PROVIDERS]).where("status", "!=", "disconnected").orderBy("created_at").executeTakeFirst())?.id ?? null;
  }

  /**
   * What the store says about an order with a live delivery (shipping's watch on the order): cancelled after booking,
   * the cash to collect changed, shipped there too, a fulfillment cancelled there. A person decides; nothing is guessed.
   */
  async watch(trx: Trx, event: DomainEvent): Promise<void> {
    const tenantId = event.tenantId;
    const orderId = event.entity.id;
    const live = await trx.selectFrom("shipments").select(["id", "cod_minor", "status", "booking", "external_id", "tracking_number", "needs_review"])
      .where("order_id", "=", orderId).where("is_return_leg", "=", false).where("booking", "in", ["booked", "pending"])
      .where("status", "not in", ["delivered", "returned", "lost", "cancelled"]).orderBy("created_at", "desc").executeTakeFirst();
    const d = event.data as Record<string, unknown>;
    if (event.type === "order.store_fulfillment_cancelled" && d.mizanBooked) {
      // Mizan's own delivery: Bosta still has the parcel. Never guessed: cancel at Bosta, or keep it.
      const s = await trx.selectFrom("shipments").select("id").where("order_id", "=", orderId).where("tracking_number", "=", String(d.trackingNumber ?? "")).where("status", "!=", "cancelled").executeTakeFirst();
      if (s) await this.tracking.flag(trx, tenantId, s.id, "Fulfillment cancelled in Shopify: cancel at Bosta, or keep the delivery");
      return;
    }
    if (event.type === "order.store_fulfillment_cancelled") {
      // Shipped in the store with another courier, and that fulfillment was cancelled there: so is Mizan's record of it.
      const s = await trx.selectFrom("shipments").select(["id", "status"]).where("order_id", "=", orderId).where("external_id", "=", String(d.fulfillmentId ?? "")).executeTakeFirst();
      if (!s || s.status === "cancelled") return;
      await this.tracking.courierCancelled(trx, tenantId, s.id); // the order follows (shipped → confirmed)
      // The replacement made in the same change in the store, recorded after the cancel (never before it).
      const r = d.replacement as { company?: string | null; trackingNumber?: string | null; trackingUrl?: string | null; fulfillmentId?: string } | undefined;
      if (r?.trackingNumber || r?.fulfillmentId) await this.recordStoreFulfillment(trx, tenantId, orderId, { company: r.company ?? null, trackingNumber: r.trackingNumber ?? null, trackingUrl: r.trackingUrl ?? null, fulfillmentId: r.fulfillmentId ?? null });
      return;
    }
    if (!live) return;
    if (event.type === "order.cancelled_after_shipping") {
      await this.tracking.flag(trx, tenantId, live.id, STORE_CANCELLED);
      return;
    }
    // The cash to collect changed after booking (a refund, a payment, an edit): the courier still has the old amount.
    const o = await trx.selectFrom("orders").select(["cod_minor", "currency", "status"]).where("id", "=", orderId).executeTakeFirst();
    if (o?.status !== "shipped") return; // delivered (fully or in part), returned, or not out yet: nothing for the courier to change
    // (A booking still pending reads the order when it runs, so it books the new amount.)
    // Already waiting for a person (e.g. the payment conversion flagged it): no second flag.
    if (o && live.booking === "booked" && !live.needs_review && BigInt(o.cod_minor) !== BigInt(live.cod_minor)) {
      const was = fromMinor(BigInt(live.cod_minor), o.currency.trim()).amount;
      const now = fromMinor(BigInt(o.cod_minor), o.currency.trim()).amount;
      await this.tracking.flag(trx, tenantId, live.id, `Cash to collect changed after booking: the courier has ${was}, the order now says ${now}`,
        { reason: "cod_changed", fromMinor: String(live.cod_minor), toMinor: String(o.cod_minor), currency: o.currency.trim() });
    }
  }

  /** The checks every way of shipping makes: the order ships now, with this much to collect — or it already has a live shipment. */
  private async shippable(trx: Trx, orderId: string, needAddress: boolean) {
    const o = await trx.selectFrom("orders as o").leftJoin("connections as c", "c.id", "o.connection_id")
      .select(["o.id", "o.number", "o.status", "o.currency", "o.total_minor", "o.paid_minor", "o.refunded_minor", "o.payment_mode", "o.payment_status",
        "o.ship_line1", "o.ship_city", "o.ship_phone", "o.external_id", "o.connection_id", "c.provider as store_provider", "c.status as store_status", "o.store_copy_connection_id", "o.store_copy_id"])
      .where("o.id", "=", orderId).forUpdate("o").executeTakeFirst();
    if (!o) throw new ProblemError(404, "not_found", "order not found");
    const live = await trx.selectFrom("shipments").select([...SHIPMENT_COLUMNS]).where("order_id", "=", orderId).where("is_return_leg", "=", false)
      .where("booking", "!=", "failed").where("status", "!=", "cancelled").executeTakeFirst();
    if (live) return { kind: "live" as const, live: view(live) };
    // A confirmed order, or a shipped one whose delivery the courier cancelled (booked again).
    if (o.status !== "confirmed" && o.status !== "shipped") throw new ProblemError(409, "not_confirmed", o.status === "cancelled" ? "the order is cancelled" : "only a confirmed order ships");
    if (needAddress && (!o.ship_line1 || !o.ship_city || !o.ship_phone)) throw new ProblemError(409, "address_missing", "the order has no delivery address or phone");
    try {
      return { kind: "ready" as const, o, cod: toMinor(cashToCollect(paymentView(o))) };
    } catch (e) {
      if (e instanceof ShipBlockedError) throw new ProblemError(409, "payment_blocks_shipping", `the payment does not allow shipping yet (${e.reason})`, [{ path: "payment", code: e.reason, message: e.reason }]);
      throw e;
    }
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
      // The customer's email lives on the customer (encrypted), not the order: Bosta sends the receiver its updates.
      const c = o.customer_id ? await trx.selectFrom("customers").select("email").where("id", "=", o.customer_id).executeTakeFirst() : undefined;
      const email = c ? pii.decrypt(c.email, "customers.email") ?? undefined : undefined;
      const money = (minor: string | number | bigint) => fromMinor(BigInt(minor), o.currency);
      return {
        ...paymentView(o), connector: "mizan", externalId: o.id, createdAt: o.placed_at.toISOString(), updatedAt: o.updated_at.toISOString(),
        subtotal: money(o.subtotal_minor), shipping: money(o.shipping_minor), refunded: money(o.refunded_minor), cancelled: o.status === "cancelled", tags: o.tags,
        customer: { name, ...(phone ? { phone } : {}), ...(email ? { email } : {}) },
        shippingAddress: {
          name, line1: pii.decrypt(o.ship_line1, "orders.ship_line1") ?? "", ...(line2 ? { line2 } : {}), city: o.ship_city ?? "",
          ...(o.ship_province ? { province: o.ship_province } : {}), ...(phone ? { phone } : {}), countryCode: o.ship_country ?? "EG",
          ...(o.ship_lat !== null && o.ship_lng !== null ? { location: { lat: o.ship_lat, lng: o.ship_lng } } : {}),
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
      await this.shipped(trx, tenantId, s, o, { trackingNumber: x.trackingNumber, codMinor: cod, adopted: result.adopted }, now, actor);
    });
  }

  /** The courier has the parcel: the order is shipped (unless a cancel raced the booking), on its timeline and in events. */
  private async shipped(trx: Trx, tenantId: string, s: { id: string; provider: string }, o: { id: string; number: string; status: string; currency: string },
    x: { trackingNumber: string; codMinor: bigint; adopted: boolean }, now: Date, actor: EventActor) {
    // A cancel that raced the booking stays cancelled; the team terminates the delivery.
    const shipped = o.status === "confirmed";
    if (shipped) {
      await trx.updateTable("orders").set({ status: "shipped", shipped_at: now, updated_at: now }).where("id", "=", o.id).execute();
    }
    await trx.insertInto("order_events").values({
      tenant_id: tenantId, order_id: o.id, type: "shipped", from_status: o.status, to_status: shipped ? "shipped" : o.status, actor_type: actor.type === "user" ? "user" : "system", actor_id: actor.type === "user" ? actor.id ?? null : null,
      data: JSON.stringify({ shipmentId: s.id, provider: s.provider, trackingNumber: x.trackingNumber, adopted: x.adopted }),
    }).execute();
    await this.events.emit(trx, { type: "shipment.created", tenantId, entity: { type: "shipment", id: s.id }, actor, data: { orderId: o.id, number: o.number, provider: s.provider, trackingNumber: x.trackingNumber, codMinor: String(x.codMinor), currency: o.currency, adopted: x.adopted } });
    // Stock picks what the order held and profit moves it to "shipped": both follow the order's events.
    if (shipped) await this.events.emit(trx, { type: "order.updated", tenantId, entity: { type: "order", id: o.id }, actor, data: { number: o.number, status: "shipped", changed: ["status"] } });
  }
}

/** The order's money as the payment rules read it (cashToCollect): the same numbers the order screen shows. */
/** The order's money as cashToCollect reads it (rule 13): what the courier collects comes from here only. */
export function paymentView(o: { number: string; currency: string; total_minor: string | number | bigint; paid_minor: string | number | bigint; payment_mode: string; payment_status: string }) {
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

/** The courier booked through an API: the one asked for (when it is still connected), else the first connected. */
async function apiCourier(trx: Trx, id?: string | null) {
  const q = trx.selectFrom("connections").select(["id", "provider", "status"]).where("kind", "=", "courier").where("provider", "=", "bosta").where("status", "!=", "disconnected");
  return (id ? await q.where("id", "=", id).executeTakeFirst() : undefined) ?? q.orderBy("created_at").executeTakeFirst();
}

function timeline(trx: Trx, tenantId: string, orderId: string, type: string, data: Record<string, unknown>, userId?: string) {
  return trx.insertInto("order_events").values({
    tenant_id: tenantId, order_id: orderId, type, actor_type: userId ? "user" : "system", actor_id: userId ?? null, data: JSON.stringify(data),
  }).execute();
}

/**
 * A courier's tracking page as a template ({tn} for the number), learned from one parcel's link: only
 * when the number stands whole in the path or a query value, every time it appears, and nowhere
 * else (never in the host). Otherwise nothing is learned: a wrong template would show the next
 * customers someone else's parcel.
 */
export function trackingTemplate(link: string, trackingNumber: string): string | null {
  let url: URL;
  try { url = new URL(link); } catch { return null; }
  if (url.protocol !== "https:" || url.host.toLowerCase().includes(trackingNumber.toLowerCase())) return null;
  const origin = `${url.protocol}//${url.host}`;
  if (!link.startsWith(origin)) return null;
  const rest = link.slice(origin.length);
  // Letters, digits, - and _ only (the schema's rule), so the number is safe inside a pattern as it is.
  if (!/^[\w-]{3,64}$/.test(trackingNumber)) return null;
  const escaped = trackingNumber;
  const whole = () => new RegExp(`(?<=[/?=&#])${escaped}(?=$|[/?&#])`, "g");
  if (!whole().test(rest)) return null;
  const path = rest.replace(whole(), "{tn}");
  return path.includes(trackingNumber) ? null : origin + path;
}
