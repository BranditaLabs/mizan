import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { toMinor, type CanonicalProduct } from "@mizan/shared";
import { Database } from "../../platform/db/database.js";

const STATUS: Record<CanonicalProduct["status"], "active" | "draft" | "archived"> = { active: "active", draft: "draft", archived: "archived", unknown: "draft" };

/**
 * Store products → Mizan's catalogue (E4-5): `products`, `variants`, `external_variants`.
 * Called from the engine's onProduct hook for every product it reads (webhook, refetch, backfill),
 * so it must be idempotent. Fields the store owns (title, price, SKU, status) follow the store;
 * the cost (cogs_minor, cogs_set_at) belongs to Mizan and is never touched here.
 */
@Injectable()
export class ProductProjector {
  constructor(@Inject(Database) private readonly db: Database) {}

  async project(tenantId: string, connectionId: string, product: CanonicalProduct): Promise<void> {
    await this.db.tenant(tenantId, async (trx) => {
      const base = (await trx.selectFrom("tenants").select("base_currency").where("id", "=", tenantId).executeTakeFirstOrThrow()).base_currency;
      const productId = await this.upsertProduct(trx, tenantId, connectionId, product);
      for (const v of product.variants) {
        const currency = v.price.currency || base;
        const title = v.title && v.title !== "Default Title" ? v.title : null;
        const link = await trx.selectFrom("external_variants").select("variant_id")
          .where("connection_id", "=", connectionId).where("external_id", "=", v.externalId).executeTakeFirst();
        const values = {
          product_id: productId, title, barcode: null,
          price_minor: toMinor(v.price.amount, currency),
          compare_at_minor: v.compareAtPrice ? toMinor(v.compareAtPrice.amount, v.compareAtPrice.currency || currency) : null,
          currency, updated_at: new Date(),
        };
        let variantId = link?.variant_id ?? null;
        if (variantId) {
          await trx.updateTable("variants").set({ ...values, sku: await this.sku(trx, v.sku, v.externalId, variantId) }).where("id", "=", variantId).execute();
        } else {
          variantId = (await trx.insertInto("variants").values({ tenant_id: tenantId, ...values, sku: await this.sku(trx, v.sku, v.externalId, null) })
            .returning("id").executeTakeFirstOrThrow()).id;
        }
        await trx.insertInto("external_variants").values({
          tenant_id: tenantId, connection_id: connectionId, external_id: v.externalId, external_product_id: product.externalId,
          inventory_item_id: v.inventoryItemId ?? null, variant_id: variantId,
          last_seen: JSON.stringify({ price: v.price.amount, sku: v.sku ?? null, updatedAt: product.updatedAt }),
        }).onConflict((oc) => oc.columns(["connection_id", "external_id"]).doUpdateSet({
          variant_id: variantId, external_product_id: product.externalId, inventory_item_id: v.inventoryItemId ?? null,
          last_seen: JSON.stringify({ price: v.price.amount, sku: v.sku ?? null, updatedAt: product.updatedAt }),
        })).execute();
      }
    });
  }

  private async upsertProduct(trx: Transaction<DB>, tenantId: string, connectionId: string, p: CanonicalProduct): Promise<string> {
    const row = await trx.selectFrom("products").select("id")
      .where("connection_id", "=", connectionId).where("external_id", "=", p.externalId).executeTakeFirst();
    if (row) {
      await trx.updateTable("products").set({ title: p.title, status: STATUS[p.status], updated_at: new Date() }).where("id", "=", row.id).execute();
      return row.id;
    }
    return (await trx.insertInto("products").values({ tenant_id: tenantId, connection_id: connectionId, external_id: p.externalId, title: p.title, status: STATUS[p.status] })
      .returning("id").executeTakeFirstOrThrow()).id;
  }

  /**
   * SKUs are unique per store in Mizan (warehouse scanning relies on it), not in Shopify: a variant
   * without a SKU, or whose SKU another variant already has, gets a stable stand-in from its id.
   */
  private async sku(trx: Transaction<DB>, sku: string | undefined, externalId: string, self: string | null): Promise<string> {
    const fallback = `SHOPIFY-${externalId.replace(/^gid:\/\/shopify\/ProductVariant\//, "")}`;
    const wanted = sku?.trim();
    if (!wanted) return fallback;
    let q = trx.selectFrom("variants").select("id").where("sku", "=", wanted);
    if (self) q = q.where("id", "!=", self);
    return (await q.executeTakeFirst()) ? fallback : wanted;
  }
}
