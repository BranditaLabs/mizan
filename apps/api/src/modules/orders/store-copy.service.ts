import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import { trxQueryClient, type DB } from "@mizan/db";
import { MizanEngine, SqlStore, type StoreOrderDraft, type StoreOrderOutcome } from "@mizan/engine";
import { findRegion, fromMinor, type DomainEvent } from "@mizan/shared";
import { ENGINE_RUNTIME, type RuntimeFactory } from "../../integrations/engine-runtime.js";
import { storeSyncOf } from "../../integrations/store-sync-options.js";
import { Database } from "../../platform/db/database.js";
import { EventConsumer, type EventHandler } from "../../platform/events/consumer.js";
import { EventsService } from "../../platform/events/events.service.js";
import { PiiCipher } from "../../platform/pii/pii-cipher.js";

/** Countries whose region codes in the shared list are the store's province codes (ISO 3166-2). */
const PROVINCE_CODES = new Set(["EG", "AE"]);

/**
 * Orders made in Mizan, copied to the store (two-way orders): the team types an order, the store
 * gets the same order (named like Mizan's, M-1001), so Shopify, Mizan and the courier keep one
 * record. The order stays Mizan's; `store_copy_*` point at the copy. The engine reads the draft
 * when its job runs (the address never sits in a job) and reports the store's answer here.
 */
@Injectable()
export class StoreCopyService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(PiiCipher) private readonly cipher: PiiCipher,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(ENGINE_RUNTIME) private readonly runtime: RuntimeFactory,
  ) {}

  /**
   * Queue the store copy of a Mizan order (inside the caller's transaction): to the store it was
   * pointed at, else the first Shopify store whose sync switch allows it. Returns whether queued.
   */
  async queue(trx: Transaction<DB>, tenantId: string, orderId: string): Promise<boolean> {
    const o = await trx.selectFrom("orders").select(["id", "status", "connection_id", "store_copy_connection_id", "store_copy_status"]).where("id", "=", orderId).forUpdate().executeTakeFirst();
    if (!o || o.connection_id || o.status === "cancelled" || o.store_copy_status === "created") return false;
    let storeId = o.store_copy_connection_id;
    if (!storeId) {
      const stores = await trx.selectFrom("connections").select(["id", "config"]).where("kind", "=", "store").where("provider", "=", "shopify").where("status", "=", "active").orderBy("created_at").execute();
      storeId = stores.find((s) => storeSyncOf(s.config as Record<string, unknown> | null).createManualOrders)?.id ?? null;
    }
    if (!storeId) return false;
    await trx.updateTable("orders").set({ store_copy_connection_id: storeId, store_copy_status: "pending", store_copy_error: null }).where("id", "=", orderId).execute();
    const queue = new SqlStore(trxQueryClient(trx), { tenantId, store: storeId, connections: { shopify: storeId } });
    return (await queue.enqueue(MizanEngine.shopifyCreateOrderJob(orderId), this.runtime(tenantId).clock.now())).created;
  }

  /** The order as the store takes it, read when the job runs; undefined once copied, cancelled or gone. */
  async loadDraft(tenantId: string, orderId: string): Promise<StoreOrderDraft | undefined> {
    return this.db.tenant(tenantId, async (trx) => {
      const o = await trx.selectFrom("orders").selectAll().where("id", "=", orderId).executeTakeFirst();
      if (!o || o.connection_id || o.status === "cancelled" || o.store_copy_status === "created" || !o.store_copy_connection_id || o.pii_redacted_at) return undefined;
      const lines = await trx.selectFrom("order_lines as l")
        .leftJoin("external_variants as ev", (j) => j.onRef("ev.variant_id", "=", "l.variant_id").on("ev.connection_id", "=", o.store_copy_connection_id!))
        .select(["l.title", "l.sku", "l.quantity", "l.unit_price_minor", "ev.external_id as store_variant"])
        .where("l.order_id", "=", orderId).orderBy("l.position").orderBy("l.id").execute();
      const pii = await this.cipher.forTenant(trx, tenantId);
      const money = (minor: string | number | bigint) => fromMinor(BigInt(minor), o.currency).amount;
      const name = (pii.decrypt(o.ship_name, "orders.ship_name") ?? "").trim().split(/\s+/);
      const phone = pii.decrypt(o.ship_phone, "orders.ship_phone") ?? undefined;
      const line2 = pii.decrypt(o.ship_line2, "orders.ship_line2");
      const country = (o.ship_country ?? "EG").trim().toUpperCase();
      const region = PROVINCE_CODES.has(country) ? findRegion(country, o.ship_province, o.ship_city) : null;
      const total = BigInt(o.total_minor);
      const paid = BigInt(o.paid_minor);
      return {
        orderId, number: o.number, currency: o.currency.trim(),
        lines: lines.map((l) => ({ ...(l.store_variant ? { variantExternalId: l.store_variant } : {}), title: l.title, sku: l.sku, quantity: l.quantity, unitPrice: money(l.unit_price_minor) })),
        shipping: money(o.shipping_minor), discount: money(o.discount_minor), paid: money(paid),
        financialStatus: paid >= total && total > 0n ? "PAID" : paid > 0n ? "PARTIALLY_PAID" : "PENDING",
        address: {
          firstName: name[0] || "Customer", lastName: name.slice(1).join(" ") || "-", ...(phone ? { phone } : {}),
          line1: pii.decrypt(o.ship_line1, "orders.ship_line1") ?? "", ...(line2 ? { line2 } : {}), city: o.ship_city ?? "",
          ...(region ? { provinceCode: region.code } : {}), countryCode: country,
        },
        ...(phone ? { phone } : {}),
        tags: ["mizan"], note: `Made in Mizan (${o.number})`,
      };
    });
  }

  /** The store's answer: the copy linked, or why it was refused (on the order, for the team). */
  async recordCreated(tenantId: string, orderId: string, r: StoreOrderOutcome): Promise<void> {
    await this.db.tenant(tenantId, async (trx) => {
      const o = await trx.selectFrom("orders").select(["id", "number", "store_copy_id"]).where("id", "=", orderId).forUpdate().executeTakeFirst();
      if (!o) return;
      if (r.ok) {
        if (o.store_copy_id === r.externalId) return;
        await trx.updateTable("orders").set({ store_copy_id: r.externalId, store_copy_name: r.name, store_copy_status: "created", store_copy_error: null }).where("id", "=", orderId).execute();
        await trx.insertInto("order_events").values({ tenant_id: tenantId, order_id: orderId, type: "store_copy_created", actor_type: "system", data: JSON.stringify({ name: r.name, outcome: r.outcome }) }).execute();
        return;
      }
      await trx.updateTable("orders").set({ store_copy_status: "failed", store_copy_error: r.message.slice(0, 500) }).where("id", "=", orderId).execute();
      await trx.insertInto("order_events").values({ tenant_id: tenantId, order_id: orderId, type: "store_copy_failed", actor_type: "system", data: JSON.stringify({ reason: r.reason }) }).execute();
      await this.events.emit(trx, { type: "order.store_copy_failed", tenantId, entity: { type: "order", id: orderId }, actor: { type: "engine" }, data: { number: o.number, reason: r.reason, message: r.message.slice(0, 300) } });
    });
  }
}

/** A manual order created: its store copy queued (when a Shopify store takes Mizan's orders). */
@Injectable()
@EventConsumer({ name: "orders.store-copy", events: ["order.created"] })
export class StoreCopyConsumer implements EventHandler {
  constructor(@Inject(StoreCopyService) private readonly copies: StoreCopyService) {}

  async handle(event: DomainEvent, trx: Transaction<DB>): Promise<void> {
    await this.copies.queue(trx, event.tenantId, event.entity.id);
  }
}
