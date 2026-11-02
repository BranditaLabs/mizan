import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import { trxQueryClient, type DB } from "@mizan/db";
import { MizanEngine, SqlStore } from "@mizan/engine";
import type { DomainEvent } from "@mizan/shared";
import { EventConsumer, type EventHandler } from "../../platform/events/consumer.js";
import { StockService } from "./stock.service.js";
import { inventorySettings } from "./stock.settings.js";

/**
 * Mizan's stock goes to the store (E8-5), when the merchant turns it on: for each counted item
 * linked to a Shopify variant, the available count (on hand − reserved, never below zero) becomes
 * the desired quantity at the store location that stocks it, and an outbox job pushes it
 * (compare-and-set at Shopify, with its idempotency key). The desired state and the job are written
 * in this transaction, and a job always pushes the latest number, so jobs that run late or out of
 * order still end right. Items not counted in Mizan are left to the store. WooCommerce stores the
 * same way, with the count set where WooCommerce keeps it (pushWoo).
 */
@Injectable()
@EventConsumer({ name: "stock.push", events: ["stock.changed"] })
export class StockPushConsumer implements EventHandler {
  constructor(@Inject(StockService) private readonly stock: StockService) {}

  async handle(event: DomainEvent, trx: Transaction<DB>): Promise<void> {
    const t = await trx.selectFrom("tenants").select("settings").where("id", "=", event.tenantId).executeTakeFirstOrThrow();
    if (!inventorySettings(t.settings).pushToStore) return;
    const variantIds = ((event.data as { variantIds?: string[] }).variantIds ?? []).slice(0, 200);
    if (!variantIds.length) return;
    const warehouse = await this.stock.warehouse(trx, event.tenantId);
    const rows = await trx.selectFrom("external_variants as ev")
      .innerJoin("connections as c", "c.id", "ev.connection_id")
      .innerJoin("stock_levels as s", (j) => j.onRef("s.variant_id", "=", "ev.variant_id").on("s.warehouse_id", "=", warehouse.id))
      .select(["ev.connection_id", "ev.external_product_id", "ev.inventory_item_id", "ev.last_seen", "s.on_hand", "s.reserved"])
      .where("ev.variant_id", "in", variantIds).where("c.provider", "=", "shopify").where("c.status", "=", "active")
      .where("ev.inventory_item_id", "is not", null).where("ev.external_product_id", "is not", null).execute();

    const patches = new Map<string, { connectionId: string; productId: string; inventory: Array<{ inventoryItemId: string; locationId: string; available: number }> }>();
    for (const r of rows) {
      const locationId = (r.last_seen as { locations?: unknown } | null)?.locations;
      const location = Array.isArray(locationId) && typeof locationId[0] === "string" ? locationId[0] : null;
      if (!location) continue; // the store doesn't stock it anywhere yet: nothing to set
      const key = `${r.connection_id}|${r.external_product_id}`;
      const p = patches.get(key) ?? { connectionId: r.connection_id, productId: r.external_product_id!, inventory: [] };
      p.inventory.push({ inventoryItemId: r.inventory_item_id!, locationId: location, available: Math.max(0, r.on_hand - r.reserved) });
      patches.set(key, p);
    }
    const now = Date.now();
    for (const p of patches.values()) {
      const store = new SqlStore(trxQueryClient(trx), { tenantId: event.tenantId, connections: { shopify: p.connectionId } });
      const job = await MizanEngine.stageProductPatch(store, { productExternalId: p.productId, inventory: p.inventory }, now);
      await store.enqueue(job, now);
    }
    await this.pushWoo(trx, event.tenantId, variantIds, warehouse.id, now);
  }

  /**
   * WooCommerce stores (E5-7): each variant points at the record that holds its count
   * (`inventory_item_id` = "product:12" or "variation:12:34", only when WooCommerce manages the
   * stock). Variations that share their product's count ("parent") are summed, so the product
   * gets every one of them, not the last one pushed.
   */
  private async pushWoo(trx: Transaction<DB>, tenantId: string, variantIds: string[], warehouseId: string, now: number) {
    const changed = await trx.selectFrom("external_variants as ev").innerJoin("connections as c", "c.id", "ev.connection_id")
      .select(["ev.connection_id", "ev.inventory_item_id"]).distinct()
      .where("ev.variant_id", "in", variantIds).where("c.provider", "=", "woocommerce").where("c.status", "=", "active").where("ev.inventory_item_id", "is not", null).execute();
    for (const t of changed) {
      // Every Mizan item behind this target, counted or not: an uncounted one leaves the store's number alone.
      const rows = await trx.selectFrom("external_variants as ev")
        .leftJoin("stock_levels as s", (j) => j.onRef("s.variant_id", "=", "ev.variant_id").on("s.warehouse_id", "=", warehouseId))
        .select(["s.on_hand", "s.reserved"]).where("ev.connection_id", "=", t.connection_id).where("ev.inventory_item_id", "=", t.inventory_item_id!).execute();
      if (rows.some((r) => r.on_hand === null)) continue;
      const quantity = rows.reduce((n, r) => n + Math.max(0, r.on_hand! - r.reserved!), 0);
      const store = new SqlStore(trxQueryClient(trx), { tenantId, store: t.connection_id, connections: { woocommerce: t.connection_id } });
      await store.enqueue(await MizanEngine.stageWooStock(store, t.inventory_item_id!, quantity, now), now);
    }
  }
}
