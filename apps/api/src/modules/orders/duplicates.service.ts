import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { trxQueryClient, type DB } from "@mizan/db";
import { MizanEngine, SqlStore } from "@mizan/engine";
import { z } from "zod";
import { auditActor, AuditService } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import { roleScope } from "./orders.service.js";

/** The store's duplicate rule (M1 settings), in tenants.settings.orders. */
export const OrderSettingsSchema = z.strictObject({
  duplicateWindowHours: z.number().int().min(0).max(168).describe("An order of the same customer with the same product within this many hours of another is a likely duplicate; 0 turns detection off (at most 7 days)"),
});
export type OrderSettings = z.infer<typeof OrderSettingsSchema>;
export const DEFAULT_ORDER_SETTINGS: OrderSettings = { duplicateWindowHours: 48 };
const MERGEABLE = new Set(["new", "pending_confirmation", "confirmed"]);
/** The tag a merged order gets in the store, so the merchant sees why it was cancelled in Mizan. */
export const DUPLICATE_TAG = "mizan-duplicate";

export function orderSettings(settings: unknown): OrderSettings {
  const stored = (settings as { orders?: unknown } | null)?.orders;
  const r = OrderSettingsSchema.safeParse({ ...DEFAULT_ORDER_SETTINGS, ...(stored && typeof stored === "object" ? stored : {}) });
  return r.success ? r.data : DEFAULT_ORDER_SETTINGS;
}

/**
 * Likely duplicate orders (M1, E5-3). A customer who orders the same product twice within the
 * store's window (a double tap, a second try after no confirmation call) usually wants one order.
 * Detection runs as the order is projected, before anything reacts to it, so confirmation never
 * messages the customer twice; the team keeps both or merges the newer into the earlier.
 */
@Injectable()
export class DuplicatesService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * A new order (lines already written): the earliest earlier order of the same customer within
   * the window that shares a product (same variant, same SKU, or same title), not cancelled or
   * merged. Marks the new order as its suspected duplicate and records why. Null when none.
   */
  async detect(trx: Transaction<DB>, tenantId: string, orderId: string): Promise<{ of: string; number: string } | null> {
    const o = await trx.selectFrom("orders").select(["id", "number", "customer_id", "placed_at", "status"]).where("id", "=", orderId).executeTakeFirst();
    if (!o?.customer_id || o.status === "cancelled") return null;
    const t = await trx.selectFrom("tenants").select("settings").where("id", "=", tenantId).executeTakeFirstOrThrow();
    const hours = orderSettings(t.settings).duplicateWindowHours;
    if (hours === 0) return null; // the store turned it off
    const since = new Date(o.placed_at.getTime() - hours * 3_600_000);

    const twin = await trx.selectFrom("orders as e").select(["e.id", "e.number", "e.placed_at"])
      .where("e.customer_id", "=", o.customer_id).where("e.id", "<>", o.id)
      .where("e.placed_at", ">=", since).where("e.placed_at", "<=", o.placed_at)
      .where("e.status", "<>", "cancelled").where((eb) => eb.or([eb("e.duplicate_status", "is", null), eb("e.duplicate_status", "<>", "merged")]))
      .where(({ exists, selectFrom }) => exists(selectFrom("order_lines as a").innerJoin("order_lines as b", (j) => j.on(sql<boolean>`
          (a.variant_id IS NOT NULL AND a.variant_id = b.variant_id)
          OR (coalesce(a.sku, '') <> '' AND a.sku = b.sku)
          OR lower(a.title) = lower(b.title)`)).select("a.id").where("a.order_id", "=", o.id).whereRef("b.order_id", "=", "e.id")))
      .orderBy("e.placed_at").orderBy("e.id").executeTakeFirst();
    if (!twin) return null;

    const items = await trx.selectFrom("order_lines as a").innerJoin("order_lines as b", (j) => j.on(sql<boolean>`
        (a.variant_id IS NOT NULL AND a.variant_id = b.variant_id) OR (coalesce(a.sku, '') <> '' AND a.sku = b.sku) OR lower(a.title) = lower(b.title)`))
      .select("a.title").distinct().where("a.order_id", "=", o.id).where("b.order_id", "=", twin.id).limit(5).execute();
    const minutes = Math.round((o.placed_at.getTime() - twin.placed_at.getTime()) / 60_000);
    const reason = { items: items.map((i) => i.title), minutesApart: minutes, windowHours: hours };
    await trx.updateTable("orders").set({ duplicate_of: twin.id, duplicate_status: "suspected", duplicate_reason: JSON.stringify(reason), updated_at: new Date() }).where("id", "=", o.id).execute();
    await trx.insertInto("order_events").values({ tenant_id: tenantId, order_id: o.id, type: "duplicate_found", actor_type: "system", data: JSON.stringify({ of: twin.number, minutesApart: minutes }) }).execute();
    await this.events.emit(trx, {
      type: "order.duplicate_found", tenantId, entity: { type: "order", id: o.id }, actor: { type: "system" },
      data: { number: o.number, duplicateOf: twin.id, duplicateOfNumber: twin.number, minutesApart: minutes, items: reason.items },
    });
    return { of: twin.id, number: twin.number };
  }

  /**
   * The team's answer. keep: both are real orders; the newer one goes on to confirmation.
   * merge: the newer one is cancelled in Mizan as a duplicate of the earlier (which carries on),
   * and tagged `mizan-duplicate` in the store (cancelled there too when nothing was paid). Once answered, an order keeps its answer.
   */
  async resolve(auth: AuthContext, orderId: string, action: "keep" | "merge", now = new Date()) {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const o = await trx.selectFrom("orders as o").leftJoin("orders as e", "e.id", "o.duplicate_of").leftJoin("connections as c", "c.id", "o.connection_id")
        .select(["o.id", "o.number", "o.status", "o.duplicate_of", "o.duplicate_status", "o.external_id", "o.connection_id", "o.paid_minor", "c.provider", "e.number as of_number", "e.status as of_status"])
        .where("o.id", "=", orderId).where((eb) => roleScope(eb as never, auth)).forUpdate("o").executeTakeFirst();
      if (!o) throw new ProblemError(404, "not_found", "no such order in this store");
      if (!o.duplicate_status || !o.duplicate_of) throw new ProblemError(409, "not_a_duplicate", "this order is not marked as a possible duplicate");
      if (o.duplicate_status !== "suspected") return { status: o.duplicate_status as "kept" | "merged", changed: false };

      if (action === "keep") {
        await trx.updateTable("orders").set({ duplicate_status: "kept", updated_at: now }).where("id", "=", o.id).execute();
        await trx.insertInto("order_events").values({ tenant_id: tenantId, order_id: o.id, type: "duplicate_kept", actor_type: "user", actor_id: auth.user.id, data: JSON.stringify({ of: o.of_number }) }).execute();
      } else {
        if (!MERGEABLE.has(o.status)) throw new ProblemError(409, "not_mergeable", "this order has shipped: it can no longer be merged");
        await trx.updateTable("orders").set({ duplicate_status: "merged", status: "cancelled", cancelled_at: now, updated_at: now }).where("id", "=", o.id).execute();
        await trx.insertInto("order_events").values({
          tenant_id: tenantId, order_id: o.id, type: "duplicate_merged", from_status: o.status, to_status: "cancelled", actor_type: "user", actor_id: auth.user.id,
          data: JSON.stringify({ into: o.of_number, reason: "duplicate" }),
        }).execute();
        await this.events.emit(trx, { type: "order.cancelled", tenantId, entity: { type: "order", id: o.id }, actor: { type: "user", id: auth.user.id }, data: { number: o.number, reason: "duplicate" } });
        // The merchant sees it in Shopify too (rule 3: an outbox job, never a call from here).
        if (o.provider === "shopify" && o.external_id && o.connection_id) {
          const store = new SqlStore(trxQueryClient(trx), { tenantId, connections: { shopify: o.connection_id } });
          await store.enqueue(MizanEngine.shopifyTagJob(o.external_id, [DUPLICATE_TAG], o.id), now.getTime());
          // Cancelled in the store too (E5-4), unless money was paid: that goes back through a refund.
          if (BigInt(o.paid_minor) === 0n) await store.enqueue(MizanEngine.shopifyCancelJob({ orderId: o.external_id, reason: "OTHER", note: `Mizan: duplicate of ${o.of_number ?? "another order"}` }), now.getTime());
        }
        // A WooCommerce store's duplicate is cancelled there too (no tags in WooCommerce: the note says why).
        if (o.provider === "woocommerce" && o.external_id && o.connection_id && BigInt(o.paid_minor) === 0n) {
          const woo = new SqlStore(trxQueryClient(trx), { tenantId, store: o.connection_id, connections: { woocommerce: o.connection_id } });
          await woo.enqueue(MizanEngine.wooCancelJob({ orderId: o.external_id, note: `Mizan: duplicate of ${o.of_number ?? "another order"}` }), now.getTime());
        }
      }
      const status = action === "keep" ? "kept" : "merged";
      await this.events.emit(trx, {
        type: "order.duplicate_resolved", tenantId, entity: { type: "order", id: o.id }, actor: { type: "user", id: auth.user.id },
        data: { number: o.number, resolution: status, duplicateOf: o.duplicate_of, duplicateOfNumber: o.of_number },
      });
      await this.audit.record(trx, { action: "order.duplicate_resolved", tenantId, ...auditActor(auth), entity: { type: "order", id: o.id }, before: { duplicate: "suspected", status: o.status }, after: { duplicate: status } });
      return { status: status as "kept" | "merged", changed: true };
    });
  }

  async getSettings(tenantId: string): Promise<OrderSettings> {
    return this.db.tenant(tenantId, async (trx) => orderSettings((await trx.selectFrom("tenants").select("settings").where("id", "=", tenantId).executeTakeFirstOrThrow()).settings));
  }

  async putSettings(auth: AuthContext, body: OrderSettings): Promise<OrderSettings> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const t = await trx.selectFrom("tenants").select("settings").where("id", "=", tenantId).forUpdate().executeTakeFirstOrThrow();
      const before = orderSettings(t.settings);
      await trx.updateTable("tenants").set({ settings: JSON.stringify({ ...(t.settings as object), orders: body }) }).where("id", "=", tenantId).execute();
      await this.audit.record(trx, { action: "orders.settings_updated", tenantId, ...auditActor(auth), entity: { type: "tenant", id: tenantId }, before, after: body });
      return body;
    });
  }
}
