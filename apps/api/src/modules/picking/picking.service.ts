import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { auditActor, AuditService } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import type { PackPayload, PickList } from "./picking.dto.js";

type Trx = Transaction<DB>;

/** Why a pack was not accepted: `rejected` can never apply (wrong item), `conflict` lost to the server's state (packed elsewhere). */
export class PackRefused extends Error {
  constructor(readonly status: "rejected" | "conflict", readonly code: string, message: string) { super(message); }
}

/**
 * Pick and pack (M4, E8-4c). A pick list batches confirmed orders that are ready (stock
 * reserved, not a suspected duplicate, not packed, not on another open list); its items are the
 * totals to take from the shelves, sorted by bin. On the phone each order's items are scanned and
 * sent as one `order.pack` op: packed only when what was scanned is exactly what the order
 * holds; a wrong or missing item is refused, a second phone packing the same order gets a
 * conflict (first sync wins). The list closes itself when its last order is packed. Stock still
 * leaves at shipping (E8-2); packing is the check.
 */
@Injectable()
export class PickingService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  async create(auth: AuthContext, body: { orderIds?: string[] | undefined; limit: number }): Promise<PickList> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`picklists:${tenantId}`}))`.execute(trx);
      let q = trx.selectFrom("orders as o").select(["o.id"])
        .where("o.status", "=", "confirmed").where("o.packed_at", "is", null)
        .where((eb) => eb.or([eb("o.stock_status", "is", null), eb("o.stock_status", "!=", "short")]))
        .where((eb) => eb.or([eb("o.duplicate_status", "is", null), eb("o.duplicate_status", "!=", "suspected")]))
        .where((eb) => eb.not(eb.exists(eb.selectFrom("pick_list_orders as plo").innerJoin("pick_lists as pl", "pl.id", "plo.pick_list_id")
          .select("plo.order_id").whereRef("plo.order_id", "=", "o.id").where("pl.status", "=", "open"))))
        .orderBy("o.confirmed_at").orderBy("o.placed_at");
      q = body.orderIds ? q.where("o.id", "in", body.orderIds) : q.limit(body.limit);
      const orders = await q.execute();
      if (!orders.length) throw new ProblemError(409, "nothing_to_pick", "no confirmed order is ready to pick");
      const last = await trx.selectFrom("pick_lists").select((eb) => eb.fn.max("number").as("n")).executeTakeFirst();
      const list = await trx.insertInto("pick_lists").values({ tenant_id: tenantId, number: Number(last?.n ?? 0) + 1, created_by: auth.user.id })
        .returning(["id", "number"]).executeTakeFirstOrThrow();
      await trx.insertInto("pick_list_orders").values(orders.map((o) => ({ pick_list_id: list.id, tenant_id: tenantId, order_id: o.id }))).execute();
      await this.events.emit(trx, { type: "picklist.created", tenantId, entity: { type: "pick_list", id: list.id }, actor: { type: "user", id: auth.user.id }, data: { number: list.number, orders: orders.length } });
      await this.audit.record(trx, { action: "picklist.created", tenantId, entity: { type: "pick_list", id: list.id }, after: { number: list.number, orders: orders.length }, ...auditActor(auth) });
      return this.view(trx, list.id);
    });
  }

  async get(tenantId: string, id: string): Promise<PickList> {
    return this.db.tenant(tenantId, (trx) => this.view(trx, id));
  }

  async list(tenantId: string, status: "open" | "closed") {
    return this.db.tenant(tenantId, async (trx) => {
      const rows = await trx.selectFrom("pick_lists as pl").leftJoin("pick_list_orders as plo", "plo.pick_list_id", "pl.id").leftJoin("orders as o", "o.id", "plo.order_id")
        .select(["pl.id", "pl.number", "pl.status", "pl.created_at", sql<string>`count(plo.order_id)`.as("orders"), sql<string>`count(o.packed_at)`.as("packed")])
        .where("pl.status", "=", status).groupBy(["pl.id", "pl.number", "pl.status", "pl.created_at"]).orderBy("pl.created_at", "desc").limit(50).execute();
      return { data: rows.map((r) => ({ id: r.id, number: r.number, status: r.status as "open", orders: Number(r.orders), packed: Number(r.packed), createdAt: r.created_at.toISOString() })) };
    });
  }

  async close(auth: AuthContext, id: string): Promise<PickList> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const list = await trx.selectFrom("pick_lists").select(["id", "number", "status"]).where("id", "=", id).forUpdate().executeTakeFirst();
      if (!list) throw new ProblemError(404, "not_found", "no such pick list in this store");
      if (list.status === "open") await this.closeList(trx, tenantId, list.id, list.number, { type: "user", id: auth.user.id }, auth);
      return this.view(trx, id);
    });
  }

  /** The ops app's `order.pack` (inside its sync savepoint). */
  async pack(trx: Trx, tenantId: string, userId: string, p: PackPayload, opId: string, deviceId: string, now = new Date()) {
    const n = p.orderNumber?.replace(/^#/, "");
    const base = trx.selectFrom("orders").select(["id", "number", "status", "packed_at"]);
    const order = await (p.orderId ? base.where("id", "=", p.orderId) : base.where("number", "in", [n!, `#${n}`]).orderBy("placed_at", "desc")).forUpdate().executeTakeFirst();
    if (!order) throw new PackRefused("rejected", "unknown_order", `no order ${p.orderNumber ?? p.orderId}`);
    if (order.packed_at) throw new PackRefused("conflict", "already_packed", `order ${order.number} was already packed (${order.packed_at.toISOString()})`);
    if (order.status !== "confirmed") throw new PackRefused("conflict", "not_packable", `order ${order.number} is ${order.status}: only a confirmed order is packed`);

    // What the order holds, by item (linked variant, else the line's SKU).
    const lines = await trx.selectFrom("order_lines as l").leftJoin("variants as v", "v.id", "l.variant_id")
      .select(["l.variant_id", "l.sku as line_sku", "l.title", "l.quantity", "v.sku", "v.barcode"]).where("l.order_id", "=", order.id).execute();
    const want = new Map<string, { title: string; quantity: number; barcode: string | null; sku: string | null }>();
    for (const l of lines) {
      const key = l.variant_id ?? `sku:${l.sku ?? l.line_sku ?? l.title}`;
      const cur = want.get(key) ?? { title: l.title, quantity: 0, barcode: l.barcode, sku: l.sku ?? l.line_sku };
      cur.quantity += l.quantity;
      want.set(key, cur);
    }
    const got = new Map<string, number>();
    for (const i of p.items) {
      const key = this.matchKey(want, i);
      if (!key) throw new PackRefused("rejected", "wrong_item", `${i.barcode ?? i.sku ?? i.variantId} is not on order ${order.number}`);
      got.set(key, (got.get(key) ?? 0) + i.quantity);
    }
    const over = [...got].filter(([k, q]) => q > want.get(k)!.quantity);
    if (over.length) throw new PackRefused("rejected", "wrong_item", `too many: ${over.map(([k, q]) => `${want.get(k)!.title} ×${q} (order has ${want.get(k)!.quantity})`).join(", ")}`);
    const missing = [...want].filter(([k, w]) => (got.get(k) ?? 0) < w.quantity);
    if (missing.length) throw new PackRefused("rejected", "incomplete", `missing: ${missing.map(([k, w]) => `${w.title} ×${w.quantity - (got.get(k) ?? 0)}`).join(", ")}`);

    await trx.updateTable("orders").set({ packed_at: now, packed_by: userId, pack_op_id: opId, updated_at: now }).where("id", "=", order.id).execute();
    await trx.insertInto("order_events").values({
      tenant_id: tenantId, order_id: order.id, type: "packed", actor_type: "user", actor_id: userId,
      data: JSON.stringify({ items: p.items.reduce((s, i) => s + i.quantity, 0), manual: p.manual, device: deviceId }),
    }).execute();
    await this.events.emit(trx, { type: "order.packed", tenantId, entity: { type: "order", id: order.id }, actor: { type: "user", id: userId }, data: { number: order.number, manual: p.manual } });
    // The list it was on closes when its last order is packed.
    const lists = await trx.selectFrom("pick_list_orders as plo").innerJoin("pick_lists as pl", "pl.id", "plo.pick_list_id")
      .select(["pl.id", "pl.number"]).where("plo.order_id", "=", order.id).where("pl.status", "=", "open").execute();
    for (const l of lists) {
      const left = await trx.selectFrom("pick_list_orders as plo").innerJoin("orders as o", "o.id", "plo.order_id")
        .select(sql<string>`count(*)`.as("n")).where("plo.pick_list_id", "=", l.id).where("o.packed_at", "is", null).executeTakeFirstOrThrow();
      if (Number(left.n) === 0) await this.closeList(trx, tenantId, l.id, l.number, { type: "user", id: userId });
    }
    return { orderId: order.id, number: order.number, packedAt: now.toISOString() };
  }

  private matchKey(want: Map<string, { barcode: string | null; sku: string | null }>, i: PackPayload["items"][number]): string | undefined {
    if (i.variantId && want.has(i.variantId)) return i.variantId;
    for (const [k, w] of want) {
      if (i.barcode && w.barcode === i.barcode) return k;
      if (i.sku && w.sku === i.sku) return k;
    }
    return undefined;
  }

  private async closeList(trx: Trx, tenantId: string, id: string, number: number, actor: { type: "user"; id: string }, auth?: AuthContext) {
    const now = new Date();
    await trx.updateTable("pick_lists").set({ status: "closed", closed_at: now }).where("id", "=", id).execute();
    await this.events.emit(trx, { type: "picklist.closed", tenantId, entity: { type: "pick_list", id }, actor, data: { number } });
    await this.audit.record(trx, { action: "picklist.closed", tenantId, entity: { type: "pick_list", id }, after: { number }, ...(auth ? auditActor(auth) : { actor }) });
  }

  private async view(trx: Trx, id: string): Promise<PickList> {
    const list = await trx.selectFrom("pick_lists").select(["id", "number", "status", "created_at", "closed_at"]).where("id", "=", id).executeTakeFirst();
    if (!list) throw new ProblemError(404, "not_found", "no such pick list in this store");
    const warehouse = await trx.selectFrom("warehouses").select("id").orderBy("is_default", "desc").orderBy("name").executeTakeFirst(); // the default, as stock uses
    const rows = await trx.selectFrom("pick_list_orders as plo").innerJoin("orders as o", "o.id", "plo.order_id")
      .leftJoin("order_lines as l", "l.order_id", "o.id").leftJoin("variants as v", "v.id", "l.variant_id")
      .leftJoin("stock_levels as s", (j) => j.onRef("s.variant_id", "=", "l.variant_id").on("s.warehouse_id", "=", warehouse?.id ?? "00000000-0000-0000-0000-000000000000"))
      .select(["o.id as order_id", "o.number", "o.packed_at", "l.variant_id", "l.sku as line_sku", "l.title", "l.quantity", "v.sku", "v.barcode", "s.bin"])
      .where("plo.pick_list_id", "=", id).orderBy("o.confirmed_at").orderBy("o.number").execute();
    const orders = new Map<string, PickList["orders"][number]>();
    const items = new Map<string, PickList["items"][number]>();
    for (const r of rows) {
      const o = orders.get(r.order_id) ?? { id: r.order_id, number: r.number, packedAt: r.packed_at?.toISOString() ?? null, lines: [] };
      orders.set(r.order_id, o);
      if (r.title === null || r.quantity === null) continue;
      const line = { variantId: r.variant_id, sku: r.sku ?? r.line_sku, barcode: r.barcode, title: r.title, quantity: r.quantity };
      o.lines.push(line);
      if (r.packed_at) continue;
      const key = r.variant_id ?? `sku:${line.sku ?? line.title}`;
      const it = items.get(key) ?? { ...line, quantity: 0, bin: r.bin };
      it.quantity += r.quantity;
      items.set(key, it);
    }
    const sorted = [...items.values()].sort((a, b) => (a.bin ?? "￿").localeCompare(b.bin ?? "￿", "en", { numeric: true }) || (a.sku ?? a.title).localeCompare(b.sku ?? b.title));
    return {
      id: list.id, number: list.number, status: list.status as "open", createdAt: list.created_at.toISOString(), closedAt: list.closed_at?.toISOString() ?? null,
      items: sorted, orders: [...orders.values()],
    };
  }
}
