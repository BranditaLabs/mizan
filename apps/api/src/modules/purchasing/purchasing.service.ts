import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { convertMoney, fromMinor, ratio, toMinor, type EventActor } from "@mizan/shared";
import { auditActor, AuditService } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import { FxService } from "../profit/fx/fx.service.js";
import { dayText, localDay, storeClock } from "../profit/store-day.js";
import { StockService } from "../stock/stock.service.js";
import { landedFor, type LandedCost } from "./landed.js";
import {
  PO_STATUSES, purchasingSettings, RECEIVABLE,
  type NewLandedCost, type NewPurchaseOrder, type NewReceipt, type NewSupplier, type PoStatus, type PurchaseOrder, type PurchasingSettings, type UpdateSupplier,
} from "./purchasing.dto.js";

type Trx = Transaction<DB>;
type ReceiptItem = NewReceipt["items"][number];

/** Why a receipt was not taken: the ops app stores it as `rejected` (never applies) or `conflict` (the server's state won). */
export class ReceiptRefused extends Error {
  constructor(readonly status: "rejected" | "conflict", readonly code: string, message: string) { super(message); }
}

const MANAGERS = new Set(["owner", "admin", "ops_manager"]);
const OWNERS = new Set(["owner", "admin"]);
const label = (n: number) => `PO-${String(n).padStart(4, "0")}`;
/** a ÷ b rounded half up, for non-negative integers. */
const divRound = (a: bigint, b: bigint) => (a * 2n + b) / (2n * b);

/**
 * Purchasing (M16-1): suppliers, purchase orders and receiving. A PO is drafted, approved (by
 * the owner or an admin above the store's threshold or in a foreign currency, else by an ops
 * manager too), marked sent, and received in one or more receipts from the web or the ops app.
 * A receipt puts the good units into stock against the PO, records damaged ones, and moves each
 * item's cost to the moving average at the receipt day's FX rate, locked on the receipt. More
 * than ordered needs a manager. The ops app's receipt is applied once per opId.
 */
@Injectable()
export class PurchasingService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(FxService) private readonly fx: FxService,
  ) {}

  // ───────────── Suppliers ─────────────

  async suppliers(tenantId: string, archived: boolean) {
    return this.db.tenant(tenantId, async (trx) => {
      const rows = await trx.selectFrom("suppliers as s").selectAll("s")
        .select((eb) => eb.selectFrom("purchase_orders as po").select(sql<string>`count(*)`.as("n")).whereRef("po.supplier_id", "=", "s.id")
          .where("po.status", "in", ["draft", ...RECEIVABLE]).as("open_orders"))
        .where("s.archived_at", archived ? "is not" : "is", null).orderBy(sql`lower(s.name)`).limit(500).execute();
      return { data: rows.map((s) => this.supplierView(s, Number(s.open_orders ?? 0))) };
    });
  }

  async createSupplier(auth: AuthContext, body: NewSupplier) {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      await this.uniqueName(trx, body.name);
      const s = await trx.insertInto("suppliers").values({ tenant_id: tenantId, ...this.supplierRow(body) } as never).returningAll().executeTakeFirstOrThrow();
      await this.audit.record(trx, { action: "supplier.created", tenantId, entity: { type: "supplier", id: s.id }, after: { name: s.name, currency: s.currency }, ...auditActor(auth) });
      return this.supplierView(s, 0);
    });
  }

  async updateSupplier(auth: AuthContext, id: string, body: UpdateSupplier) {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const cur = await trx.selectFrom("suppliers").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
      if (!cur) throw new ProblemError(404, "not_found", "no such supplier in this store");
      const { archived, ...fields } = body;
      if (fields.name && fields.name.toLowerCase() !== cur.name.toLowerCase()) await this.uniqueName(trx, fields.name, id);
      if (archived === false && cur.archived_at) await this.uniqueName(trx, fields.name ?? cur.name, id);
      const set = { ...this.supplierRow(fields), ...(archived === undefined ? {} : { archived_at: archived ? (cur.archived_at ?? new Date()) : null }), updated_at: new Date() };
      const s = await trx.updateTable("suppliers").set(set as never).where("id", "=", id).returningAll().executeTakeFirstOrThrow();
      await this.audit.record(trx, { action: "supplier.updated", tenantId, entity: { type: "supplier", id }, after: { fields: Object.keys(body) }, ...auditActor(auth) });
      const open = await trx.selectFrom("purchase_orders").select(sql<string>`count(*)`.as("n")).where("supplier_id", "=", id).where("status", "in", ["draft", ...RECEIVABLE]).executeTakeFirstOrThrow();
      return this.supplierView(s, Number(open.n));
    });
  }

  private async uniqueName(trx: Trx, name: string, except?: string) {
    let q = trx.selectFrom("suppliers").select("id").where(sql`lower(name)`, "=", name.trim().toLowerCase()).where("archived_at", "is", null);
    if (except) q = q.where("id", "!=", except);
    if (await q.executeTakeFirst()) throw new ProblemError(409, "supplier_exists", "a supplier with this name already exists");
  }

  private supplierRow(b: Partial<NewSupplier>) {
    const row: Record<string, unknown> = {};
    if (b.name !== undefined) row.name = b.name;
    if (b.currency !== undefined) row.currency = b.currency;
    if (b.contactName !== undefined) row.contact_name = b.contactName || null;
    if (b.phone !== undefined) row.phone_e164 = b.phone.replace(/[\s()-]/g, "") || null;
    if (b.email !== undefined) row.email = b.email || null;
    if (b.country !== undefined) row.country = b.country;
    if (b.leadTimeDays !== undefined) row.lead_time_days = b.leadTimeDays;
    if (b.paymentTerms !== undefined) row.payment_terms = b.paymentTerms || null;
    if (b.notes !== undefined) row.notes = b.notes || null;
    return row;
  }

  private supplierView(s: { id: string; name: string; currency: string; contact_name: string | null; phone_e164: string | null; email: string | null; country: string | null; lead_time_days: number | null; payment_terms: string | null; notes: string | null; archived_at: Date | null }, openOrders: number) {
    return {
      id: s.id, name: s.name, currency: s.currency.trim(), contactName: s.contact_name, phone: s.phone_e164, email: s.email, country: s.country?.trim() ?? null,
      leadTimeDays: s.lead_time_days, paymentTerms: s.payment_terms, notes: s.notes, archived: s.archived_at !== null, openOrders,
    };
  }

  // ───────────── Purchase orders ─────────────

  async list(tenantId: string, q: { status?: PoStatus | "open" | undefined; supplierId?: string | undefined; limit: number }, now = new Date()) {
    return this.db.tenant(tenantId, async (trx) => {
      let query = this.summaryQuery(trx);
      if (q.status === "open") query = query.where("po.status", "in", [...RECEIVABLE]);
      else if (q.status) query = query.where("po.status", "=", q.status);
      if (q.supplierId) query = query.where("po.supplier_id", "=", q.supplierId);
      const rows = await query.orderBy("po.created_at", "desc").limit(q.limit).execute();
      const counted = await trx.selectFrom("purchase_orders").select(["status", sql<string>`count(*)`.as("n")]).groupBy("status").execute();
      const counts = Object.fromEntries(PO_STATUSES.map((s) => [s, Number(counted.find((c) => c.status === s)?.n ?? 0)])) as Record<PoStatus, number>;
      const { timezone } = await storeClock(trx, tenantId);
      return { data: rows.map((r) => this.summary(r, localDay(now, timezone))), counts };
    });
  }

  async get(tenantId: string, id: string, now = new Date()): Promise<PurchaseOrder> {
    return this.db.tenant(tenantId, (trx) => this.view(trx, tenantId, id, now));
  }

  async create(auth: AuthContext, body: NewPurchaseOrder): Promise<PurchaseOrder> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const supplier = await trx.selectFrom("suppliers").select(["id", "currency", "archived_at"]).where("id", "=", body.supplierId).executeTakeFirst();
      if (!supplier) throw new ProblemError(404, "not_found", "no such supplier in this store");
      if (supplier.archived_at) throw new ProblemError(409, "supplier_archived", "this supplier is archived: restore it to order from it");
      const currency = body.currency ?? supplier.currency.trim();
      const lines = await this.priceLines(trx, body.lines, currency);
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`po-number:${tenantId}`}))`.execute(trx);
      const n = await trx.selectFrom("purchase_orders").select(sql<string>`count(*)`.as("n")).executeTakeFirstOrThrow();
      const warehouse = await this.stock.warehouse(trx, tenantId);
      const po = await trx.insertInto("purchase_orders").values({
        tenant_id: tenantId, supplier_id: supplier.id, warehouse_id: warehouse.id, number: label(Number(n.n) + 1), currency,
        total_minor: lines.reduce((s, l) => s + BigInt(l.quantity) * l.unitMinor, 0n), expected_at: body.expectedAt ?? null, notes: body.notes ?? null, created_by: auth.user.id,
      }).returning(["id", "number"]).executeTakeFirstOrThrow();
      await this.insertLines(trx, tenantId, po.id, lines);
      await this.audit.record(trx, { action: "po.created", tenantId, entity: { type: "purchase_order", id: po.id }, after: { number: po.number, lines: lines.length, currency }, ...auditActor(auth) });
      return this.view(trx, tenantId, po.id);
    });
  }

  /** A draft's supplier, date, notes and lines, replaced as a whole. */
  async update(auth: AuthContext, id: string, body: NewPurchaseOrder): Promise<PurchaseOrder> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const po = await this.lockPo(trx, id);
      if (po.status !== "draft") throw new ProblemError(409, "not_draft", `${po.number} is ${po.status}: only a draft can be edited`);
      const supplier = await trx.selectFrom("suppliers").select(["id", "currency", "archived_at"]).where("id", "=", body.supplierId).executeTakeFirst();
      if (!supplier) throw new ProblemError(404, "not_found", "no such supplier in this store");
      if (supplier.archived_at && supplier.id !== po.supplier_id) throw new ProblemError(409, "supplier_archived", "this supplier is archived: restore it to order from it");
      const currency = body.currency ?? supplier.currency.trim();
      const lines = await this.priceLines(trx, body.lines, currency);
      await trx.deleteFrom("purchase_order_lines").where("purchase_order_id", "=", id).execute();
      await this.insertLines(trx, tenantId, id, lines);
      await trx.updateTable("purchase_orders").set({
        supplier_id: supplier.id, currency, expected_at: body.expectedAt ?? null, notes: body.notes ?? null,
        total_minor: lines.reduce((s, l) => s + BigInt(l.quantity) * l.unitMinor, 0n), updated_at: new Date(),
      }).where("id", "=", id).execute();
      await this.audit.record(trx, { action: "po.updated", tenantId, entity: { type: "purchase_order", id }, after: { number: po.number, lines: lines.length, currency }, ...auditActor(auth) });
      return this.view(trx, tenantId, id);
    });
  }

  async approve(auth: AuthContext, id: string): Promise<PurchaseOrder> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const po = await this.lockPo(trx, id);
      if (po.status !== "draft") throw new ProblemError(409, "not_draft", `${po.number} is ${po.status}: only a draft is approved`);
      if (await this.needsOwner(trx, tenantId, po.currency, BigInt(po.total_minor)) && !OWNERS.has(auth.tenant!.role)) {
        throw new ProblemError(403, "needs_owner", "above the approval threshold (or in a foreign currency): the owner or an admin approves this PO");
      }
      const now = new Date();
      await trx.updateTable("purchase_orders").set({ status: "approved", approved_by: auth.user.id, approved_at: now, updated_at: now }).where("id", "=", id).execute();
      const actor: EventActor = { type: "user", id: auth.user.id };
      await this.events.emit(trx, { type: "po.approved", tenantId, entity: { type: "purchase_order", id }, actor, data: { number: po.number, supplierId: po.supplier_id, totalMinor: String(po.total_minor), currency: po.currency.trim() } });
      await this.audit.record(trx, { action: "po.approved", tenantId, entity: { type: "purchase_order", id }, after: { number: po.number }, ...auditActor(auth) });
      return this.view(trx, tenantId, id);
    });
  }

  /** Marked as sent to the supplier (by hand for now; PDF, email and WhatsApp come later). */
  async send(auth: AuthContext, id: string): Promise<PurchaseOrder> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const po = await this.lockPo(trx, id);
      if (po.status === "sent" || po.status === "partially_received" || po.status === "received") return this.view(trx, tenantId, id);
      if (po.status !== "approved") throw new ProblemError(409, "not_approved", `${po.number} is ${po.status}: approve it before sending`);
      const now = new Date();
      await trx.updateTable("purchase_orders").set({ status: "sent", sent_at: now, updated_at: now }).where("id", "=", id).execute();
      await this.events.emit(trx, { type: "po.sent", tenantId, entity: { type: "purchase_order", id }, actor: { type: "user", id: auth.user.id }, data: { number: po.number, supplierId: po.supplier_id } });
      await this.audit.record(trx, { action: "po.sent", tenantId, entity: { type: "purchase_order", id }, after: { number: po.number }, ...auditActor(auth) });
      return this.view(trx, tenantId, id);
    });
  }

  async cancel(auth: AuthContext, id: string): Promise<PurchaseOrder> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const po = await this.lockPo(trx, id);
      if (po.status === "cancelled") return this.view(trx, tenantId, id);
      const got = await trx.selectFrom("purchase_receipts").select("id").where("purchase_order_id", "=", id).executeTakeFirst();
      if (got || po.status === "received" || po.status === "partially_received") throw new ProblemError(409, "has_receipts", `${po.number} already has stock received against it`);
      const now = new Date();
      await trx.updateTable("purchase_orders").set({ status: "cancelled", cancelled_at: now, updated_at: now }).where("id", "=", id).execute();
      await this.events.emit(trx, { type: "po.cancelled", tenantId, entity: { type: "purchase_order", id }, actor: { type: "user", id: auth.user.id }, data: { number: po.number, supplierId: po.supplier_id } });
      await this.audit.record(trx, { action: "po.cancelled", tenantId, entity: { type: "purchase_order", id }, before: { status: po.status }, after: { number: po.number }, ...auditActor(auth) });
      return this.view(trx, tenantId, id);
    });
  }

  /** A receipt from the web. Over-receipt needs `allowOver` from a manager. */
  async receiveWeb(auth: AuthContext, id: string, body: NewReceipt): Promise<PurchaseOrder> {
    const tenantId = auth.tenant!.id;
    if (body.allowOver && !MANAGERS.has(auth.tenant!.role)) throw new ProblemError(403, "forbidden", "taking in more than ordered needs the owner, an admin or an ops manager");
    return this.db.tenant(tenantId, async (trx) => {
      try {
        await this.receive(trx, tenantId, auth.user.id, { id }, body.items, { allowOver: body.allowOver, note: body.note });
      } catch (e) {
        if (!(e instanceof ReceiptRefused)) throw e;
        const status = e.code === "unknown_po" ? 404 : e.status === "conflict" ? 409 : 422;
        throw new ProblemError(status, e.code, e.message);
      }
      await this.audit.record(trx, { action: "po.received", tenantId, entity: { type: "purchase_order", id }, after: { items: body.items.length, allowOver: body.allowOver }, ...auditActor(auth) });
      return this.view(trx, tenantId, id);
    });
  }

  /**
   * Take a delivery in against a PO, inside the caller's transaction (the web, or the ops app's
   * sync savepoint with its opId). Throws ReceiptRefused without having written anything.
   */
  async receive(trx: Trx, tenantId: string, userId: string, ref: { id?: string | undefined; number?: string | undefined }, items: ReceiptItem[], o: { allowOver?: boolean; note?: string | undefined; deviceOpId?: string; now?: Date }) {
    const now = o.now ?? new Date();
    const base = trx.selectFrom("purchase_orders").select(["id", "number", "status", "currency", "supplier_id"]);
    const num = ref.number?.trim().toUpperCase();
    const po = await (ref.id ? base.where("id", "=", ref.id) : base.where("number", "in", [num!, /^\d+$/.test(num!) ? label(Number(num)) : num!])).forUpdate().executeTakeFirst();
    if (!po) throw new ReceiptRefused("rejected", "unknown_po", `no purchase order ${ref.number ?? ref.id}`);
    if (!RECEIVABLE.includes(po.status as PoStatus)) throw new ReceiptRefused("conflict", "po_not_open", `${po.number} is ${po.status}: only an approved or sent PO receives stock`);
    const poCurrency = po.currency.trim();

    const lines = await trx.selectFrom("purchase_order_lines as l").innerJoin("variants as v", "v.id", "l.variant_id").innerJoin("products as p", "p.id", "v.product_id")
      .select(["l.id", "l.variant_id", "l.quantity", "l.received_qty", "l.damaged_qty", "l.unit_cost_minor", "v.sku", "v.barcode", "v.currency", "v.cogs_minor", "v.cogs_set_at", "p.title"])
      .where("l.purchase_order_id", "=", po.id).execute();
    const got = new Map<string, { good: number; damaged: number }>();
    for (const i of items) {
      const line = lines.find((l) => (i.variantId && l.variant_id === i.variantId) || (i.barcode && l.barcode === i.barcode) || (i.sku && l.sku === i.sku));
      if (!line) throw new ReceiptRefused("rejected", "not_on_po", `${i.barcode ?? i.sku ?? i.variantId} is not on ${po.number}`);
      const g = got.get(line.id) ?? { good: 0, damaged: 0 };
      g.good += i.quantity;
      g.damaged += i.damaged;
      got.set(line.id, g);
    }
    const over = lines.filter((l) => got.has(l.id) && l.received_qty + l.damaged_qty + got.get(l.id)!.good + got.get(l.id)!.damaged > l.quantity);
    if (over.length && !o.allowOver) {
      throw new ReceiptRefused("conflict", "over_receipt", `more than ordered: ${over.map((l) => `${l.sku ?? l.title} (ordered ${l.quantity}, already ${l.received_qty + l.damaged_qty}, now ${got.get(l.id)!.good + got.get(l.id)!.damaged})`).join(", ")}. A manager can take it in from the web`);
    }

    // Stock first (it tells what was on hand before), then the cost at the receipt day's rate.
    const moved = [...got].map(([lineId, g]) => ({ variantId: lines.find((l) => l.id === lineId)!.variant_id, quantity: g.good }));
    const actor: EventActor = { type: "user", id: userId };
    const stocked = await this.stock.receivePurchase(trx, tenantId, actor, po.id, moved, o.deviceOpId);
    const { timezone } = await storeClock(trx, tenantId);
    const day = localDay(now, timezone);
    const rates = new Map<string, string | null>();
    for (const c of new Set(lines.filter((l) => got.has(l.id)).map((l) => l.currency.trim()))) rates.set(c, (await this.fx.rate(trx, tenantId, c, poCurrency, day)).rate);
    const currencies = [...rates.keys()];
    const lockedRate = currencies.length === 1 ? rates.get(currencies[0]!) ?? null : null;
    // Landed costs (M16-4a): each in its own currency, converted to the item's at the same day's rate.
    const landed: LandedCost[] = (await trx.selectFrom("landed_costs").select(["amount_minor", "currency", "allocate_by"]).where("purchase_order_id", "=", po.id).execute())
      .map((c) => ({ amountMinor: BigInt(c.amount_minor), currency: c.currency.trim(), allocateBy: c.allocate_by === "quantity" ? "quantity" : "value" }));
    const weights = lines.map((l) => ({ id: l.id, quantity: l.quantity, unitCostMinor: BigInt(l.unit_cost_minor) }));
    const landedRates = new Map<string, string | null>();
    for (const item of currencies) {
      for (const c of new Set(landed.map((x) => x.currency))) landedRates.set(`${item}|${c}`, (await this.fx.rate(trx, tenantId, item, c, day)).rate);
    }
    const costStatus = [...rates.values(), ...landedRates.values()].every((r) => r !== null) ? "applied" : "fx_missing";

    const last = await trx.selectFrom("purchase_receipts").select((eb) => eb.fn.max("number").as("n")).where("purchase_order_id", "=", po.id).executeTakeFirst();
    const receipt = await trx.insertInto("purchase_receipts").values({
      tenant_id: tenantId, purchase_order_id: po.id, number: Number(last?.n ?? 0) + 1, received_by: userId, received_at: now, device_op_id: o.deviceOpId ?? null,
      over_approved_by: over.length ? userId : null, fx_rate: lockedRate, fx_day: lockedRate ? day : null, cost_status: costStatus, note: o.note ?? null,
    }).returning(["id", "number"]).executeTakeFirstOrThrow();

    const costed: string[] = [];
    for (const [lineId, g] of got) {
      const l = lines.find((x) => x.id === lineId)!;
      const itemCurrency = l.currency.trim();
      const rate = rates.get(itemCurrency) ?? null;
      let unit: bigint | null = null;
      let landedMinor = 0n;
      let before: bigint | null = l.cogs_set_at ? BigInt(l.cogs_minor) : null;
      let after: bigint | null = before;
      if (costStatus === "applied" && rate !== null && g.good > 0) {
        // The value of the good units in the item's currency (1 item currency = rate PO currency), plus their landed cost.
        for (const [c, minor] of landedFor(landed, weights, l.id, g.good)) {
          landedMinor += toMinor(convertMoney(fromMinor(minor, c), itemCurrency, ratio("1", landedRates.get(`${itemCurrency}|${c}`)!, 12)));
        }
        const value = toMinor(convertMoney(fromMinor(BigInt(g.good) * BigInt(l.unit_cost_minor), poCurrency), itemCurrency, ratio("1", rate, 12))) + landedMinor;
        unit = divRound(value, BigInt(g.good));
        const onHand = BigInt(stocked.onHandBefore.get(l.variant_id) ?? 0);
        after = before === null || onHand === 0n ? unit : divRound(onHand * before + value, onHand + BigInt(g.good));
        await trx.updateTable("variants").set({ cogs_minor: after, cogs_set_at: now, updated_at: now }).where("id", "=", l.variant_id).execute();
        costed.push(l.variant_id);
      } else if (costStatus !== "applied") {
        before = after = null;
      }
      await trx.insertInto("purchase_receipt_lines").values({
        tenant_id: tenantId, receipt_id: receipt.id, po_line_id: lineId, variant_id: l.variant_id, quantity: g.good, damaged: g.damaged,
        unit_cost_minor: unit, cost_before_minor: before, cost_after_minor: after, landed_minor: landedMinor,
      }).execute();
      await trx.updateTable("purchase_order_lines").set((eb) => ({ received_qty: eb("received_qty", "+", g.good), damaged_qty: eb("damaged_qty", "+", g.damaged) })).where("id", "=", lineId).execute();
    }

    const left = await trx.selectFrom("purchase_order_lines").select("id").where("purchase_order_id", "=", po.id).where(sql<boolean>`received_qty + damaged_qty < quantity`).executeTakeFirst();
    const status = left ? "partially_received" : "received";
    await trx.updateTable("purchase_orders").set({ status, ...(left ? {} : { received_at: now }), updated_at: now }).where("id", "=", po.id).execute();

    const units = [...got.values()].reduce((s, g) => s + g.good, 0);
    const damaged = [...got.values()].reduce((s, g) => s + g.damaged, 0);
    const entity = { type: "purchase_order", id: po.id };
    await this.events.emit(trx, { type: "po.received", tenantId, entity, actor, data: { number: po.number, receipt: receipt.number, units, damaged, complete: !left, costStatus, overReceived: over.length > 0, supplierId: po.supplier_id } });
    if (costed.length) await this.events.emit(trx, { type: "costs.changed", tenantId, entity: { type: "tenant", id: tenantId }, actor, data: { kind: "product_cost", source: "purchase_receipt", variantIds: costed.slice(0, 500) } });
    return { purchaseOrderId: po.id, number: po.number, receipt: receipt.number, units, damaged, status, costStatus, ordersReserved: stocked.ordersReserved };
  }

  // ───────────── Landed costs (M16-4a) ─────────────

  /** Add a landed cost while stock can still arrive; it counts for the receipts after it. */
  async addLandedCost(auth: AuthContext, id: string, body: NewLandedCost): Promise<PurchaseOrder> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const po = await this.lockPo(trx, id);
      if (po.status === "received" || po.status === "cancelled") throw new ProblemError(409, "po_closed", `${po.number} is ${po.status}: its costs are final`);
      const currency = body.currency ?? (await storeClock(trx, tenantId)).base;
      let amountMinor: bigint;
      try {
        amountMinor = toMinor(body.amount, currency);
      } catch {
        throw new ProblemError(422, "validation_failed", `too many decimals for ${currency}`, [{ path: "amount", code: "invalid", message: body.amount }]);
      }
      if (amountMinor <= 0n) throw new ProblemError(422, "validation_failed", "a landed cost is more than zero", [{ path: "amount", code: "too_small" }]);
      const c = await trx.insertInto("landed_costs").values({
        tenant_id: tenantId, purchase_order_id: id, kind: body.kind, amount_minor: amountMinor, currency, allocate_by: body.allocateBy,
        description: body.description ?? null, created_by: auth.user.id,
      }).returning("id").executeTakeFirstOrThrow();
      await this.audit.record(trx, { action: "po.landed_cost_added", tenantId, entity: { type: "purchase_order", id }, after: { number: po.number, landedCostId: c.id, kind: body.kind, amount: fromMinor(amountMinor, currency) }, ...auditActor(auth) });
      return this.view(trx, tenantId, id);
    });
  }

  /** Remove one (a mistake): receipts already taken keep the cost they were given. */
  async removeLandedCost(auth: AuthContext, id: string, costId: string): Promise<PurchaseOrder> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const po = await this.lockPo(trx, id);
      if (po.status === "received" || po.status === "cancelled") throw new ProblemError(409, "po_closed", `${po.number} is ${po.status}: its costs are final`);
      const gone = await trx.deleteFrom("landed_costs").where("id", "=", costId).where("purchase_order_id", "=", id).returning(["kind", "amount_minor", "currency"]).executeTakeFirst();
      if (!gone) throw new ProblemError(404, "not_found", "no such landed cost on this purchase order");
      await this.audit.record(trx, { action: "po.landed_cost_removed", tenantId, entity: { type: "purchase_order", id }, before: { kind: gone.kind, amount: fromMinor(BigInt(gone.amount_minor), gone.currency.trim()) }, after: { number: po.number }, ...auditActor(auth) });
      return this.view(trx, tenantId, id);
    });
  }

  // ───────────── Settings ─────────────

  async getSettings(tenantId: string): Promise<PurchasingSettings & { currency: string }> {
    return this.db.tenant(tenantId, async (trx) => {
      const t = await trx.selectFrom("tenants").select(["settings", "base_currency"]).where("id", "=", tenantId).executeTakeFirstOrThrow();
      const s = purchasingSettings(t.settings);
      const currency = t.base_currency.trim();
      return { ...s, approveOver: fromMinor(toMinor(s.approveOver, currency), currency).amount, currency };
    });
  }

  async putSettings(auth: AuthContext, body: PurchasingSettings): Promise<PurchasingSettings & { currency: string }> {
    const tenantId = auth.tenant!.id;
    await this.db.tenant(tenantId, async (trx) => {
      const t = await trx.selectFrom("tenants").select(["settings", "base_currency"]).where("id", "=", tenantId).forUpdate().executeTakeFirstOrThrow();
      try {
        toMinor(body.approveOver, t.base_currency.trim());
      } catch {
        throw new ProblemError(422, "validation_failed", "too many decimals for the store's currency", [{ path: "approveOver", code: "invalid", message: body.approveOver }]);
      }
      const before = purchasingSettings(t.settings);
      await trx.updateTable("tenants").set({ settings: JSON.stringify({ ...(t.settings as object), purchasing: body }) }).where("id", "=", tenantId).execute();
      await this.audit.record(trx, { action: "purchasing.settings_updated", tenantId, entity: { type: "tenant", id: tenantId }, before, after: body, ...auditActor(auth) });
    });
    return this.getSettings(tenantId);
  }

  // ───────────── Internals ─────────────

  private async needsOwner(trx: Trx, tenantId: string, currency: string, totalMinor: bigint): Promise<boolean> {
    const t = await trx.selectFrom("tenants").select(["settings", "base_currency"]).where("id", "=", tenantId).executeTakeFirstOrThrow();
    const base = t.base_currency.trim();
    return currency.trim() !== base || totalMinor > toMinor(purchasingSettings(t.settings).approveOver, base);
  }

  private async lockPo(trx: Trx, id: string) {
    const po = await trx.selectFrom("purchase_orders").select(["id", "number", "status", "currency", "total_minor", "supplier_id"]).where("id", "=", id).forUpdate().executeTakeFirst();
    if (!po) throw new ProblemError(404, "not_found", "no such purchase order in this store");
    return po;
  }

  private async priceLines(trx: Trx, lines: NewPurchaseOrder["lines"], currency: string) {
    const known = await trx.selectFrom("variants").select("id").where("id", "in", lines.map((l) => l.variantId)).execute();
    const missing = lines.filter((l) => !known.some((k) => k.id === l.variantId));
    if (missing.length) throw new ProblemError(404, "not_found", "some items do not exist in this store", missing.map((l) => ({ path: "lines.variantId", code: "not_found", message: l.variantId })));
    return lines.map((l, n) => {
      try {
        return { variantId: l.variantId, quantity: l.quantity, unitMinor: toMinor(l.unitCost, currency) };
      } catch {
        throw new ProblemError(422, "validation_failed", `too many decimals for ${currency}`, [{ path: `lines.${n}.unitCost`, code: "invalid", message: l.unitCost }]);
      }
    });
  }

  private async insertLines(trx: Trx, tenantId: string, poId: string, lines: Array<{ variantId: string; quantity: number; unitMinor: bigint }>) {
    await trx.insertInto("purchase_order_lines").values(lines.map((l) => ({ tenant_id: tenantId, purchase_order_id: poId, variant_id: l.variantId, quantity: l.quantity, unit_cost_minor: l.unitMinor }))).execute();
  }

  private summaryQuery(trx: Trx) {
    return trx.selectFrom("purchase_orders as po").innerJoin("suppliers as s", "s.id", "po.supplier_id")
      .select(["po.id", "po.number", "po.status", "po.currency", "po.total_minor", "po.created_at", "po.notes", "po.approved_at", "po.sent_at", "po.received_at", "po.cancelled_at", "s.id as supplier_id", "s.name as supplier_name", dayText("po.expected_at").as("expected_at")])
      .select((eb) => [
        eb.selectFrom("purchase_order_lines as l").select(sql<string>`count(*)`.as("n")).whereRef("l.purchase_order_id", "=", "po.id").as("items"),
        eb.selectFrom("purchase_order_lines as l").select(sql<string>`coalesce(sum(l.quantity), 0)`.as("n")).whereRef("l.purchase_order_id", "=", "po.id").as("units"),
        eb.selectFrom("purchase_order_lines as l").select(sql<string>`coalesce(sum(l.received_qty + l.damaged_qty), 0)`.as("n")).whereRef("l.purchase_order_id", "=", "po.id").as("received"),
      ]);
  }

  private summary(r: { id: string; number: string; status: string; currency: string; total_minor: bigint | string; created_at: Date; supplier_id: string; supplier_name: string; expected_at: string | null; items: string | null; units: string | null; received: string | null }, today: string) {
    const currency = r.currency.trim();
    const status = r.status as PoStatus;
    return {
      id: r.id, number: r.number, status, supplier: { id: r.supplier_id, name: r.supplier_name },
      total: fromMinor(BigInt(r.total_minor), currency), items: Number(r.items ?? 0), units: Number(r.units ?? 0), receivedUnits: Number(r.received ?? 0),
      expectedAt: r.expected_at, late: r.expected_at !== null && r.expected_at < today && (status === "approved" || status === "sent" || status === "partially_received"),
      createdAt: r.created_at.toISOString(),
    };
  }

  private async view(trx: Trx, tenantId: string, id: string, now = new Date()): Promise<PurchaseOrder> {
    const r = await this.summaryQuery(trx).where("po.id", "=", id).executeTakeFirst();
    if (!r) throw new ProblemError(404, "not_found", "no such purchase order in this store");
    const { timezone } = await storeClock(trx, tenantId);
    const currency = r.currency.trim();
    const lines = await trx.selectFrom("purchase_order_lines as l").innerJoin("variants as v", "v.id", "l.variant_id").innerJoin("products as p", "p.id", "v.product_id")
      .select(["l.id", "l.variant_id", "l.quantity", "l.received_qty", "l.damaged_qty", "l.unit_cost_minor", "v.sku", "v.barcode", "v.title as variant_title", "p.title"])
      .where("l.purchase_order_id", "=", id).orderBy("v.sku").orderBy("p.title").execute();
    const receipts = await trx.selectFrom("purchase_receipts as r").leftJoin("purchase_receipt_lines as rl", "rl.receipt_id", "r.id")
      .select(["r.id", "r.number", "r.received_at", "r.cost_status", "r.fx_rate", "r.over_approved_by", "r.device_op_id", sql<string>`coalesce(sum(rl.quantity), 0)`.as("units"), sql<string>`coalesce(sum(rl.damaged), 0)`.as("damaged")])
      .where("r.purchase_order_id", "=", id).groupBy(["r.id", "r.number", "r.received_at", "r.cost_status", "r.fx_rate", "r.over_approved_by", "r.device_op_id"]).orderBy("r.number").execute();
    const landed = await trx.selectFrom("landed_costs").select(["id", "kind", "amount_minor", "currency", "allocate_by", "description", "created_at"])
      .where("purchase_order_id", "=", id).orderBy("created_at").execute();
    const costs: LandedCost[] = landed.map((c) => ({ amountMinor: BigInt(c.amount_minor), currency: c.currency.trim(), allocateBy: c.allocate_by === "quantity" ? "quantity" : "value" }));
    const sameCurrency = costs.every((c) => c.currency === currency);
    const weights = lines.map((l) => ({ id: l.id, quantity: l.quantity, unitCostMinor: BigInt(l.unit_cost_minor) }));
    return {
      ...this.summary(r, localDay(now, timezone)),
      notes: r.notes,
      approvedAt: r.approved_at?.toISOString() ?? null, sentAt: r.sent_at?.toISOString() ?? null, receivedAt: r.received_at?.toISOString() ?? null, cancelledAt: r.cancelled_at?.toISOString() ?? null,
      needsOwner: await this.needsOwner(trx, tenantId, currency, BigInt(r.total_minor)),
      lines: lines.map((l) => ({
        id: l.id, variantId: l.variant_id, sku: l.sku, barcode: l.barcode, title: l.variant_title && l.variant_title !== "Default Title" ? `${l.title} · ${l.variant_title}` : l.title,
        quantity: l.quantity, received: l.received_qty, damaged: l.damaged_qty, unitCost: fromMinor(BigInt(l.unit_cost_minor), currency),
        landedUnitCost: sameCurrency && l.quantity > 0
          ? fromMinor(BigInt(l.unit_cost_minor) + ((landedFor(costs, weights, l.id, l.quantity).get(currency) ?? 0n) + BigInt(l.quantity) / 2n) / BigInt(l.quantity), currency)
          : null,
      })),
      landedCosts: landed.map((c) => ({
        id: c.id, kind: c.kind as NewLandedCost["kind"], amount: fromMinor(BigInt(c.amount_minor), c.currency.trim()), allocateBy: c.allocate_by === "quantity" ? "quantity" as const : "value" as const,
        description: c.description, createdAt: c.created_at.toISOString(),
      })),
      receipts: receipts.map((x) => ({
        id: x.id, number: x.number, receivedAt: x.received_at.toISOString(), units: Number(x.units), damaged: Number(x.damaged),
        costStatus: x.cost_status as "applied", fxRate: x.fx_rate === null ? null : String(x.fx_rate).replace(/\.?0+$/, ""), overApproved: x.over_approved_by !== null, viaApp: x.device_op_id !== null,
      })),
    };
  }
}
