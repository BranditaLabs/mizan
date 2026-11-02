import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import { trxQueryClient, type DB } from "@mizan/db";
import { MizanEngine, SqlStore } from "@mizan/engine";
import type { DomainEvent } from "@mizan/shared";
import { EventConsumer, type EventHandler } from "../../../platform/events/consumer.js";
import { ENGINE_RUNTIME, type RuntimeFactory } from "../../../integrations/engine-registry.js";
import { OffersService } from "./offers.service.js";

/**
 * An accepted offer joins the customer's order in the store (E6-13): queue the engine's
 * `shopify.addOffer` job in the event's transaction (rule 3), keyed by the offer, and mark the
 * offer applying. The engine's result comes back through the onOfferResult hook. An order or
 * product the store does not know (manual order, unlinked product) fails at once: the team adds
 * it by hand.
 */
@Injectable()
@EventConsumer({ name: "offers.apply", events: ["offer.accepted"] })
export class OfferApplyConsumer implements EventHandler {
  constructor(@Inject(ENGINE_RUNTIME) private readonly runtime: RuntimeFactory, @Inject(OffersService) private readonly offers: OffersService) {}

  async handle(event: DomainEvent, trx: Transaction<DB>): Promise<void> {
    const offerId = String(event.data.offerId ?? "");
    const f = await trx.selectFrom("order_offers as f").innerJoin("orders as o", "o.id", "f.order_id").leftJoin("connections as c", "c.id", "o.connection_id")
      .select(["f.id", "f.status", "f.variant_id", "f.qty", "f.discount_pct", "f.channel", "o.external_id", "o.connection_id", "c.provider", "c.status as connection_status"])
      .where("f.id", "=", offerId).executeTakeFirst();
    if (!f || f.status !== "accepted") return;
    const ext = f.connection_id ? await trx.selectFrom("external_variants").select("external_id")
      .where("connection_id", "=", f.connection_id).where("variant_id", "=", f.variant_id).executeTakeFirst() : undefined;
    if (!f.external_id || f.provider !== "shopify" || f.connection_status === "disconnected" || !ext) {
      await trx.updateTable("order_offers").set({ status: "applying", updated_at: new Date() }).where("id", "=", f.id).execute();
      await this.offers.recordResultIn(trx, event.tenantId, f.id, { ok: false, reason: "not_in_store", message: "the order or the product is not in a connected store" });
      return;
    }
    await trx.updateTable("order_offers").set({ status: "applying", updated_at: new Date() }).where("id", "=", f.id).execute();
    const store = new SqlStore(trxQueryClient(trx), { tenantId: event.tenantId, connections: { shopify: f.connection_id! } });
    await store.enqueue(MizanEngine.shopifyOfferJob({
      offerId: f.id, orderId: f.external_id, variantId: ext.external_id, qty: f.qty, discountPct: String(Number(f.discount_pct)), note: `Mizan: offer accepted (${f.channel ?? "team"})`,
    }), this.runtime(event.tenantId).clock.now());
  }
}
