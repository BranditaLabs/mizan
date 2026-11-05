import { StoreCopyService } from "./store-copy.service.js";
import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { trxQueryClient, type DB } from "@mizan/db";
import { MizanEngine, SqlStore, type OrderEditOutcome, type OrderEditPlan } from "@mizan/engine";
import { fromMinor, toMinor, type CanonicalOrder } from "@mizan/shared";
import type { z } from "zod";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { AuditService, auditActor } from "../../platform/audit/audit.service.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import { PiiCipher } from "../../platform/pii/pii-cipher.js";
import { OrderProjector } from "./order-projector.js";
import type { OrderEditInputSchema, OrderEditResultSchema } from "./orders.dto.js";
import { roleScope } from "./orders.service.js";

type Input = z.output<typeof OrderEditInputSchema>;
type Result = z.infer<typeof OrderEditResultSchema>;
/** What an edit keeps (no personal data): Mizan's ids and the store's, quantities, prices, the fee. */
interface Changes {
  lines: Array<{ lineId: string; storeLineId: string | null; storeVariantId: string | null; quantity: number; unitPrice?: string }>;
  add: Array<{ variantId: string; storeVariantId: string | null; quantity: number; unitPrice?: string }>;
  shipping?: string;
  address: boolean;
}
type Address = NonNullable<Input["address"]>;

/** Before the courier has it: new, waiting for or past confirmation. */
const EDITABLE = new Set(["new", "pending_confirmation", "confirmed"]);
/** Modes where the customer paid ahead: a higher total would leave money the courier cannot collect. */
const PAID_AHEAD = new Set(["prepaid", "bnpl", "bank_transfer", "store_credit"]);
const STORES = new Set(["shopify", "woocommerce"]);
const problem = (status: number, code: string, detail: string) => new ProblemError(status, code, detail);

/**
 * O3: change an order before it ships — quantities, items, prices, the delivery fee, the address.
 * A manual order changes at once (rebuilt and projected again, so totals, cash to collect, stock
 * and profit follow as for any order change). A store order's edit goes to the store through the
 * outbox (rule 3) and the order follows from what the store then says (thin webhook, fat fetch);
 * until then it shows as being sent. One edit at a time per order; every edit is audited.
 */
@Injectable()
export class OrderEditsService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(PiiCipher) private readonly cipher: PiiCipher,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(OrderProjector) private readonly projector: OrderProjector,
    @Inject(StoreCopyService) private readonly copies: StoreCopyService,
  ) {}

  async edit(auth: AuthContext, orderId: string, input: Input): Promise<Result> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const o = await trx.selectFrom("orders as o").leftJoin("connections as c", "c.id", "o.connection_id")
        .select(["o.id", "o.number", "o.status", "o.external_id", "o.connection_id", "c.provider", "o.currency", "o.subtotal_minor", "o.shipping_minor", "o.total_minor",
          "o.paid_minor", "o.payment_mode", "o.pii_redacted_at"])
        .where("o.id", "=", orderId).where((eb) => roleScope(eb as never, auth)).forUpdate("o").executeTakeFirst();
      if (!o) throw problem(404, "not_found", "no such order in this store");
      if (!EDITABLE.has(o.status)) throw problem(409, "not_editable", `a ${o.status} order cannot be edited`);
      const live = await trx.selectFrom("shipments").select("id").where("order_id", "=", o.id).where("is_return_leg", "=", false)
        .where("booking", "!=", "failed").where("status", "!=", "cancelled").executeTakeFirst();
      if (live) throw problem(409, "not_editable", "the order is with the courier: cancel the delivery first");
      const sending = await trx.selectFrom("order_edits").select("id").where("order_id", "=", o.id).where("status", "=", "sending").executeTakeFirst();
      if (sending) throw problem(409, "edit_in_progress", "an earlier edit is still on its way to the store");
      if (input.address && o.pii_redacted_at) throw problem(409, "pii_redacted", "the customer's data was deleted: the address cannot be changed");
      const store = o.connection_id && o.provider && STORES.has(o.provider) && o.external_id ? { provider: o.provider as "shopify" | "woocommerce", connectionId: o.connection_id, orderId: o.external_id } : null;
      if (o.connection_id && !store) throw problem(409, "not_editable", "orders from this channel are edited where they were placed");
      if (store?.provider === "shopify" && [...input.lines, ...input.add].some((l) => l.unitPrice !== undefined)) {
        throw problem(422, "price_in_store", "Shopify keeps an item's price when an order is edited: change the price in Shopify");
      }

      // ── what the order will hold ──
      const current = await trx.selectFrom("order_lines").select(["id", "external_line_id", "external_variant_id", "variant_id", "quantity", "unit_price_minor", "title", "sku"])
        .where("order_id", "=", o.id).orderBy("position").orderBy("id").execute();
      const byId = new Map(current.map((l) => [l.id, l]));
      for (const l of input.lines) if (!byId.has(l.lineId)) throw problem(422, "unknown_line", "a line is not on this order");
      const m = (amount: string) => toMinor({ amount, currency: o.currency.trim() });
      const variants = input.add.length ? await trx.selectFrom("variants as v").innerJoin("products as p", "p.id", "v.product_id")
        .select(["v.id", "v.sku", "v.title", "p.title as product", "v.price_minor", "v.currency"]).where("v.id", "in", input.add.map((a) => a.variantId)).execute() : [];
      const variantOf = new Map(variants.map((v) => [v.id, v]));
      const links = store && input.add.length ? new Map((await trx.selectFrom("external_variants").select(["variant_id", "external_id"])
        .where("connection_id", "=", store.connectionId).where("variant_id", "in", input.add.map((a) => a.variantId)).execute()).map((x) => [x.variant_id, x.external_id])) : new Map<string, string>();

      const lineChanges = new Map(input.lines.map((l) => [l.lineId, l]));
      const adds: Changes["add"] = [];
      for (const a of input.add) {
        const v = variantOf.get(a.variantId);
        if (!v) throw problem(422, "unknown_product", "a product is not in the catalogue");
        if (v.currency.trim() !== o.currency.trim()) throw problem(422, "currency_mismatch", `the product is priced in ${v.currency.trim()}, the order in ${o.currency.trim()}`);
        if (store && !links.get(a.variantId)) throw problem(422, "not_in_store", "the product is not in this order's store");
        // Already on the order: more of the same line.
        const same = current.find((l) => l.variant_id === a.variantId);
        if (same) {
          const prior = lineChanges.get(same.id);
          lineChanges.set(same.id, { lineId: same.id, quantity: (prior?.quantity ?? same.quantity) + a.quantity, ...(a.unitPrice ?? prior?.unitPrice ? { unitPrice: (a.unitPrice ?? prior?.unitPrice)! } : {}) });
          continue;
        }
        adds.push({ variantId: a.variantId, storeVariantId: links.get(a.variantId) ?? null, quantity: a.quantity, ...(a.unitPrice !== undefined ? { unitPrice: a.unitPrice } : {}) });
      }
      const lines: Changes["lines"] = [...lineChanges.values()].flatMap((c) => {
        const l = byId.get(c.lineId)!;
        const priceChanged = c.unitPrice !== undefined && m(c.unitPrice) !== BigInt(l.unit_price_minor);
        if (c.quantity === l.quantity && !priceChanged) return [];
        return [{ lineId: l.id, storeLineId: l.external_line_id, storeVariantId: l.external_variant_id, quantity: c.quantity, ...(priceChanged ? { unitPrice: c.unitPrice! } : {}) }];
      });
      const shipping = input.shipping !== undefined && m(input.shipping) !== BigInt(o.shipping_minor) ? input.shipping : undefined;
      if (!lines.length && !adds.length && shipping === undefined && !input.address) throw problem(422, "no_change", "the order already looks like this");

      // ── the money: what the order comes to, against what was paid ──
      const kept = current.map((l) => {
        const c = lines.find((x) => x.lineId === l.id);
        return { quantity: c ? c.quantity : l.quantity, unit: c?.unitPrice !== undefined ? m(c.unitPrice) : BigInt(l.unit_price_minor) };
      });
      const added = adds.map((a) => ({ quantity: a.quantity, unit: a.unitPrice !== undefined ? m(a.unitPrice) : BigInt(variantOf.get(a.variantId)!.price_minor) }));
      const pieces = [...kept, ...added].reduce((n, l) => n + l.quantity, 0);
      if (pieces === 0) throw problem(422, "no_items", "an order needs at least one item: cancel it instead");
      const subtotal = [...kept, ...added].reduce((n, l) => n + l.unit * BigInt(l.quantity), 0n);
      const discount = BigInt(o.subtotal_minor) + BigInt(o.shipping_minor) - BigInt(o.total_minor);
      const fee = shipping !== undefined ? m(shipping) : BigInt(o.shipping_minor);
      const total = subtotal + fee - discount;
      if (total <= 0n) throw problem(422, "total_invalid", "the order would come to nothing");
      if (total < BigInt(o.paid_minor)) throw problem(409, "refund_first", "the customer paid more than the new total: refund the difference first");
      if (PAID_AHEAD.has(o.payment_mode) && total > BigInt(o.total_minor)) throw problem(409, "paid_order", "the customer paid ahead: a higher total needs a new payment, not an edit");

      const changes: Changes = { lines, add: adds, ...(shipping !== undefined ? { shipping } : {}), address: Boolean(input.address) };
      // A new address takes its own pin, or none: the old pin would send the driver to the old place.
      if (input.address) await trx.updateTable("orders").set({ ship_lat: input.address.location?.lat ?? null, ship_lng: input.address.location?.lng ?? null }).where("id", "=", o.id).execute();
      const pii = await this.cipher.forTenant(trx, tenantId);
      const summary = { lines: lines.length, added: adds.length, shipping: shipping !== undefined, address: Boolean(input.address) };

      if (!store) {
        await this.applyManual(trx, tenantId, o.id, changes, input.address, variantOf, auth);
        const row = await trx.insertInto("order_edits").values({ tenant_id: tenantId, order_id: o.id, requested_by: auth.user.id, status: "applied", changes: JSON.stringify(changes), settled_at: new Date() })
          .returning("id").executeTakeFirstOrThrow();
        await this.timeline(trx, tenantId, o.id, "edited", summary, auth.user.id);
        await this.events.emit(trx, { type: "order.edited", tenantId, entity: { type: "order", id: o.id }, actor: { type: "user", id: auth.user.id }, data: { number: o.number, editId: row.id, ...summary } });
        await this.audit.record(trx, { action: "order.edited", tenantId, ...auditActor(auth), entity: { type: "order", id: o.id }, after: { editId: row.id, ...summary } });
        // An order made in Mizan with a copy in the store: the copy follows (or a refused copy is tried again).
        await this.copies.edited(trx, tenantId, o.id, row.id);
        return { editId: row.id, status: "applied" as const };
      }

      const row = await trx.insertInto("order_edits").values({
        tenant_id: tenantId, order_id: o.id, requested_by: auth.user.id, changes: JSON.stringify(changes),
        address: input.address ? pii.encrypt(JSON.stringify(input.address), "order_edits.address") : null,
      }).returning("id").executeTakeFirstOrThrow();
      const outbox = new SqlStore(trxQueryClient(trx), { tenantId, connections: { [store.provider]: store.connectionId } });
      await outbox.enqueue(MizanEngine.orderEditJob(store.provider, row.id), Date.now());
      await this.timeline(trx, tenantId, o.id, "edit_requested", summary, auth.user.id);
      await this.audit.record(trx, { action: "order.edited", tenantId, ...auditActor(auth), entity: { type: "order", id: o.id }, after: { editId: row.id, store: store.provider, ...summary } });
      return { editId: row.id, status: "sending" as const };
    });
  }

  /** The engine's loadOrderEdit hook: the edit in the store's terms, with the address decrypted. Only an edit on its way. */
  async loadPlan(tenantId: string, editId: string): Promise<OrderEditPlan | undefined> {
    return this.db.tenant(tenantId, async (trx) => {
      const e = await trx.selectFrom("order_edits as e").innerJoin("orders as o", "o.id", "e.order_id")
        .select(["e.changes", "e.address", "o.external_id", "o.currency", "o.ship_name", "o.ship_phone", "o.ship_country"])
        .where("e.id", "=", editId).where("e.status", "=", "sending").executeTakeFirst();
      if (!e || !e.external_id) return undefined;
      const c = (typeof e.changes === "string" ? JSON.parse(e.changes) : e.changes) as Changes;
      const pii = await this.cipher.forTenant(trx, tenantId);
      const a = e.address ? (JSON.parse(pii.decrypt(e.address, "order_edits.address") ?? "null") as Address | null) : null;
      const name = pii.decrypt(e.ship_name, "orders.ship_name");
      const phone = pii.decrypt(e.ship_phone, "orders.ship_phone");
      return {
        editId, orderId: e.external_id, currency: e.currency.trim(),
        lines: c.lines.filter((l) => l.storeLineId).map((l) => ({ lineId: l.storeLineId!, variantId: l.storeVariantId ?? undefined, quantity: l.quantity, unitPrice: l.unitPrice })),
        add: c.add.filter((x) => x.storeVariantId).map((x) => ({ variantId: x.storeVariantId!, quantity: x.quantity, unitPrice: x.unitPrice })),
        shipping: c.shipping,
        address: a ? { line1: a.line1, line2: a.line2, city: a.city, province: a.province, name: name ?? undefined, phone: phone ?? undefined, countryCode: e.ship_country ?? undefined } : undefined,
      };
    });
  }

  /** The engine's onOrderEditResult hook: settled once; the address it carried is removed. */
  async recordResult(tenantId: string, editId: string, result: OrderEditOutcome): Promise<void> {
    await this.db.tenant(tenantId, async (trx) => {
      const e = await trx.selectFrom("order_edits as e").innerJoin("orders as o", "o.id", "e.order_id").select(["e.id", "e.order_id", "e.changes", "o.number"])
        .where("e.id", "=", editId).where("e.status", "=", "sending").forUpdate("e").executeTakeFirst();
      if (!e) return; // settled already: a repeat
      await trx.updateTable("order_edits").set({
        status: result.ok ? "applied" : "failed", address: null, settled_at: new Date(),
        ...(result.ok ? {} : { failure: result.reason, failure_message: result.message.slice(0, 1000) }),
      }).where("id", "=", e.id).execute();
      const entity = { type: "order", id: e.order_id };
      if (result.ok) {
        await this.timeline(trx, tenantId, e.order_id, "edited", {}, null);
        await this.events.emit(trx, { type: "order.edited", tenantId, entity, actor: { type: "engine" }, data: { number: e.number, editId: e.id } });
      } else {
        await this.timeline(trx, tenantId, e.order_id, "edit_failed", { reason: result.reason }, null);
        await this.events.emit(trx, { type: "order.edit_failed", tenantId, entity, actor: { type: "engine" }, data: { number: e.number, editId: e.id, reason: result.reason } });
      }
    });
  }

  /** A manual order: rebuilt with the change and projected again, so everything that follows an order follows. */
  private async applyManual(trx: Transaction<DB>, tenantId: string, orderId: string, c: Changes, address: Address | undefined,
    variantOf: Map<string, { id: string; sku: string; title: string | null; product: string; price_minor: string | number | bigint }>, auth: AuthContext) {
    const o = await trx.selectFrom("orders").selectAll().where("id", "=", orderId).executeTakeFirstOrThrow();
    const pii = await this.cipher.forTenant(trx, tenantId);
    const currency = o.currency.trim();
    const money = (x: bigint) => fromMinor(x, currency);
    const current = await trx.selectFrom("order_lines").select(["id", "external_line_id", "sku", "title", "quantity", "unit_price_minor"]).where("order_id", "=", orderId).orderBy("position").orderBy("id").execute();
    const lines: CanonicalOrder["lines"] = current.flatMap((l) => {
      const ch = c.lines.find((x) => x.lineId === l.id);
      const quantity = ch ? ch.quantity : l.quantity;
      const unit = ch?.unitPrice !== undefined ? toMinor({ amount: ch.unitPrice, currency }) : BigInt(l.unit_price_minor);
      return [{ externalLineId: l.external_line_id ?? l.id, ...(l.sku ? { sku: l.sku } : {}), title: l.title, quantity, unitPrice: money(unit) }];
    });
    const picked: Record<string, string> = {};
    let n = current.reduce((max, l) => Math.max(max, Number(/^L(\d+)$/.exec(l.external_line_id ?? "")?.[1] ?? 0)), 0);
    for (const a of c.add) {
      const v = variantOf.get(a.variantId)!;
      const externalLineId = `L${++n}`;
      picked[externalLineId] = v.id;
      const unit = a.unitPrice !== undefined ? toMinor({ amount: a.unitPrice, currency }) : BigInt(v.price_minor);
      lines.push({ externalLineId, ...(v.sku ? { sku: v.sku } : {}), title: v.title ? `${v.product} — ${v.title}` : v.product, quantity: a.quantity, unitPrice: money(unit) });
    }
    const subtotal = lines.reduce((s, l) => s + toMinor(l.unitPrice) * BigInt(l.quantity), 0n);
    const discount = BigInt(o.subtotal_minor) + BigInt(o.shipping_minor) - BigInt(o.total_minor);
    const fee = c.shipping !== undefined ? toMinor({ amount: c.shipping, currency }) : BigInt(o.shipping_minor);
    const total = subtotal + fee - discount;
    // What the store side of the ledger holds (the order was typed in: what was paid when it was entered).
    const ledger = await trx.selectFrom("payments").select([
      sql<string>`coalesce(sum(amount_minor) filter (where kind <> 'refund'), 0)`.as("paid"),
      sql<string>`coalesce(-sum(amount_minor) filter (where kind = 'refund'), 0)`.as("refunded"),
    ]).where("order_id", "=", orderId).where("source", "=", "store").where("status", "=", "succeeded").executeTakeFirstOrThrow();
    const paid = BigInt(ledger.paid);
    const status: CanonicalOrder["paymentStatus"] = paid >= total ? "paid" : paid > 0n ? "partially_paid" : "unpaid";
    const name = pii.decrypt(o.ship_name, "orders.ship_name") ?? "";
    const phone = pii.decrypt(o.ship_phone, "orders.ship_phone") ?? undefined;
    const line1 = address?.line1 ?? pii.decrypt(o.ship_line1, "orders.ship_line1") ?? "";
    const line2 = address ? address.line2 : pii.decrypt(o.ship_line2, "orders.ship_line2") ?? undefined;
    const city = address?.city ?? o.ship_city ?? "";
    const province = address ? address.province : o.ship_province ?? undefined;
    const now = new Date().toISOString();
    const country = o.ship_country ?? (await trx.selectFrom("tenants").select("country").where("id", "=", tenantId).executeTakeFirstOrThrow()).country.trim();
    const ship: NonNullable<CanonicalOrder["shippingAddress"]> = { name, line1, city, countryCode: country };
    if (phone) ship.phone = phone;
    if (line2) ship.line2 = line2;
    if (province) ship.province = province;
    const order: CanonicalOrder = {
      connector: "manual", externalId: o.external_id!, number: o.number, createdAt: o.placed_at.toISOString(), updatedAt: now, currency,
      total: money(total), subtotal: money(subtotal), shipping: money(fee), paymentMode: o.payment_mode as CanonicalOrder["paymentMode"], paymentStatus: status, gateways: [],
      received: money(paid), outstanding: money(total > paid ? total - paid : 0n), refunded: money(BigInt(ledger.refunded)), cancelled: false,
      customer: { name, ...(phone ? { phone } : {}) },
      shippingAddress: ship,
      lines, fulfillmentGroups: [], tags: o.tags,
    };
    await this.projector.projectIn(trx, tenantId, null, order, { variantIds: picked, actor: { type: "user", id: auth.user.id } });
  }

  private timeline(trx: Transaction<DB>, tenantId: string, orderId: string, type: string, data: Record<string, unknown>, userId: string | null) {
    return trx.insertInto("order_events").values({ tenant_id: tenantId, order_id: orderId, type, actor_type: userId ? "user" : "system", actor_id: userId, data: JSON.stringify(data) }).execute();
  }
}
