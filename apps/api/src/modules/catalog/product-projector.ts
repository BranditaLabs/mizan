import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { toMinor, type CanonicalProduct } from "@mizan/shared";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";

const STATUS: Record<CanonicalProduct["status"], "active" | "draft" | "archived"> = { active: "active", draft: "draft", archived: "archived", unknown: "draft" };

/**
 * Store products → Mizan's catalogue (E4-5): `products`, `variants`, `external_variants`.
 * Called from the engine's onProduct hook for every product it reads (webhook, refetch, backfill),
 * so it must be idempotent. Fields the store owns (title, price, SKU, status, stock) follow the
 * store; the cost (cogs_minor, cogs_set_at) belongs to Mizan and is never touched here. The barcode
 * is the store's until the merchant sets one in Mizan (barcode_set_at), then it is left alone.
 * P1: the product's description, vendor, type, tags and options, and its pictures as the store
 * orders them, the store's featured one as main (else the first); a picture the store dropped goes.
 */
@Injectable()
export class ProductProjector {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  async project(tenantId: string, connectionId: string, product: CanonicalProduct): Promise<void> {
    await this.db.tenant(tenantId, async (trx) => {
      const base = (await trx.selectFrom("tenants").select("base_currency").where("id", "=", tenantId).executeTakeFirstOrThrow()).base_currency;
      const productId = await this.upsertProduct(trx, tenantId, connectionId, product);
      const images = await this.syncImages(trx, tenantId, productId, product);
      const linked: string[] = [];
      for (const v of product.variants) {
        const currency = v.price.currency || base;
        const title = v.title && v.title !== "Default Title" ? v.title : null;
        const link = await trx.selectFrom("external_variants").select("variant_id")
          .where("connection_id", "=", connectionId).where("external_id", "=", v.externalId).executeTakeFirst();
        const values = {
          product_id: productId, title,
          price_minor: toMinor(v.price.amount, currency),
          compare_at_minor: v.compareAtPrice ? toMinor(v.compareAtPrice.amount, v.compareAtPrice.currency || currency) : null,
          currency, updated_at: new Date(),
          options: JSON.stringify(v.options ?? []), image_id: (v.imageId && images.get(v.imageId)) ?? null,
          ...(v.available !== undefined ? { available: v.available, available_at: new Date() } : {}),
        };
        let variantId = link?.variant_id ?? null;
        if (!variantId && v.sku) {
          // A product made in Mizan, linked here or adopted above (P3): its variant with this SKU, not yet linked to the store.
          const own = await trx.selectFrom("variants as x").select("x.id").where("x.product_id", "=", productId).where("x.sku", "=", v.sku)
            .where(({ not, exists, selectFrom }) => not(exists(selectFrom("external_variants as e").select("e.variant_id").whereRef("e.variant_id", "=", "x.id").where("e.connection_id", "=", connectionId))))
            .executeTakeFirst();
          variantId = own?.id ?? null;
        }
        if (variantId) {
          const own = await trx.selectFrom("variants").select("barcode_set_at").where("id", "=", variantId).executeTakeFirst();
          const barcode = own?.barcode_set_at ? {} : { barcode: await this.barcode(trx, v.barcode, variantId) };
          await trx.updateTable("variants").set({ ...values, ...barcode, sku: await this.sku(trx, v.sku, v.externalId, variantId) }).where("id", "=", variantId).execute();
        } else {
          variantId = (await trx.insertInto("variants").values({ tenant_id: tenantId, ...values, barcode: await this.barcode(trx, v.barcode, null), sku: await this.sku(trx, v.sku, v.externalId, null) })
            .returning("id").executeTakeFirstOrThrow()).id;
        }
        await trx.insertInto("external_variants").values({
          tenant_id: tenantId, connection_id: connectionId, external_id: v.externalId, external_product_id: product.externalId,
          inventory_item_id: v.inventoryItemId ?? null, variant_id: variantId,
          last_seen: JSON.stringify({ price: v.price.amount, sku: v.sku ?? null, barcode: v.barcode ?? null, locations: v.locationIds ?? [], updatedAt: product.updatedAt }),
        }).onConflict((oc) => oc.columns(["connection_id", "external_id"]).doUpdateSet({
          variant_id: variantId, external_product_id: product.externalId, inventory_item_id: v.inventoryItemId ?? null,
          last_seen: JSON.stringify({ price: v.price.amount, sku: v.sku ?? null, barcode: v.barcode ?? null, locations: v.locationIds ?? [], updatedAt: product.updatedAt }),
        })).execute();
        // Lines of orders that arrived before this product now learn what they are.
        const lines = await trx.updateTable("order_lines").set({ variant_id: variantId })
          .where("variant_id", "is", null).where("external_variant_id", "=", v.externalId)
          .where("order_id", "in", trx.selectFrom("orders").select("id").where("connection_id", "=", connectionId))
          .executeTakeFirst();
        if (Number(lines.numUpdatedRows) > 0) linked.push(variantId);
      }
      if (linked.length) {
        // Their product cost now counts: the profit consumer recomputes those orders.
        await this.events.emit(trx, {
          type: "costs.changed", tenantId, entity: { type: "product", id: productId }, actor: { type: "engine" },
          data: { kind: "product_cost", variantIds: linked, reason: "lines_linked" },
        });
      }
    });
  }

  private async upsertProduct(trx: Transaction<DB>, tenantId: string, connectionId: string, p: CanonicalProduct): Promise<string> {
    const row = await trx.selectFrom("products").select("id")
      .where("connection_id", "=", connectionId).where("external_id", "=", p.externalId).executeTakeFirst();
    const details = {
      title: p.title, status: STATUS[p.status], handle: p.handle?.slice(0, 255) ?? null, description_html: p.descriptionHtml ?? null,
      vendor: p.vendor?.slice(0, 255) || null, product_type: p.productType?.slice(0, 255) || null, tags: p.tags, options: JSON.stringify(p.options ?? []),
    };
    if (row) {
      await trx.updateTable("products").set({ ...details, updated_at: new Date() }).where("id", "=", row.id).execute();
      return row.id;
    }
    // A product made in Mizan, on its way to this store (P3): the store's copy can arrive (a webhook,
    // a sync) before the publish job links it. Same store, same handle: it is that product, not a new one.
    const publishing = p.handle ? await trx.selectFrom("products").select("id").where("connection_id", "is", null).where("publish_status", "=", "publishing")
      .where("publish_connection_id", "=", connectionId).where("handle", "=", p.handle).forUpdate().executeTakeFirst() : undefined;
    if (publishing) {
      await trx.updateTable("products").set({ ...details, connection_id: connectionId, external_id: p.externalId, updated_at: new Date() }).where("id", "=", publishing.id).execute();
      return publishing.id;
    }
    return (await trx.insertInto("products").values({ tenant_id: tenantId, connection_id: connectionId, external_id: p.externalId, ...details })
      .returning("id").executeTakeFirstOrThrow()).id;
  }

  /**
   * The store's pictures, in its order, keyed by the store's id: kept, moved, added or removed to
   * match. Returns store id → Mizan id for the variants' pictures. Pictures added in Mizan (no
   * external id) are left alone. A store that sends no picture field (an older query) changes nothing.
   */
  private async syncImages(trx: Transaction<DB>, tenantId: string, productId: string, p: CanonicalProduct): Promise<Map<string, string>> {
    const existing = await trx.selectFrom("product_images").select(["id", "external_id"]).where("product_id", "=", productId).where("external_id", "is not", null).execute();
    const ids = new Map(existing.map((e) => [e.external_id!, e.id]));
    if (!p.images) return ids;
    const main = p.mainImageId ?? p.images[0]?.externalId;
    const gone = existing.filter((e) => !p.images!.some((i) => i.externalId === e.external_id)).map((e) => e.id);
    if (gone.length) await trx.deleteFrom("product_images").where("id", "in", gone).execute();
    // The main flag moves in two steps: one main picture per product at every moment.
    // Every picture of the product, Mizan's too (P3): the store's main picture is the only main one.
    await trx.updateTable("product_images").set({ is_main: false }).where("product_id", "=", productId).execute();
    const now = new Date();
    for (const [position, img] of p.images.entries()) {
      const values = { url: img.url, alt: img.alt?.slice(0, 512) ?? null, width: img.width ?? null, height: img.height ?? null, position, is_main: img.externalId === main, updated_at: now };
      const id = ids.get(img.externalId);
      if (id) await trx.updateTable("product_images").set(values).where("id", "=", id).execute();
      else ids.set(img.externalId, (await trx.insertInto("product_images").values({ tenant_id: tenantId, product_id: productId, external_id: img.externalId, ...values }).returning("id").executeTakeFirstOrThrow()).id);
    }
    for (const g of existing.filter((e) => gone.includes(e.id))) ids.delete(g.external_id!);
    return ids;
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

  /** The store's barcode, unless another variant here already has it (a scan must find one item). */
  private async barcode(trx: Transaction<DB>, barcode: string | undefined, self: string | null): Promise<string | null> {
    const wanted = barcode?.trim();
    if (!wanted || wanted.length > 64) return null;
    let q = trx.selectFrom("variants").select("id").where("barcode", "=", wanted);
    if (self) q = q.where("id", "!=", self);
    return (await q.executeTakeFirst()) ? null : wanted;
  }
}
