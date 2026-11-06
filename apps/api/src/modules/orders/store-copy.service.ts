import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { trxQueryClient, type DB } from "@mizan/db";
import { MizanEngine, SqlStore, type StoreOrderDraft, type StoreOrderOutcome } from "@mizan/engine";
import { findRegion, fromMinor, type DomainEvent } from "@mizan/shared";
import { ENGINE_RUNTIME, type RuntimeFactory } from "../../integrations/engine-runtime.js";
import { storeSyncOf } from "../../integrations/store-sync-options.js";
import { Database } from "../../platform/db/database.js";
import { EventConsumer, type EventHandler } from "../../platform/events/consumer.js";
import { EventsService } from "../../platform/events/events.service.js";
import { PiiCipher } from "../../platform/pii/pii-cipher.js";

const maxZero = (x: bigint) => (x > 0n ? x : 0n);

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
  async queue(trx: Transaction<DB>, tenantId: string, orderId: string, attempt?: string): Promise<boolean> {
    const o = await trx.selectFrom("orders").select(["id", "status", "connection_id", "external_id", "store_copy_connection_id", "store_copy_status", "store_copy_id"]).where("id", "=", orderId).forUpdate().executeTakeFirst();
    if (!o || o.connection_id || o.status === "cancelled" || o.store_copy_status === "created" || o.store_copy_id) return false; // in the store already: edits follow it
    // An exchange's replacement is not a new sale: the store has the original order (and its credit is no payment).
    if (o.external_id?.startsWith("exchange:")) return false;
    let storeId = o.store_copy_connection_id;
    if (!storeId) {
      const stores = await trx.selectFrom("connections").select(["id", "config"]).where("kind", "=", "store").where("provider", "=", "shopify").where("status", "=", "active").orderBy("created_at").execute();
      storeId = stores.find((s) => storeSyncOf(s.config as Record<string, unknown> | null).createManualOrders)?.id ?? null;
    }
    if (!storeId) return false;
    // After a refusal (the team fixed the order), a new attempt: its own job key.
    const retry = attempt ?? (o.store_copy_status === "failed"
      ? Number((await trx.selectFrom("order_events").select(sql<string>`count(*)`.as("n")).where("order_id", "=", orderId).where("type", "=", "store_copy_failed").executeTakeFirstOrThrow()).n)
      : 0);
    await trx.updateTable("orders").set({ store_copy_connection_id: storeId, store_copy_status: "pending", store_copy_error: null }).where("id", "=", orderId).execute();
    const queue = new SqlStore(trxQueryClient(trx), { tenantId, store: storeId, connections: { shopify: storeId } });
    return (await queue.enqueue(MizanEngine.shopifyCreateOrderJob(orderId, retry), this.runtime(tenantId).clock.now())).created;
  }

  /**
   * An order made in Mizan was edited: its copy follows (one job per edit), or, when the store refused the
   * copy before, a new attempt now that the order changed.
   */
  async edited(trx: Transaction<DB>, tenantId: string, orderId: string, editId: string): Promise<void> {
    const o = await trx.selectFrom("orders").select(["store_copy_status", "store_copy_id", "store_copy_connection_id"]).where("id", "=", orderId).executeTakeFirst();
    if (!o) return;
    if (o.store_copy_status === "failed" && !o.store_copy_id) { await this.queue(trx, tenantId, orderId, `edit-${editId}`); return; }
    if (!o.store_copy_id || !o.store_copy_connection_id) return;
    const queue = new SqlStore(trxQueryClient(trx), { tenantId, store: o.store_copy_connection_id, connections: { shopify: o.store_copy_connection_id } });
    await queue.enqueue(MizanEngine.shopifyCopyEditJob(orderId, editId), this.runtime(tenantId).clock.now());
  }

  /** The copy and the order as it is now, for the edit job. */
  async loadCopy(tenantId: string, orderId: string): Promise<{ copyId: string; draft: StoreOrderDraft } | undefined> {
    const copyId = await this.db.tenant(tenantId, async (trx) => (await trx.selectFrom("orders").select("store_copy_id").where("id", "=", orderId).executeTakeFirst())?.store_copy_id);
    if (!copyId) return undefined;
    const draft = await this.loadDraft(tenantId, orderId, true);
    return draft ? { copyId, draft } : undefined;
  }

  /** The store's answer to an edit of the copy: in step again, or out of date with why (the team fixes it in Shopify). */
  async recordSynced(tenantId: string, orderId: string, r: import("@mizan/engine").OrderEditOutcome): Promise<void> {
    await this.db.tenant(tenantId, async (trx) => {
      const o = await trx.selectFrom("orders").select(["id", "number"]).where("id", "=", orderId).executeTakeFirst();
      if (!o) return;
      if (r.ok) {
        await trx.updateTable("orders").set({ store_copy_status: "created", store_copy_error: null }).where("id", "=", orderId).execute();
        await trx.insertInto("order_events").values({ tenant_id: tenantId, order_id: orderId, type: "store_copy_synced", actor_type: "system", data: JSON.stringify({ outcome: r.outcome }) }).execute();
        return;
      }
      await trx.updateTable("orders").set({ store_copy_status: "failed", store_copy_error: `Out of date in Shopify: ${r.message}`.slice(0, 500) }).where("id", "=", orderId).execute();
      await trx.insertInto("order_events").values({ tenant_id: tenantId, order_id: orderId, type: "store_copy_failed", actor_type: "system", data: JSON.stringify({ reason: r.reason }) }).execute();
      await this.events.emit(trx, { type: "order.store_copy_failed", tenantId, entity: { type: "order", id: orderId }, actor: { type: "engine" }, data: { number: o.number, reason: r.reason, message: r.message.slice(0, 300) } });
    });
  }

  /** The order as the store takes it, read when the job runs; undefined once copied, cancelled or gone (or, for an edit, the order now). */
  async loadDraft(tenantId: string, orderId: string, forEdit = false): Promise<StoreOrderDraft | undefined> {
    return this.db.tenant(tenantId, async (trx) => {
      const o = await trx.selectFrom("orders").selectAll().where("id", "=", orderId).executeTakeFirst();
      if (!o || o.connection_id || !o.store_copy_connection_id || (!forEdit && o.store_copy_status === "created") || (forEdit && !o.store_copy_id)) return undefined;
      if (o.status === "cancelled" || o.pii_redacted_at) {
        // Cancelled (or erased) before the store had it: no copy will be made, so none is "being created".
        if (o.store_copy_status === "pending") await trx.updateTable("orders").set({ store_copy_status: null, store_copy_connection_id: null }).where("id", "=", orderId).execute();
        return undefined;
      }
      const lines = await trx.selectFrom("order_lines as l")
        .leftJoin("external_variants as ev", (j) => j.onRef("ev.variant_id", "=", "l.variant_id").on("ev.connection_id", "=", o.store_copy_connection_id!))
        .leftJoin("variants as v", "v.id", "l.variant_id")
        .select(["l.title", "l.sku", "l.quantity", "l.unit_price_minor", "ev.external_id as store_variant", "v.price_minor as list_minor", "v.currency as list_currency"])
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
      const c = o.customer_id ? await trx.selectFrom("customers").select("email").where("id", "=", o.customer_id).executeTakeFirst() : undefined;
      const email = c ? pii.decrypt(c.email, "customers.email") ?? undefined : undefined;
      const given = name[0] || undefined;
      const firstName = given ?? "Customer";
      const lastName = name.slice(1).join(" ") || undefined;
      return {
        orderId, number: o.number, currency: o.currency.trim(),
        lines: lines.map((l) => ({
          ...(l.store_variant ? { variantExternalId: l.store_variant } : {}), title: l.title, sku: l.sku, quantity: l.quantity, unitPrice: money(l.unit_price_minor),
          ...(l.store_variant && l.list_minor !== null && l.list_currency?.trim() === o.currency.trim() ? { listPrice: money(l.list_minor) } : {}),
        })),
        // A manual order keeps its discount in the total: what lowers it is the discount (so the copy totals the same).
        shipping: money(o.shipping_minor), discount: money(maxZero(BigInt(o.subtotal_minor) + BigInt(o.shipping_minor) - total)), paid: money(paid),
        financialStatus: paid >= total && total > 0n ? "PAID" : paid > 0n ? "PARTIALLY_PAID" : "PENDING",
        // The buyer by name only when one was typed: never a "Customer" placeholder on a store customer.
        ...(phone || email ? { customer: { ...(given ? { firstName: given } : {}), ...(lastName ? { lastName } : {}), ...(phone ? { phone } : {}), ...(email ? { email } : {}) } } : {}),
        address: {
          firstName, ...(lastName ? { lastName } : {}), ...(phone ? { phone } : {}),
          line1: pii.decrypt(o.ship_line1, "orders.ship_line1") ?? "", ...(line2 ? { line2 } : {}), city: o.ship_city ?? "",
          ...(region ? { provinceCode: region.code } : {}), countryCode: country,
        },
        ...(phone ? { phone } : {}),
        tags: ["mizan"], note: `Made in Mizan (${o.number})`,
        ...(o.ship_lat !== null && o.ship_lng !== null ? { attributes: [{ key: "Location", value: `https://www.google.com/maps?q=${o.ship_lat},${o.ship_lng}` }] } : {}),
      };
    });
  }

  /** The store's answer: the copy linked, or why it was refused (on the order, for the team). */
  async recordCreated(tenantId: string, orderId: string, r: StoreOrderOutcome): Promise<void> {
    await this.db.tenant(tenantId, async (trx) => {
      const o = await trx.selectFrom("orders").select(["id", "number", "store_copy_id"]).where("id", "=", orderId).forUpdate().executeTakeFirst();
      if (!o) return;
      if (r.ok) {
        if (o.store_copy_id === r.externalId) {
          await trx.updateTable("orders").set({ store_copy_status: "created", store_copy_error: null }).where("id", "=", orderId).where("store_copy_status", "!=", "created").execute();
          return;
        }
        await trx.updateTable("orders").set({ store_copy_id: r.externalId, store_copy_name: r.name, store_copy_status: "created", store_copy_error: null }).where("id", "=", orderId).execute();
        // The money sent with the copy is Mizan's own: the copy's received total counts only beyond it (the projector).
        await trx.updateTable("orders").set({ store_copy_snapshot: sql`jsonb_build_object('sentPaid', paid_minor::text)` }).where("id", "=", orderId).where("store_copy_snapshot", "is", null).execute();
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
