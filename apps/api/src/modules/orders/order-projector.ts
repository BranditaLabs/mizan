import { ENGINE_RUNTIME, type RuntimeFactory } from "../../integrations/engine-runtime.js";
import { trxQueryClient } from "@mizan/db";
import { MizanEngine, SqlStore } from "@mizan/engine";
import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { cashToCollect, type ShipBlockReason } from "@mizan/engine";
import { normalizePhone, resolveOrderSource, toAsciiDigits, toMinor, type CanonicalOrder } from "@mizan/shared";
import { phoneCountryOf } from "../../platform/pii/phone-country.js";
import { Database } from "../../platform/db/database.js";
import { DuplicatesService } from "./duplicates.service.js";
import { RiskService } from "./risk.service.js";
import { EventsService } from "../../platform/events/events.service.js";
import { LedgerService } from "../payments/ledger.service.js";
import { PiiCipher, type TenantPii } from "../../platform/pii/pii-cipher.js";

/** Order statuses an incoming cancellation may still override (before it leaves the warehouse). */
const CANCELLABLE = new Set(["new", "pending_confirmation", "confirmed"]);
/** Canonical payment statuses the orders table stores as-is; "unknown" is stored as unpaid. */
const PAYMENT_STATUSES = new Set(["unpaid", "authorized", "partially_paid", "paid", "partially_refunded", "refunded", "failed", "voided"]);

/** Business fields compared to decide whether an update is worth an event. */
/** Personal data columns of an order, as they are after redaction. */
export const REDACTED_ORDER = { ship_name: null, ship_phone: null, ship_line1: null, ship_line2: null, ship_lat: null, ship_lng: null, customer_label: null, phone_last4: null } as const;

/**
 * The most a list row shows of a customer (E5-1): first name and the last name's initial, "Mona A." /
 * "منى ع.". Still personal data, so stored encrypted like the rest (decrypting one short field per
 * list row is cheap); the full name is revealed only in the order.
 */
const lastFour = (phone: string | null) => {
  const digits = toAsciiDigits(phone ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
};

export function customerLabel(name: string | null | undefined): string | null {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const first = [...words[0]!].slice(0, 24).join("");
  return words.length > 1 ? `${first} ${[...words.at(-1)!][0]}.` : first;
}

/** Stores whose orders carry tags; Mizan writes its tags there too. */
const STORE_TAGS = new Set<string>(["shopify"]);
const TRACKED = ["status", "payment_mode", "payment_status", "total_minor", "paid_minor", "refunded_minor", "cod_minor", "tags"] as const;
/** Statuses an order can be shipped from in the store before Mizan ships it. */
const FULFILLABLE = new Set(["new", "pending_confirmation", "confirmed"]);
/** Statuses where what the store does with the parcel still matters (before the delivery ends). */
const LIVE = new Set([...FULFILLABLE, "shipped"]);
const PAYMENT_FIELDS = new Set<string>(["payment_status", "paid_minor", "refunded_minor"]);

const money = (v: { paid_minor: bigint; refunded_minor: bigint; payment_status: string; cod_minor: bigint; total_minor: bigint; payment_mode: string }) =>
  ({ paid_minor: v.paid_minor, refunded_minor: v.refunded_minor, payment_status: v.payment_status, cod_minor: v.cod_minor, total_minor: v.total_minor, payment_mode: v.payment_mode });

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
const onlineMethod = (gw: string): LedgerMethod => (/instapay/.test(gw) ? "instapay" : /apple/.test(gw) ? "apple_pay" : /wallet|vodafone|meeza|fawry ?pay/.test(gw) ? "wallet" : "card");

/** For orders that do not come from a store connection (E5-5: entered by the team). */
export interface ProjectOptions {
  channel?: "manual";
  /** Who entered it; the engine otherwise. */
  actor?: { type: "user"; id: string };
  /** Mizan variant per line id, for lines picked from the catalogue. */
  variantIds?: Record<string, string>;
}

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
/** JSON with keys in order: the snapshot comes back from jsonb with its keys reordered. */
const stable = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x && typeof x === "object" && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x));

/** A store copy of a Mizan order as Mizan last saw it: what the next read is compared with. */
interface CopySnapshot { lines: Record<string, { q: number; p: string }>; shipping: string; total: string; address: string; name: string; tags: string[]; sentPaid: string }
function copySnapshot(o: CanonicalOrder): Omit<CopySnapshot, "sentPaid"> {
  const a = o.shippingAddress;
  // Shopify needs a last name: a one-word name was sent as "Name -"; that placeholder is not a new name.
  const name = (a?.name ?? "").replace(/\s+-$/, "").trim();
  return {
    lines: Object.fromEntries(o.lines.filter((l) => l.quantity > 0).map((l) => [l.externalLineId, { q: l.quantity, p: l.unitPrice.amount }])),
    shipping: o.shipping?.amount ?? "0", total: o.total.amount,
    address: JSON.stringify([a?.line1 ?? "", a?.line2 ?? "", a?.city ?? "", a?.province ?? "", a?.phone ?? ""]), name,
    tags: o.tags.filter((t) => t !== "mizan").sort(),
  };
}

@Injectable()
export class OrderProjector {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(PiiCipher) private readonly cipher: PiiCipher,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(DuplicatesService) private readonly duplicates: DuplicatesService,
    @Inject(RiskService) private readonly risk: RiskService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(ENGINE_RUNTIME) private readonly runtime: RuntimeFactory,
  ) {}

  async project(tenantId: string, connectionId: string | null, order: CanonicalOrder, opts: ProjectOptions = {}): Promise<ProjectResult> {
    return this.db.tenant(tenantId, (trx) => this.projectIn(trx, tenantId, connectionId, order, opts));
  }

  /** The same, inside the caller's tenant transaction (a manual order numbers itself first). */
  async projectIn(trx: Transaction<DB>, tenantId: string, connectionId: string | null, order: CanonicalOrder, opts: ProjectOptions = {}): Promise<ProjectResult> {
    // Two-way orders: the store's copy of an order made in Mizan is linked to it, never imported as a second
    // order; then what changed in the store (items, money, address, payments, a cancel) updates Mizan's order.
    let copyOf: string | null = null;
    if (connectionId && order.mizanOrderId) {
      const own = await trx.selectFrom("orders").select(["id", "number", "status", "store_copy_connection_id", "store_copy_id"])
        .where("id", "=", order.mizanOrderId).where("connection_id", "is", null).forUpdate().executeTakeFirst();
      if (own) {
        if (await this.linkCopy(trx, tenantId, connectionId, order, own) === "duplicate") return { orderId: own.id, created: false, changed: [] };
        copyOf = own.id;
      }
    }
    const pii = await this.cipher.forTenant(trx, tenantId);
    const phoneCountry = await phoneCountryOf(trx, tenantId);

    if (copyOf) return this.applyCopy(trx, tenantId, connectionId!, order, copyOf);
    const existing = await trx.selectFrom("orders").select(["id", "customer_id", "pii_redacted_at", ...TRACKED])
        .where((eb) => (connectionId === null ? eb("connection_id", "is", null) : eb("connection_id", "=", connectionId)))
        .where("external_id", "=", order.externalId).forUpdate().executeTakeFirst();
    // A redacted order (E3-3) keeps its business facts; its personal data never comes back.
    const redacted = Boolean(existing?.pii_redacted_at);

    const rawPhone = order.shippingAddress?.phone ?? order.customer.phone;
    const phone = redacted ? undefined : normalizePhone(rawPhone, phoneCountry);
    const customerId = redacted ? existing!.customer_id : phone ? await this.upsertCustomer(trx, tenantId, pii, order, phone.e164) : null;

    const values = { ...this.orderValues(order, pii, phone?.e164 ?? rawPhone ?? null), ...(redacted ? REDACTED_ORDER : {}) };
    // The store's totals become ledger lines; the order's money is the ledger's sums (E14-1),
    // so payments the team or a gateway recorded in Mizan stay counted.
    if (existing) Object.assign(values, await this.ledger.syncStore(trx, tenantId, existing.id, connectionId, this.ledgerSource(order), { ...money(values), previous_status: existing.payment_status }));

    if (!existing) {
      const row = await trx.insertInto("orders").values({
        tenant_id: tenantId, connection_id: connectionId, external_id: order.externalId, customer_id: customerId,
        ...values, status: order.cancelled ? "cancelled" : "new", placed_at: order.createdAt, ...(opts.channel ? { channel: opts.channel } : {}),
      }).returning(["id", "status"]).executeTakeFirstOrThrow();
      await this.syncLines(trx, tenantId, row.id, order, opts.variantIds);
      await this.syncSource(trx, tenantId, row.id, order, opts, false);
      await this.ledger.syncStore(trx, tenantId, row.id, connectionId, this.ledgerSource(order), { ...money(values), previous_status: values.payment_status });
      if (customerId) {
        await trx.updateTable("customers").set((eb) => ({ orders_count: eb("orders_count", "+", 1) })).where("id", "=", customerId).execute();
      }
      await trx.insertInto("order_events").values({ tenant_id: tenantId, order_id: row.id, type: "created", to_status: row.status, actor_type: opts.actor ? "user" : "system", actor_id: opts.actor?.id ?? null, data: JSON.stringify({ source: order.connector }) }).execute();
      await this.events.emit(trx, { type: "order.created", tenantId, entity: { type: "order", id: row.id }, actor: opts.actor ?? { type: "engine" }, data: this.eventData(order, row.status, values) });
      if (row.status === "cancelled") {
        await this.events.emit(trx, { type: "order.cancelled", tenantId, entity: { type: "order", id: row.id }, actor: { type: "engine" }, data: { number: order.number, reason: "cancelled_in_store" } });
      } else {
        // Same transaction as the order: marked before anything reacts to order.created (E5-3).
        await this.duplicates.detect(trx, tenantId, row.id);
        // Scored with what is in the clear only here (E6-1); stored, the address and phone are encrypted.
        const a = order.shippingAddress;
        await this.risk.score(trx, tenantId, row.id, {
          line1Length: (a?.line1 ?? "").trim().length, hasCity: Boolean(a?.city?.trim()), phoneValid: Boolean(phone),
          totalQuantity: order.lines.reduce((n, l) => n + l.quantity, 0),
        });
      }
      return { orderId: row.id, created: true, changed: [] };
    }

    // A store without order tags (WooCommerce) sends none: the order keeps the tags the team,
    // bulk actions and automations gave it (O2). Shopify's tags are the store's and Mizan's both.
    if (!STORE_TAGS.has(order.connector)) values.tags = existing.tags;
    const status = order.cancelled && CANCELLABLE.has(existing.status) ? "cancelled" : existing.status;
    const next = { ...values, status };
    const changed = TRACKED.filter((k) => JSON.stringify(normalize(existing[k])) !== JSON.stringify(normalize(next[k])));
    await trx.updateTable("orders").set({
      ...values, status, customer_id: customerId, updated_at: new Date(),
      ...(status === "cancelled" && existing.status !== "cancelled" ? { cancelled_at: new Date() } : {}),
    }).where("id", "=", existing.id).execute();
    await this.syncLines(trx, tenantId, existing.id, order, opts.variantIds);
    await this.syncSource(trx, tenantId, existing.id, order, opts, redacted);

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

    // Two-way delivery, store → Mizan: shipped in the store with another courier (a fulfillment with
    // a tracking number Mizan never booked) becomes a Mizan shipment, so the order leaves the
    // confirmation and shipping queues and its statuses can follow.
    if (LIVE.has(status)) await this.storeFulfilled(trx, tenantId, existing.id, order);
    // Cancelled in the store after the courier has it: the delivery waits for a person (cancel at the courier, or keep it). Once.
    if (order.cancelled && status !== "cancelled" && existing.status === "shipped") await this.storeCancelledAfterShipping(trx, tenantId, existing.id, order.number);

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
  }

  /**
   * The store's copy of an order made in Mizan: linked to it (a second copy, from two creates that
   * raced, is cancelled in the store). What changed in the copy then updates Mizan's order like any
   * store order (projectIn). Mizan's own edits reach the copy first, so they come back unchanged.
   */
  private async linkCopy(trx: Transaction<DB>, tenantId: string, connectionId: string, order: CanonicalOrder,
    own: { id: string; number: string; status: string; store_copy_connection_id: string | null; store_copy_id: string | null }): Promise<"linked" | "duplicate"> {
    if (own.store_copy_id && (own.store_copy_id !== order.externalId || own.store_copy_connection_id !== connectionId)) {
      if (!order.cancelled) {
        const store = new SqlStore(trxQueryClient(trx), { tenantId, connections: { shopify: connectionId } });
        await store.enqueue(MizanEngine.shopifyCancelJob({ orderId: order.externalId, reason: "OTHER", note: `Mizan: a second copy of ${own.number}` }), this.runtime(tenantId).clock.now());
      }
      return "duplicate";
    }
    if (!own.store_copy_id) {
      await trx.updateTable("orders").set({ store_copy_connection_id: connectionId, store_copy_id: order.externalId, store_copy_name: order.number || null, store_copy_status: "created", store_copy_error: null })
        .where("id", "=", own.id).execute();
    }
    return "linked";
  }

  /**
   * The store's copy of an order made in Mizan, read again: compared with the copy as Mizan last saw it, and only
   * what changed in the store since then updates Mizan's order (three-way). An edit made in Mizan that the copy
   * does not have yet, or that the store refused, is never undone; Mizan's own edit coming back changes nothing.
   * The order stays Mizan's in how it is paid and numbered; money counts beyond what Mizan sent with the copy.
   */
  private async applyCopy(trx: Transaction<DB>, tenantId: string, connectionId: string, order: CanonicalOrder, orderId: string): Promise<ProjectResult> {
    const o = await trx.selectFrom("orders").select(["id", "number", "status", "tags", "currency", "payment_mode", "payment_status", "paid_minor", "refunded_minor", "cod_minor", "total_minor", "pii_redacted_at", "store_copy_snapshot", "store_copy_status"])
      .where("id", "=", orderId).forUpdate().executeTakeFirstOrThrow();
    const prev = (o.store_copy_snapshot ?? {}) as Partial<CopySnapshot>;
    const now = copySnapshot(order);
    const minor = (m: CanonicalOrder["total"] | undefined) => (m ? toMinor({ ...m, currency: m.currency || order.currency }) : 0n);
    const changed: string[] = [];
    const set: Record<string, unknown> = {};

    // No baseline yet (the first read since copies were read three-way): the copy is taken as it is, since Mizan
    // pushes its own edits to it; unless a Mizan edit is still on its way there, or the store refused one.
    const baseline = Boolean(prev.lines);
    const editPending = !baseline && Boolean(await trx.selectFrom("mz_outbox").select("id").where("idempotency_key", "like", `shopify:copy-edit:${o.id}:%`)
      .where("status", "in", ["pending", "running"]).executeTakeFirst());
    if (baseline || (!editPending && o.store_copy_status !== "failed")) {
      // Items, quantities, prices or the delivery fee changed in the store: the order takes the copy's lines and money.
      if (stable(prev.lines) !== stable(now.lines) || prev.shipping !== now.shipping || prev.total !== now.total) {
        await this.syncLines(trx, tenantId, o.id, order, undefined, connectionId);
        Object.assign(set, { subtotal_minor: minor(order.subtotal), shipping_minor: minor(order.shipping), total_minor: minor(order.total) });
        changed.push("total_minor");
      }
      // The address (or the name) changed in the store, and the store has one: the order takes it.
      if (!o.pii_redacted_at && order.shippingAddress?.line1 && (prev.address !== now.address || prev.name !== now.name)) {
        const pii = await this.cipher.forTenant(trx, tenantId);
        const phone = normalizePhone(order.shippingAddress.phone ?? order.customer.phone, await phoneCountryOf(trx, tenantId))?.e164 ?? null;
        const v = this.orderValues({ ...order, paymentMode: o.payment_mode as CanonicalOrder["paymentMode"], shippingAddress: { ...order.shippingAddress, name: now.name || undefined } }, pii, phone);
        if (prev.address !== now.address) Object.assign(set, { ship_line1: v.ship_line1, ship_line2: v.ship_line2, ship_city: v.ship_city, ship_province: v.ship_province, ship_country: v.ship_country, ...(phone ? { ship_phone: v.ship_phone, phone_last4: v.phone_last4 } : {}) });
        if (prev.name !== now.name && now.name) Object.assign(set, { ship_name: v.ship_name, customer_label: v.customer_label });
        changed.push("address");
      }
      // Tags added or taken off in the store since the last read; the team's own stay.
      const added = now.tags.filter((t) => !prev.tags?.includes(t));
      const removed = (prev.tags ?? []).filter((t) => !now.tags.includes(t));
      const tags = [...new Set([...o.tags.filter((t) => !removed.includes(t)), ...added])];
      if (JSON.stringify(tags) !== JSON.stringify(o.tags)) { set.tags = tags; changed.push("tags"); }
    }

    // Money: the copy's received total beyond what Mizan sent with it is the store's (a payment taken there).
    const sent = BigInt(prev.sentPaid ?? "0");
    const received = minor(order.received);
    const total = (set.total_minor as bigint | undefined) ?? BigInt(o.total_minor);
    const money = await this.ledger.syncStore(trx, tenantId, o.id, connectionId, this.ledgerSource(order), {
      paid_minor: received > sent ? received - sent : 0n, refunded_minor: minor(order.refunded), payment_status: o.payment_status,
      cod_minor: BigInt(o.cod_minor), total_minor: total, payment_mode: o.payment_mode, previous_status: o.payment_status,
    });
    const owed = total > money.paid_minor ? total - money.paid_minor : 0n;
    const cod = o.payment_mode === "cod" || o.payment_mode === "partial" ? owed : money.cod_minor;
    // The payment status follows the money (the order's ledger: Mizan's own lines and the store's beyond them).
    const paidNet = money.paid_minor - money.refunded_minor;
    const paymentStatus = money.refunded_minor > 0n && paidNet <= 0n ? "refunded" : money.refunded_minor > 0n ? "partially_refunded"
      : money.paid_minor >= total && total > 0n ? "paid" : money.paid_minor > 0n ? "partially_paid" : o.payment_status;
    Object.assign(set, { paid_minor: money.paid_minor, refunded_minor: money.refunded_minor, payment_status: paymentStatus, cod_minor: cod });
    const paymentChanged = money.paid_minor !== BigInt(o.paid_minor) || money.refunded_minor !== BigInt(o.refunded_minor) || paymentStatus !== o.payment_status;
    if (cod !== BigInt(o.cod_minor)) changed.push("cod_minor");
    if (paymentChanged) changed.push("payment_status");

    const status = order.cancelled && CANCELLABLE.has(o.status) ? "cancelled" : o.status;
    if (status !== o.status) { set.status = status; set.cancelled_at = new Date(); changed.push("status"); }
    await trx.updateTable("orders").set({ ...set, store_copy_snapshot: JSON.stringify({ ...now, sentPaid: String(sent) }), updated_at: new Date() } as never).where("id", "=", o.id).execute();

    if (paymentChanged) {
      await this.events.emit(trx, { type: "order.payment_changed", tenantId, entity: { type: "order", id: o.id }, actor: { type: "engine" },
        data: { number: o.number, mode: o.payment_mode, from: o.payment_status, to: paymentStatus, paidMinor: String(money.paid_minor), refundedMinor: String(money.refunded_minor), currency: o.currency } });
    }
    if (LIVE.has(status)) await this.storeFulfilled(trx, tenantId, o.id, order);
    if (order.cancelled && status !== "cancelled" && o.status === "shipped") await this.storeCancelledAfterShipping(trx, tenantId, o.id, o.number);
    if (changed.length) {
      await trx.insertInto("order_events").values({ tenant_id: tenantId, order_id: o.id, type: "updated", from_status: o.status, to_status: status, actor_type: "system", data: JSON.stringify({ changed, source: "store_copy" }) }).execute();
      await this.events.emit(trx, { type: "order.updated", tenantId, entity: { type: "order", id: o.id }, actor: { type: "engine" }, data: { number: o.number, status, changed } });
      if (status === "cancelled" && o.status !== "cancelled") {
        await this.events.emit(trx, { type: "order.cancelled", tenantId, entity: { type: "order", id: o.id }, actor: { type: "engine" }, data: { number: o.number, reason: "cancelled_in_store" } });
      }
    }
    return { orderId: o.id, created: false, changed };
  }

  /** The store cancelled an order the courier already has: marked once, and the delivery waits for a person. */
  private async storeCancelledAfterShipping(trx: Transaction<DB>, tenantId: string, orderId: string, number: string) {
    const r = await trx.updateTable("orders").set({ store_cancelled_at: new Date() }).where("id", "=", orderId).where("store_cancelled_at", "is", null).executeTakeFirst();
    if (!Number(r.numUpdatedRows)) return;
    await this.events.emit(trx, { type: "order.cancelled_after_shipping", tenantId, entity: { type: "order", id: orderId }, actor: { type: "engine" }, data: { number } });
  }

  private async storeFulfilled(trx: Transaction<DB>, tenantId: string, orderId: string, order: CanonicalOrder) {
    const all = order.storeFulfillments ?? [];
    if (!all.length) return;
    const mine = await trx.selectFrom("shipments").select(["tracking_number", "external_id", "status"]).where("order_id", "=", orderId).execute();
    // Tracking numbers Mizan knows: every one it booked (a delivery cancelled at the courier stays known: its old
    // fulfillment in the store is not a new parcel), except a store's own fulfillment that was cancelled there.
    const known = new Set(mine.filter((m) => m.tracking_number && !(m.status === "cancelled" && m.external_id?.startsWith("gid://shopify/Fulfillment/"))).map((m) => m.tracking_number));
    // Shipped in the store: with a tracking number Mizan does not know, or marked fulfilled with none (known by its id).
    const knownIds = new Set(mine.map((m) => m.external_id).filter(Boolean));
    const fresh = all.filter((f) => f.status === "SUCCESS" && (f.trackingNumber ? !known.has(f.trackingNumber) : !knownIds.has(f.externalId)));
    // A fulfillment made in the store and then cancelled there: Mizan's record of it is cancelled too, and a
    // replacement made in the same change is recorded after it, in one step (never in the wrong order).
    // The store cancelled the fulfillment of a delivery Mizan booked (the courier still has the parcel): a person decides.
    for (const f of all.filter((x) => x.status === "CANCELLED" && x.trackingNumber)) {
      const booked = mine.find((m) => m.tracking_number === f.trackingNumber && m.status !== "cancelled" && !m.external_id?.startsWith("gid://shopify/Fulfillment/"));
      if (booked) await this.events.emit(trx, { type: "order.store_fulfillment_cancelled", tenantId, entity: { type: "order", id: orderId }, actor: { type: "engine" }, data: { number: order.number, fulfillmentId: f.externalId, trackingNumber: f.trackingNumber!, mizanBooked: true } });
    }
    const gone = all.find((x) => x.status === "CANCELLED" && mine.some((m) => m.external_id === x.externalId && m.status !== "cancelled"));
    if (gone) {
      const r = fresh[0];
      await this.events.emit(trx, { type: "order.store_fulfillment_cancelled", tenantId, entity: { type: "order", id: orderId }, actor: { type: "engine" },
        data: { number: order.number, fulfillmentId: gone.externalId, ...(r ? { replacement: { fulfillmentId: r.externalId, company: r.company ?? null, trackingNumber: r.trackingNumber ?? null, trackingUrl: r.trackingUrl ?? null } } : {}) } });
      return;
    }
    const f = fresh[0];
    if (!f) return;
    await this.events.emit(trx, {
      type: "order.store_fulfilled", tenantId, entity: { type: "order", id: orderId }, actor: { type: "engine" },
      data: { number: order.number, fulfillmentId: f.externalId, company: f.company ?? null, trackingNumber: f.trackingNumber ?? null, trackingUrl: f.trackingUrl ?? null },
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

  private ledgerSource(order: CanonicalOrder) {
    return { externalId: order.externalId, currency: order.currency, at: order.updatedAt, method: (first: boolean) => ledgerMethod(order, first) };
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
      customer_label: pii.encrypt(customerLabel(a?.name ?? order.customer.name), "orders.customer_label"),
      phone_last4: lastFour(shipPhone),
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
  /**
   * Where the order came from (M7-2), resolved from the store's hints by the ranked rules. Orders the
   * team typed in carry what the team said (Instagram, WhatsApp, walk-in…), else "manual". A later read with nothing to go on never erases an earlier answer
   * (Shopify's journey can arrive after the order). A redacted order keeps no click id.
   */
  private async syncSource(trx: Transaction<DB>, tenantId: string, orderId: string, order: CanonicalOrder, opts: ProjectOptions, redacted: boolean) {
    const s = resolveOrderSource(order.source ?? (opts.channel === "manual" ? { channel: "manual" } : undefined));
    const row = {
      platform: s.platform, paid: s.paid, rule: s.rule,
      utm_source: s.utm.source ?? null, utm_medium: s.utm.medium ?? null, utm_campaign: s.utm.campaign ?? null,
      utm_content: s.utm.content ?? null, utm_term: s.utm.term ?? null, utm_id: s.utm.id ?? null,
      click_id_kind: !redacted && s.clickId ? s.clickId.kind : null, click_id: !redacted && s.clickId ? s.clickId.value : null,
      referrer_domain: s.referrerDomain ?? null, landing_path: s.landingPath ?? null,
      first_platform: s.firstPlatform ?? null, first_seen_at: s.firstSeenAt ? new Date(s.firstSeenAt) : null,
      discount_codes: s.discountCodes, updated_at: new Date(),
    };
    const insert = trx.insertInto("order_sources").values({ tenant_id: tenantId, order_id: orderId, ...row });
    await (s.rule === "none"
      ? insert.onConflict((oc) => oc.columns(["tenant_id", "order_id"]).doNothing())
      : insert.onConflict((oc) => oc.columns(["tenant_id", "order_id"]).doUpdateSet(row))).execute();
  }

  private async syncLines(trx: Transaction<DB>, tenantId: string, orderId: string, order: CanonicalOrder, picked?: Record<string, string>, copyStore?: string) {
    const current = await trx.selectFrom("order_lines").select(["id", "external_line_id", "external_variant_id", "variant_id", "title", "sku"]).where("order_id", "=", orderId).execute();
    const byExt = new Map(current.map((l) => [l.external_line_id, l.id]));
    // A copy's lines carry the store's line ids; the order's own lines were Mizan's. Matched once by variant
    // (or title and SKU), they take the store's id: the line, its catalogue link and its reservation stay.
    if (copyStore) {
      const variantOf = new Map((await trx.selectFrom("external_variants").select(["external_id", "variant_id"]).where("connection_id", "=", copyStore)
        .where("external_id", "in", [...new Set(order.lines.map((l) => l.variantExternalId).filter((x): x is string => Boolean(x)))].concat(["-"])).execute()).map((x) => [x.external_id, x.variant_id]));
      const free = current.filter((l) => !order.lines.some((x) => x.externalLineId === l.external_line_id));
      for (const line of order.lines) {
        if (byExt.has(line.externalLineId)) continue;
        const mine = line.variantExternalId ? variantOf.get(line.variantExternalId) : undefined;
        const i = free.findIndex((l) => (mine && l.variant_id === mine) || (line.variantExternalId && l.external_variant_id === line.variantExternalId) || (!l.variant_id && l.title === line.title && (l.sku ?? "") === (line.sku ?? "")));
        if (i < 0) continue;
        const [l] = free.splice(i, 1);
        await trx.updateTable("order_lines").set({ external_line_id: line.externalLineId }).where("id", "=", l!.id).execute();
        byExt.set(line.externalLineId, l!.id);
      }
    }
    const keep = new Set<string>();
    // The store's variant → Mizan's variant; a product not read yet links later (ProductProjector).
    const extIds = [...new Set(order.lines.map((l) => l.variantExternalId).filter((x): x is string => Boolean(x)))];
    const conn = extIds.length ? copyStore ?? (await trx.selectFrom("orders").select("connection_id").where("id", "=", orderId).executeTakeFirst())?.connection_id : null;
    const links = conn
      ? new Map((await trx.selectFrom("external_variants").select(["external_id", "variant_id"]).where("connection_id", "=", conn).where("external_id", "in", extIds).execute())
        .map((x) => [x.external_id, x.variant_id]))
      : new Map<string, string | null>();
    for (const [position, line] of order.lines.filter((l) => l.quantity > 0).entries()) {
      const values = {
        sku: line.sku ?? null, title: line.title, quantity: line.quantity, position,
        unit_price_minor: toMinor({ ...line.unitPrice, currency: line.unitPrice.currency || order.currency }),
        external_variant_id: line.variantExternalId ?? null,
      };
      const variantId = line.variantExternalId ? links.get(line.variantExternalId) : picked?.[line.externalLineId];
      const linked = variantId ? { variant_id: variantId } : {};
      const id = byExt.get(line.externalLineId);
      if (id) {
        keep.add(id);
        // A copy's line keeps Mizan's own title ("Product — Variant"); the store shows the product's.
        const { title: _title, ...rest } = values;
        await trx.updateTable("order_lines").set({ ...(copyStore ? rest : values), ...linked }).where("id", "=", id).execute();
      } else {
        await trx.insertInto("order_lines").values({ tenant_id: tenantId, order_id: orderId, external_line_id: line.externalLineId, ...values, ...linked }).execute();
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
