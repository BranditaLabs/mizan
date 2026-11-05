import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { trxQueryClient, type DB } from "@mizan/db";
import { MizanEngine, SqlStore, type CancelJob } from "@mizan/engine";
import type { DomainEvent, ShipmentStatus } from "@mizan/shared";
import { EventConsumer, type EventHandler } from "../platform/events/consumer.js";
import { ENGINE_RUNTIME, type RuntimeFactory } from "./engine-registry.js";
import { storeSyncOf } from "./store-sync-options.js";

const SHOPIFY_REASON: Record<string, CancelJob["reason"]> = {
  customer_cancelled: "CUSTOMER", refused: "CUSTOMER", no_answer: "CUSTOMER", duplicate: "OTHER", out_of_stock: "INVENTORY", fraud: "FRAUD",
};
const COLLECTS_ON_DELIVERY = new Set(["cod", "partial"]);

/**
 * Two-way delivery, Mizan → store: what happens in Mizan reaches the store's order through the
 * outbox (rule 3), whoever or whatever made it happen.
 * - an order cancelled in Mizan (by the team, the customer in confirmation, a duplicate) is
 *   cancelled in Shopify or WooCommerce; one the store cancelled is not sent back;
 * - a shipment recorded with a courier Mizan has no API for becomes a Shopify fulfillment with its
 *   tracking number (Bosta bookings are fulfilled by the engine);
 * - a status a person set or a courier report (CSV) brought becomes the Shopify fulfillment event,
 *   paid on delivery and the return or lost tag, as the engine does for statuses the courier sends;
 * - money that came in through Mizan (a payment link, a transfer, cash collected) marks the
 *   order paid in Shopify once it is paid in full.
 * The store's own sync switches apply (Settings → Store sync). Jobs are keyed as the engine keys
 * them, in the engine's queue for that store, so a step is never sent twice.
 */
@Injectable()
@EventConsumer({ name: "integrations.store-writeback", events: ["order.cancelled", "shipment.created", "shipment.status_changed", "order.payment_changed"] })
export class StoreWritebackConsumer implements EventHandler {
  constructor(@Inject(ENGINE_RUNTIME) private readonly runtime: RuntimeFactory) {}

  async handle(event: DomainEvent, trx: Transaction<DB>): Promise<void> {
    const data = event.data as Record<string, unknown>;
    const orderId = event.entity.type === "order" ? event.entity.id : typeof data.orderId === "string" ? data.orderId : null;
    if (!orderId) return;
    const row = await trx.selectFrom("orders as o")
      .innerJoin("connections as c", (j) => j.on(sql<boolean>`c.id = coalesce(o.connection_id, o.store_copy_connection_id)`))
      .select(["o.id", "o.external_id", "o.connection_id", "o.store_copy_connection_id", "o.store_copy_id", "o.payment_mode", "o.paid_minor", "c.provider", "c.status as connection_status", "c.config"])
      .where("o.id", "=", orderId).executeTakeFirst();
    // The store's order: the order itself (from the store), or the copy of one made in Mizan.
    const o = row ? { ...row, external_id: row.connection_id ? row.external_id : row.store_copy_id, connection_id: row.connection_id ?? row.store_copy_connection_id } : null;
    if (!o?.external_id || !o.connection_id || o.connection_status !== "active") return; // not in a store (yet), or a store no longer synced
    const now = this.runtime(event.tenantId).clock.now(); // the engine's clock schedules its jobs
    const sync = storeSyncOf(o.config as Record<string, unknown> | null);
    const shopify = o.provider === "shopify";
    // The engine's queue for this store: the keys below dedupe against the jobs it makes itself.
    const queue = new SqlStore(trxQueryClient(trx), { tenantId: event.tenantId, store: o.connection_id, connections: { [o.provider]: o.connection_id } });

    switch (event.type) {
      case "order.cancelled": {
        const reason = String(data.reason ?? "other");
        if (reason === "cancelled_in_store") return; // it came from the store
        // A store's own duplicate is cancelled there by the duplicates decision (never a paid one); a Mizan order's copy here, unpaid only.
        if (reason === "duplicate" && (row?.connection_id || BigInt(o.paid_minor) > 0n)) return;
        if (shopify) {
          // Default scope, as the bulk cancel and duplicates queue it: one cancel per order.
          const store = new SqlStore(trxQueryClient(trx), { tenantId: event.tenantId, connections: { shopify: o.connection_id } });
          await store.enqueue(MizanEngine.shopifyCancelJob({ orderId: o.external_id, reason: SHOPIFY_REASON[reason] ?? "OTHER", note: `Mizan: cancelled (${reason})` }), now);
        } else if (o.provider === "woocommerce") {
          await queue.enqueue(MizanEngine.wooCancelJob({ orderId: o.external_id, note: `Mizan: cancelled (${reason})` }), now);
        }
        return;
      }
      case "shipment.created": {
        if (!shopify || data.source === "store" || typeof data.trackingNumber !== "string") return;
        const s = await trx.selectFrom("shipments as s").innerJoin("connections as c", "c.id", "s.connection_id")
          .select(["c.provider", "s.tracking_url"]).where("s.id", "=", event.entity.id).executeTakeFirst();
        // An API courier fulfils a store's order in its own job; a copy's Bosta booking does too (storeOrderId). A courier by hand: here.
        if (s?.provider !== "manual") return;
        await queue.enqueue(MizanEngine.shopifyFulfillJob({
          orderId: o.external_id, trackingNumber: data.trackingNumber, company: String(data.provider ?? "Courier"), ...(s.tracking_url ? { url: s.tracking_url } : {}),
        }), now);
        return;
      }
      case "shipment.status_changed": {
        if (!shopify || typeof data.trackingNumber !== "string") return;
        const to = data.to as ShipmentStatus;
        // A delivery Mizan booked, cancelled (at the courier, by the courier or a person): the store's fulfillment for it too.
        if (to === "cancelled") {
          const s = await trx.selectFrom("shipments").select("external_id").where("id", "=", event.entity.id).executeTakeFirst();
          if (!s?.external_id?.startsWith("gid://shopify/Fulfillment/")) await queue.enqueue(MizanEngine.shopifyCancelFulfillmentJob(o.external_id, data.trackingNumber), now);
          return;
        }
        // Statuses the courier sent reach Shopify through the engine; these are a person's or a report's.
        if (data.source !== "ops") return;
        if (sync.progressEvents) {
          const job = MizanEngine.shopifyProgressJob(o.external_id, data.trackingNumber, to, event.occurredAt);
          if (job) await queue.enqueue(job, now);
        }
        if (to === "delivered" && sync.markPaidOnDelivery && COLLECTS_ON_DELIVERY.has(o.payment_mode)) await queue.enqueue(MizanEngine.shopifyMarkPaidJob(o.external_id), now);
        const tag = to === "returned" && sync.tagReturned ? "mizan-returned" : to === "lost" && sync.tagLost ? "mizan-lost" : null;
        if (tag) await queue.enqueue(MizanEngine.shopifyTagJob(o.external_id, [tag], data.trackingNumber), now);
        return;
      }
      case "order.payment_changed": {
        // Paid in full through Mizan; what Shopify itself reported is already there.
        if (!shopify || event.actor?.type === "engine" || data.to !== "paid" || !sync.markPaidOnDelivery) return;
        await queue.enqueue(MizanEngine.shopifyMarkPaidJob(o.external_id), now);
        return;
      }
    }
  }
}
