import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { fromMinor } from "@mizan/shared";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { APP_CONFIG, runsWorkerInProcess, type AppConfig } from "../../platform/config.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import { purchasingSettings, RECEIVABLE, type DraftFromSuggestions, type PurchaseOrder, type ReorderSuggestion } from "./purchasing.dto.js";
import { PurchasingService } from "./purchasing.service.js";
import { leadTime, reorder } from "./reorder.js";

type Trx = Transaction<DB>;
const TICK_MS = 60 * 60_000;

/**
 * Reorder suggestions (M16-4b): every counted, active item whose available plus incoming stock is
 * at or under velocity × (lead time + safety days) gets a quantity that brings it to the target
 * cover. Velocity is what left stock (shipped) less what came back from returns over the window.
 * The supplier is the one it was last bought from; lead time is theirs, else learned from their
 * received POs, else 14 days. Hourly, each item crossing its point emits `stock.reorder_suggested`
 * once (until it is back over). Nothing is ordered automatically: a draft PO is made on request
 * (or by an automation the store publishes).
 */
@Injectable()
export class ReorderService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("Reorder");
  private timer?: NodeJS.Timeout;
  private running?: Promise<unknown>;

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(PurchasingService) private readonly purchasing: PurchasingService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (runsWorkerInProcess(this.config)) this.start();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  start(): void {
    if (this.timer) return;
    const tick = () => { this.running = this.flagAll().catch((err) => this.logger.error({ err }, "reorder check failed")); };
    this.timer = setInterval(tick, TICK_MS);
    this.timer.unref();
    setTimeout(tick, 90_000).unref();
  }

  async suggestions(tenantId: string, q: { supplierId?: string | undefined } = {}, now = new Date()) {
    return this.db.tenant(tenantId, async (trx) => {
      const { rows, settings } = await this.compute(trx, now);
      const data = rows.filter((r) => r.suggested > 0 && (!q.supplierId || r.supplier?.id === q.supplierId))
        .sort((a, b) => (a.daysCover ?? Infinity) - (b.daysCover ?? Infinity) || b.velocity - a.velocity);
      return { data, settings: { safetyDays: settings.safetyDays, targetCoverDays: settings.targetCoverDays, velocityDays: settings.velocityDays } };
    });
  }

  /** A draft PO from suggestions: each line at the supplier's last price for it (else the item's cost when in the same currency, else 0 to fill in). */
  async draft(auth: AuthContext, body: DraftFromSuggestions): Promise<PurchaseOrder> {
    const tenantId = auth.tenant!.id;
    const lines = await this.db.tenant(tenantId, async (trx) => {
      const supplier = await trx.selectFrom("suppliers").select(["id", "currency"]).where("id", "=", body.supplierId).executeTakeFirst();
      if (!supplier) throw new ProblemError(404, "not_found", "no such supplier in this store");
      const currency = supplier.currency.trim();
      const ids = body.items.map((i) => i.variantId);
      const last = await this.lastPrices(trx, ids, supplier.id);
      const variants = await trx.selectFrom("variants").select(["id", "currency", "cogs_minor", "cogs_set_at"]).where("id", "in", ids).execute();
      return body.items.map((i) => {
        const p = last.get(i.variantId);
        const v = variants.find((x) => x.id === i.variantId);
        const unitCost = p && p.currency === currency ? p.amount
          : v && v.cogs_set_at && v.currency.trim() === currency ? fromMinor(BigInt(v.cogs_minor), currency).amount : "0";
        return { variantId: i.variantId, quantity: i.quantity, unitCost };
      });
    });
    return this.purchasing.create(auth, { supplierId: body.supplierId, lines });
  }

  /** Flag items that crossed their point (one event each) and unflag those back over it, store by store. */
  async flagAll(now = new Date()): Promise<number> {
    const stores = await this.db.worker((trx) => trx.selectFrom("stock_levels").select("tenant_id").distinct().execute());
    let emitted = 0;
    for (const s of stores) emitted += await this.flag(s.tenant_id, now);
    return emitted;
  }

  async flag(tenantId: string, now = new Date()): Promise<number> {
    return this.db.tenant(tenantId, async (trx) => {
      const { rows, warehouseId } = await this.compute(trx, now);
      if (!warehouseId) return 0;
      const flagged = new Set((await trx.selectFrom("stock_levels").select("variant_id").where("warehouse_id", "=", warehouseId).where("reorder_flagged_at", "is not", null).execute()).map((r) => r.variant_id));
      const due = rows.filter((r) => r.suggested > 0);
      const fresh = due.filter((r) => !flagged.has(r.variantId));
      const cleared = [...flagged].filter((id) => !due.some((r) => r.variantId === id));
      if (fresh.length) {
        await trx.updateTable("stock_levels").set({ reorder_flagged_at: now }).where("warehouse_id", "=", warehouseId).where("variant_id", "in", fresh.map((r) => r.variantId)).execute();
      }
      if (cleared.length) {
        await trx.updateTable("stock_levels").set({ reorder_flagged_at: null }).where("warehouse_id", "=", warehouseId).where("variant_id", "in", cleared).execute();
      }
      for (const r of fresh) {
        await this.events.emit(trx, {
          type: "stock.reorder_suggested", tenantId, entity: { type: "variant", id: r.variantId }, actor: { type: "system" },
          data: { sku: r.sku, available: r.available, incoming: r.incoming, reorderPoint: r.reorderPoint, suggested: r.suggested, daysCover: r.daysCover, supplierId: r.supplier?.id ?? null },
        });
      }
      return fresh.length;
    });
  }

  private async compute(trx: Trx, now: Date): Promise<{ rows: ReorderSuggestion[]; settings: ReturnType<typeof purchasingSettings>; warehouseId: string | null }> {
    const tenant = await trx.selectFrom("tenants").select("settings").executeTakeFirstOrThrow();
    const settings = purchasingSettings(tenant.settings);
    const warehouse = await trx.selectFrom("warehouses").select("id").orderBy("is_default", "desc").orderBy("name").executeTakeFirst();
    if (!warehouse) return { rows: [], settings, warehouseId: null };
    const since = new Date(now.getTime() - settings.velocityDays * 86_400_000);
    const items = await trx.selectFrom("stock_levels as s").innerJoin("variants as v", "v.id", "s.variant_id").innerJoin("products as p", "p.id", "v.product_id")
      .select(["s.variant_id", "s.on_hand", "s.reserved", "v.sku", "v.title as variant_title", "v.reorder_pack_size", "p.title"])
      .where("s.warehouse_id", "=", warehouse.id).where("p.status", "!=", "archived").execute();
    if (!items.length) return { rows: [], settings, warehouseId: warehouse.id };
    const ids = items.map((i) => i.variant_id);
    const out = await trx.selectFrom("stock_movements").select(["variant_id", sql<string>`sum(CASE WHEN reason = 'pick' THEN -delta WHEN reason = 'return_restock' THEN -delta ELSE 0 END)`.as("n")])
      .where("variant_id", "in", ids).where("reason", "in", ["pick", "return_restock"]).where("created_at", ">=", since).groupBy("variant_id").execute();
    const unitsOut = new Map(out.map((r) => [r.variant_id, Number(r.n)]));
    const open = await trx.selectFrom("purchase_order_lines as l").innerJoin("purchase_orders as po", "po.id", "l.purchase_order_id")
      .select(["l.variant_id", sql<string>`sum(greatest(l.quantity - l.received_qty - l.damaged_qty, 0))`.as("n")])
      .where("l.variant_id", "in", ids).where("po.status", "in", [...RECEIVABLE]).groupBy("l.variant_id").execute();
    const incoming = new Map(open.map((r) => [r.variant_id, Number(r.n)]));
    // The supplier each item was last bought from (not counting cancelled POs), with that price.
    const lastLines = await trx.selectFrom("purchase_order_lines as l").innerJoin("purchase_orders as po", "po.id", "l.purchase_order_id").innerJoin("suppliers as su", "su.id", "po.supplier_id")
      .select(["l.variant_id", "l.unit_cost_minor", "po.currency", "po.created_at", "su.id as supplier_id", "su.name", "su.currency as supplier_currency", "su.lead_time_days"])
      .where("l.variant_id", "in", ids).where("po.status", "!=", "cancelled").where("su.archived_at", "is", null).orderBy("po.created_at", "desc").execute();
    const lastOf = new Map<string, (typeof lastLines)[number]>();
    for (const l of lastLines) if (!lastOf.has(l.variant_id)) lastOf.set(l.variant_id, l);
    const supplierIds = [...new Set([...lastOf.values()].map((l) => l.supplier_id))];
    const learned = new Map<string, number[]>();
    if (supplierIds.length) {
      const done = await trx.selectFrom("purchase_orders").select(["supplier_id", sql<string>`extract(epoch from received_at - sent_at) / 86400`.as("days")])
        .where("supplier_id", "in", supplierIds).where("status", "=", "received").where("sent_at", "is not", null).where("received_at", "is not", null).orderBy("received_at", "desc").limit(200).execute();
      for (const d of done) learned.set(d.supplier_id, [...(learned.get(d.supplier_id) ?? []), Math.round(Number(d.days))]);
    }
    const rows = items.map((i): ReorderSuggestion => {
      const last = lastOf.get(i.variant_id);
      const lead = leadTime(last?.lead_time_days ?? null, last ? (learned.get(last.supplier_id) ?? []).slice(0, 5) : []);
      const packSize = i.reorder_pack_size ?? 1;
      const r = reorder({
        available: i.on_hand - i.reserved, incoming: incoming.get(i.variant_id) ?? 0, unitsOut: unitsOut.get(i.variant_id) ?? 0,
        windowDays: settings.velocityDays, leadDays: lead, safetyDays: settings.safetyDays, targetDays: settings.targetCoverDays, packSize,
      });
      return {
        variantId: i.variant_id, sku: i.sku, title: i.variant_title && i.variant_title !== "Default Title" ? `${i.title} · ${i.variant_title}` : i.title,
        available: i.on_hand - i.reserved, incoming: incoming.get(i.variant_id) ?? 0, unitsOut: Math.max(0, unitsOut.get(i.variant_id) ?? 0),
        velocity: r.velocity, daysCover: r.daysCover, leadDays: lead, reorderPoint: r.reorderPoint, suggested: r.suggested, packSize,
        supplier: last ? { id: last.supplier_id, name: last.name, currency: last.supplier_currency.trim() } : null,
        lastUnitCost: last ? fromMinor(BigInt(last.unit_cost_minor), last.currency.trim()) : null,
      };
    });
    return { rows, settings, warehouseId: warehouse.id };
  }

  private async lastPrices(trx: Trx, variantIds: string[], supplierId: string) {
    const rows = await trx.selectFrom("purchase_order_lines as l").innerJoin("purchase_orders as po", "po.id", "l.purchase_order_id")
      .select(["l.variant_id", "l.unit_cost_minor", "po.currency"]).where("l.variant_id", "in", variantIds).where("po.supplier_id", "=", supplierId)
      .where("po.status", "!=", "cancelled").orderBy("po.created_at", "desc").execute();
    const out = new Map<string, { amount: string; currency: string }>();
    for (const r of rows) if (!out.has(r.variant_id)) out.set(r.variant_id, fromMinor(BigInt(r.unit_cost_minor), r.currency.trim()));
    return out;
  }
}
