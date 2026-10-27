import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { EventActor } from "@mizan/shared";
import { auditActor, AuditService } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import type { RecordMovementsBody } from "./stock.dto.js";
import { planOrder, type OrderState } from "./plan.js";
import { inventorySettings, type InventorySettings } from "./stock.settings.js";

type Trx = Transaction<DB>;
type Filter = "all" | "counted" | "not_counted" | "out" | "low";
/** Orders waiting for stock tried again per change: the oldest first; the rest on the next change. */
const RETRY_BATCH = 25;

const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const encode = (sku: string) => Buffer.from(sku).toString("base64url");
const decode = (c: string) => Buffer.from(c, "base64url").toString();

/**
 * Stock (M4, E8-2): levels per warehouse, a movement ledger, and what each order holds. Every
 * number on a stock level is the sum of its movements: receive/count/adjust/pick change on hand,
 * reserve/release change reserved. Confirmed orders reserve counted items; a cancel releases them;
 * shipping picks them. Available never goes below zero through Mizan: an order that would oversell
 * waits ("short") and is reserved when stock arrives.
 */
@Injectable()
export class StockService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  async warehouse(trx: Trx, tenantId: string): Promise<{ id: string; name: string }> {
    const w = await trx.selectFrom("warehouses").select(["id", "name"]).where("tenant_id", "=", tenantId).orderBy("is_default", "desc").orderBy("name").executeTakeFirst();
    if (w) return w;
    return trx.insertInto("warehouses").values({ tenant_id: tenantId, name: "Main warehouse", is_default: true }).returning(["id", "name"]).executeTakeFirstOrThrow();
  }

  /** Bring an order's holds in line with its status and lines. Safe to run any number of times. */
  async syncOrder(trx: Trx, tenantId: string, orderId: string, actor: EventActor = { type: "system" }, retry = true): Promise<void> {
    const order = await trx.selectFrom("orders").select(["id", "status", "location_id", "stock_status"]).where("id", "=", orderId).forUpdate().executeTakeFirst();
    if (!order) return;
    const warehouseId = order.location_id ?? (await this.warehouse(trx, tenantId)).id;
    const lines = new Map((await trx.selectFrom("order_lines").select(["variant_id", sql<string>`sum(quantity)`.as("qty")])
      .where("order_id", "=", orderId).where("variant_id", "is not", null).groupBy("variant_id").execute()).map((l) => [l.variant_id!, Number(l.qty)]));
    const ledger = await trx.selectFrom("stock_movements").select(["variant_id", "reason", sql<string>`sum(delta)`.as("d")])
      .where("ref_type", "=", "order").where("ref_id", "=", orderId).where("warehouse_id", "=", warehouseId).groupBy(["variant_id", "reason"]).execute();
    const held = new Map<string, number>();
    const picked = new Map<string, number>();
    for (const l of ledger) {
      if (l.reason === "reserve" || l.reason === "release") held.set(l.variant_id, (held.get(l.variant_id) ?? 0) + Number(l.d));
      if (l.reason === "pick") picked.set(l.variant_id, (picked.get(l.variant_id) ?? 0) - Number(l.d));
    }
    for (const [v, n] of held) if (n === 0) held.delete(v);
    const variants = [...new Set([...lines.keys(), ...held.keys()])].sort();
    const levels = await this.lock(trx, warehouseId, variants);
    const plan = planOrder({
      status: order.status as OrderState, lines, held, picked,
      available: new Map([...levels].map(([v, l]) => [v, l.on_hand - l.reserved])),
    });

    const moves: Array<{ variant: string; reason: "reserve" | "release" | "pick"; delta: number }> = [
      ...[...plan.release].map(([variant, n]) => ({ variant, reason: "release" as const, delta: -n })),
      ...[...plan.reserve].map(([variant, n]) => ({ variant, reason: "reserve" as const, delta: n })),
      ...[...plan.pick].map(([variant, n]) => ({ variant, reason: "pick" as const, delta: -n })),
    ].filter((m) => levels.has(m.variant));
    for (const m of moves) {
      const l = levels.get(m.variant)!;
      if (m.reason === "pick") l.on_hand += m.delta; else l.reserved += m.delta;
    }
    await this.write(trx, tenantId, warehouseId, moves.map((m) => ({ ...m, ref: orderId })), actor);
    if (plan.status !== order.stock_status) await trx.updateTable("orders").set({ stock_status: plan.status }).where("id", "=", orderId).execute();

    const entity = { type: "order", id: orderId };
    if (plan.reserve.size) await this.events.emit(trx, { type: "stock.reserved", tenantId, entity, actor, data: { warehouseId, items: Object.fromEntries(plan.reserve) } });
    if (plan.release.size) await this.events.emit(trx, { type: "stock.released", tenantId, entity, actor, data: { warehouseId, items: Object.fromEntries(plan.release) } });
    if (plan.status === "short" && order.stock_status !== "short") {
      await this.events.emit(trx, { type: "stock.short", tenantId, entity, actor, data: { warehouseId, variantIds: plan.short } });
    }
    // Stock this order let go may be what another order is waiting for.
    if (retry && plan.release.size) await this.retryWaiting(trx, tenantId, [...plan.release.keys()], ["short"]);
  }

  /** Manual movements (receive, count, adjust), all or none. A count of a new variant starts counting it here. */
  async record(auth: AuthContext, body: RecordMovementsBody) {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const r = await this.apply(trx, tenantId, { type: "user", id: auth.user.id }, body);
      await this.audit.record(trx, { action: "stock.recorded", tenantId, entity: { type: "warehouse", id: r.warehouseId }, after: { items: body.items.length, changed: r.applied, newlyCounted: r.newlyCounted }, ...auditActor(auth) });
      return { applied: r.applied, levels: r.levels, ordersReserved: r.ordersReserved };
    });
  }

  /**
   * The same movements inside a caller's transaction (the ops app's sync, E8-3). Throws a 404 or
   * 422 problem without writing anything; `deviceOpId` marks the ledger rows with the app's op id.
   */
  async apply(trx: Trx, tenantId: string, actor: EventActor, body: RecordMovementsBody, deviceOpId?: string) {
    const warehouse = await this.warehouse(trx, tenantId);
    const ids = [...new Set(body.items.map((i) => i.variantId))].sort();
    const known = await trx.selectFrom("variants").select(["id", "sku"]).where("id", "in", ids).execute();
    const skuOf = new Map(known.map((v) => [v.id, v.sku]));
    const unknown = ids.filter((id) => !skuOf.has(id));
    if (unknown.length) throw new ProblemError(404, "not_found", "some variants do not exist in this store", unknown.map((id) => ({ path: "items.variantId", code: "not_found", message: id })));
    const before = await this.lock(trx, warehouse.id, ids);
    const fresh = ids.filter((id) => !before.has(id));
    if (fresh.length) {
      await trx.insertInto("stock_levels").values(fresh.map((variant_id) => ({ tenant_id: tenantId, warehouse_id: warehouse.id, variant_id }))).onConflict((oc) => oc.doNothing()).execute();
    }
    const levels = await this.lock(trx, warehouse.id, ids);

    const moves: Array<{ variant: string; reason: "receive" | "adjust"; delta: number; detail: string | null }> = [];
    const problems: Array<{ path: string; code: string; message: string }> = [];
    body.items.forEach((i, n) => {
      const l = levels.get(i.variantId)!;
      const delta = i.kind === "count" ? i.quantity - l.on_hand : i.quantity;
      if (l.on_hand + delta < l.reserved) {
        problems.push({ path: `items.${n}.quantity`, code: "below_reserved", message: `${skuOf.get(i.variantId)}: ${l.reserved} reserved for confirmed orders` });
        return;
      }
      l.on_hand += delta;
      if (delta !== 0) moves.push({ variant: i.variantId, reason: i.kind === "receive" ? "receive" : "adjust", delta, detail: i.kind === "count" ? "count" : (i.reason ?? null) });
    });
    if (problems.length) throw new ProblemError(422, "below_reserved", "stock cannot go under what confirmed orders hold", problems);

    await this.write(trx, tenantId, warehouse.id, moves.map((m) => ({ ...m, note: body.note ?? null, deviceOpId: deviceOpId ?? null })), actor);
    const received = moves.filter((m) => m.reason === "receive");
    const adjusted = moves.filter((m) => m.reason === "adjust");
    const entity = { type: "warehouse", id: warehouse.id };
    if (received.length) await this.events.emit(trx, { type: "stock.received", tenantId, entity, actor, data: { items: Object.fromEntries(received.map((m) => [m.variant, m.delta])) } });
    if (adjusted.length || fresh.length) await this.events.emit(trx, { type: "stock.adjusted", tenantId, entity, actor, data: { items: Object.fromEntries(adjusted.map((m) => [m.variant, m.delta])), counted: fresh } });

    const unmoved = fresh.filter((v) => !moves.some((m) => m.variant === v));
    if (unmoved.length) await this.changed(trx, tenantId, warehouse.id, unmoved, actor);
    // Newly counted variants: confirmed orders start holding them; more stock: waiting orders get theirs.
    const up = moves.filter((m) => m.delta > 0).map((m) => m.variant);
    let reserved = 0;
    if (fresh.length) reserved += await this.retryWaiting(trx, tenantId, fresh, ["short", "untracked"]);
    if (up.length) reserved += await this.retryWaiting(trx, tenantId, up, ["short"]);
    const after = await this.lock(trx, warehouse.id, ids);
    return {
      warehouseId: warehouse.id, applied: moves.length, newlyCounted: fresh.length,
      levels: ids.map((id) => { const l = after.get(id)!; return { variantId: id, onHand: l.on_hand, reserved: l.reserved, available: l.on_hand - l.reserved }; }),
      ordersReserved: reserved,
    };
  }

  async list(tenantId: string, q: { search?: string | undefined; filter: Filter; limit: number; cursor?: string | undefined }) {
    return this.db.tenant(tenantId, async (trx) => {
      const warehouse = await this.warehouse(trx, tenantId);
      const base = () => trx.selectFrom("variants as v").innerJoin("products as p", "p.id", "v.product_id")
        .leftJoin("stock_levels as s", (j) => j.onRef("s.variant_id", "=", "v.id").on("s.warehouse_id", "=", warehouse.id))
        .where("p.status", "!=", "archived");
      let query = base().select(["v.id", "v.sku", "v.title", "v.barcode", "v.available as store_available", "p.title as product_title", "s.on_hand", "s.reserved", "s.low_stock_at"])
        .orderBy("v.sku").limit(q.limit + 1);
      if (q.search) {
        const s = like(q.search);
        query = query.where((eb) => eb.or([eb("p.title", "ilike", s), eb("v.sku", "ilike", s), eb("v.barcode", "ilike", s), eb("v.title", "ilike", s)]));
      }
      if (q.filter === "counted") query = query.where("s.variant_id", "is not", null);
      if (q.filter === "not_counted") query = query.where("s.variant_id", "is", null);
      if (q.filter === "out") query = query.where(sql<boolean>`s.on_hand - s.reserved <= 0`);
      if (q.filter === "low") query = query.where(sql<boolean>`s.low_stock_at IS NOT NULL AND s.on_hand - s.reserved <= s.low_stock_at`);
      if (q.cursor) query = query.where("v.sku", ">", decode(q.cursor));
      const rows = await query.execute();
      const page = rows.slice(0, q.limit);
      const c = await base().select([
        sql<string>`count(*)`.as("variants"), sql<string>`count(s.variant_id)`.as("counted"),
        sql<string>`count(*) filter (where s.on_hand - s.reserved <= 0)`.as("out"),
        sql<string>`count(*) filter (where s.low_stock_at is not null and s.on_hand - s.reserved <= s.low_stock_at)`.as("low"),
      ]).executeTakeFirstOrThrow();
      const waiting = await trx.selectFrom("orders").where("stock_status", "=", "short").select(sql<string>`count(*)`.as("n")).executeTakeFirstOrThrow();
      const last = page.at(-1);
      return {
        data: page.map((r) => {
          const counted = r.on_hand !== null;
          return {
            variantId: r.id, productTitle: r.product_title, variantTitle: r.title, sku: r.sku, barcode: r.barcode, counted,
            onHand: r.on_hand, reserved: r.reserved, available: counted ? r.on_hand! - r.reserved! : null,
            storeAvailable: r.store_available, lowStockAt: r.low_stock_at,
          };
        }),
        nextCursor: rows.length > q.limit && last ? encode(last.sku) : null,
        warehouse,
        counts: { variants: Number(c.variants), counted: Number(c.counted), out: Number(c.out), low: Number(c.low), waitingOrders: Number(waiting.n) },
      };
    });
  }

  async history(tenantId: string, variantId: string) {
    return this.db.tenant(tenantId, async (trx) => {
      const exists = await trx.selectFrom("variants").select("id").where("id", "=", variantId).executeTakeFirst();
      if (!exists) throw new ProblemError(404, "not_found", "this variant does not exist in this store");
      const rows = await trx.selectFrom("stock_movements as m").leftJoin("orders as o", (j) => j.onRef("o.id", "=", "m.ref_id").on("m.ref_type", "=", "order"))
        .select(["m.id", "m.created_at", "m.reason", "m.detail", "m.delta", "m.note", "o.id as order_id", "o.number"])
        .where("m.variant_id", "=", variantId).orderBy("m.seq", "desc").limit(100).execute();
      type Kind = "receive" | "count" | "adjust" | "reserve" | "release" | "pick" | "return_restock" | "transfer_in" | "transfer_out" | "write_off";
      return {
        data: rows.map((r) => ({
          id: r.id, at: r.created_at.toISOString(), kind: (r.reason === "adjust" && r.detail === "count" ? "count" : r.reason) as Kind, delta: r.delta,
          reason: r.reason === "adjust" && r.detail !== "count" ? r.detail : null, note: r.note,
          order: r.order_id && r.number ? { id: r.order_id, number: r.number } : null,
        })),
      };
    });
  }

  /** One item's low-stock threshold; only items counted here have one. */
  async setThreshold(auth: AuthContext, variantId: string, lowStockAt: number | null) {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const warehouse = await this.warehouse(trx, tenantId);
      const row = await trx.updateTable("stock_levels").set({ low_stock_at: lowStockAt, updated_at: new Date() })
        .where("warehouse_id", "=", warehouse.id).where("variant_id", "=", variantId).returning(["on_hand", "reserved"]).executeTakeFirst();
      if (!row) {
        const exists = await trx.selectFrom("variants").select("id").where("id", "=", variantId).executeTakeFirst();
        throw exists ? new ProblemError(409, "not_counted", "count this item in Mizan before setting its alert") : new ProblemError(404, "not_found", "this variant does not exist in this store");
      }
      await this.audit.record(trx, { action: "stock.threshold_set", tenantId, entity: { type: "variant", id: variantId }, after: { lowStockAt }, ...auditActor(auth) });
      return { variantId, lowStockAt, available: row.on_hand - row.reserved };
    });
  }

  async getSettings(tenantId: string): Promise<InventorySettings> {
    return this.db.tenant(tenantId, async (trx) => inventorySettings((await trx.selectFrom("tenants").select("settings").where("id", "=", tenantId).executeTakeFirstOrThrow()).settings));
  }

  /** Turning store sync on sends every counted item's number at once (in batches of 200). */
  async putSettings(auth: AuthContext, body: InventorySettings): Promise<InventorySettings> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const t = await trx.selectFrom("tenants").select("settings").where("id", "=", tenantId).forUpdate().executeTakeFirstOrThrow();
      const before = inventorySettings(t.settings);
      await trx.updateTable("tenants").set({ settings: JSON.stringify({ ...(t.settings as object), inventory: body }) }).where("id", "=", tenantId).execute();
      await this.audit.record(trx, { action: "stock.settings_updated", tenantId, entity: { type: "tenant", id: tenantId }, before, after: body, ...auditActor(auth) });
      if (body.pushToStore && !before.pushToStore) {
        const warehouse = await this.warehouse(trx, tenantId);
        const counted = await trx.selectFrom("stock_levels").select("variant_id").where("warehouse_id", "=", warehouse.id).orderBy("variant_id").execute();
        await this.changed(trx, tenantId, warehouse.id, counted.map((c) => c.variant_id), { type: "user", id: auth.user.id });
      }
      return body;
    });
  }

  /** Waiting orders with these variants, oldest first: each one held now if the stock is there. */
  private async retryWaiting(trx: Trx, tenantId: string, variantIds: string[], statuses: Array<"short" | "untracked">): Promise<number> {
    const orders = await trx.selectFrom("orders as o").select("o.id")
      .where("o.status", "=", "confirmed").where("o.stock_status", "in", statuses)
      .where((eb) => eb.exists(eb.selectFrom("order_lines as l").select("l.id").whereRef("l.order_id", "=", "o.id").where("l.variant_id", "in", variantIds)))
      .orderBy("o.placed_at").limit(RETRY_BATCH).execute();
    let reserved = 0;
    for (const o of orders) {
      await this.syncOrder(trx, tenantId, o.id, { type: "system" }, false);
      const now = await trx.selectFrom("orders").select("stock_status").where("id", "=", o.id).executeTakeFirstOrThrow();
      if (now.stock_status === "reserved") reserved++;
    }
    return reserved;
  }

  /** Stock levels for these variants, locked in a fixed order (no deadlock between two orders). */
  private async lock(trx: Trx, warehouseId: string, variantIds: string[]) {
    if (!variantIds.length) return new Map<string, { on_hand: number; reserved: number }>();
    const rows = await trx.selectFrom("stock_levels").select(["variant_id", "on_hand", "reserved"])
      .where("warehouse_id", "=", warehouseId).where("variant_id", "in", variantIds).orderBy("variant_id").forUpdate().execute();
    return new Map(rows.map((r) => [r.variant_id, { on_hand: r.on_hand, reserved: r.reserved }]));
  }

  /** Ledger rows and the levels they sum to, in one go. */
  /**
   * Units inspected as sellable come back into stock (E10-3): one return_restock movement per
   * inspection, at the order's warehouse, written once however often the event arrives. Items
   * Mizan doesn't count are left alone.
   */
  async restockReturn(trx: Trx, tenantId: string, r: { inspectionId: string; orderId: string; variantId: string; quantity: number }, actor: EventActor): Promise<boolean> {
    const done = await trx.selectFrom("stock_movements").select("id").where("ref_type", "=", "return").where("ref_id", "=", r.inspectionId).executeTakeFirst();
    if (done) return false;
    const order = await trx.selectFrom("orders").select("location_id").where("id", "=", r.orderId).executeTakeFirst();
    const warehouseId = order?.location_id ?? (await this.warehouse(trx, tenantId)).id;
    const levels = await this.lock(trx, warehouseId, [r.variantId]);
    if (!levels.has(r.variantId)) return false;
    await this.write(trx, tenantId, warehouseId, [{ variant: r.variantId, reason: "return_restock", delta: r.quantity, ref: r.inspectionId, refType: "return" }], actor);
    await this.retryWaiting(trx, tenantId, [r.variantId], ["short"]);
    return true;
  }

  private async write(trx: Trx, tenantId: string, warehouseId: string, moves: Array<{ variant: string; reason: string; delta: number; ref?: string; refType?: string; detail?: string | null; note?: string | null; deviceOpId?: string | null }>, actor: EventActor) {
    if (!moves.length) return;
    await trx.insertInto("stock_movements").values(moves.map((m) => ({
      tenant_id: tenantId, warehouse_id: warehouseId, variant_id: m.variant, delta: m.delta, reason: m.reason,
      ref_type: m.ref ? (m.refType ?? "order") : null, ref_id: m.ref ?? null, detail: m.detail ?? null, note: m.note ?? null,
      device_op_id: m.deviceOpId ? (moves.length > 1 ? `${m.deviceOpId}:${m.variant}` : m.deviceOpId) : null,
      actor_id: actor.type === "user" ? (actor.id ?? null) : null,
    }))).execute();
    const now = new Date();
    for (const m of moves) {
      const onHand = m.reason === "reserve" || m.reason === "release" ? 0 : m.delta;
      const reserved = m.reason === "reserve" || m.reason === "release" ? m.delta : 0;
      await trx.updateTable("stock_levels").set((eb) => ({ on_hand: eb("on_hand", "+", onHand), reserved: eb("reserved", "+", reserved), updated_at: now }))
        .where("warehouse_id", "=", warehouseId).where("variant_id", "=", m.variant).execute();
    }
    // Available before and after, per item: crossing the threshold or reaching zero is an alert.
    const change = new Map<string, number>();
    for (const m of moves) change.set(m.variant, (change.get(m.variant) ?? 0) + (m.reason === "reserve" || m.reason === "release" ? -m.delta : m.delta));
    const levels = await trx.selectFrom("stock_levels").select(["variant_id", "on_hand", "reserved", "low_stock_at"])
      .where("warehouse_id", "=", warehouseId).where("variant_id", "in", [...change.keys()]).execute();
    for (const l of levels) {
      const after = l.on_hand - l.reserved;
      const before = after - change.get(l.variant_id)!;
      const entity = { type: "variant", id: l.variant_id };
      if (before > 0 && after <= 0) await this.events.emit(trx, { type: "stock.out", tenantId, entity, actor, data: { warehouseId, available: after } });
      else if (l.low_stock_at !== null && before > l.low_stock_at && after <= l.low_stock_at) {
        await this.events.emit(trx, { type: "stock.low", tenantId, entity, actor, data: { warehouseId, available: after, threshold: l.low_stock_at } });
      }
    }
    await this.changed(trx, tenantId, warehouseId, [...change.keys()], actor);
  }

  /** What is available changed for these items: the store gets Mizan's number (E8-5, when on). */
  private async changed(trx: Trx, tenantId: string, warehouseId: string, variantIds: string[], actor: EventActor) {
    for (let i = 0; i < variantIds.length; i += 200) {
      await this.events.emit(trx, { type: "stock.changed", tenantId, entity: { type: "warehouse", id: warehouseId }, actor, data: { variantIds: variantIds.slice(i, i + 200) } });
    }
  }
}
