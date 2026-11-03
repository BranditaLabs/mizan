import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { trxQueryClient, type DB } from "@mizan/db";
import { MizanEngine, SqlStore, draftHandle, type ProductDraft, type ProductPublishOutcome } from "@mizan/engine";
import { fromMinor, toMinor } from "@mizan/shared";
import type { z } from "zod";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { AuditService, auditActor } from "../../platform/audit/audit.service.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import { MediaService } from "../../platform/media/media.service.js";
import type { NewProductSchema } from "./catalog.dto.js";
import { textToHtml } from "./products.service.js";

type NewProduct = z.output<typeof NewProductSchema>;
const MAX_PICTURES = 20;
const STORES = new Set(["shopify", "woocommerce"]);
const notFound = () => new ProblemError(404, "not_found", "this product does not exist in this store");

/**
 * P3: products made in Mizan — for stores without a channel yet, or to put on one later. Created
 * with their options and variants (SKUs unique in the store, as for every product), pictures
 * uploaded here (MediaService), and published to a connected Shopify or WooCommerce store through
 * the outbox. Once the store has it, the product is that store's like any other: Mizan links its
 * own rows to the store's ids before the store's copy is read back, so nothing is made twice.
 */
@Injectable()
export class ProductBuilderService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  async create(auth: AuthContext, body: NewProduct): Promise<{ id: string }> {
    const tenantId = auth.tenant!.id;
    // ── options and variants agree ──
    const names = body.options.map((o) => o.name.toLowerCase());
    if (new Set(names).size !== names.length) throw new ProblemError(422, "options_invalid", "two options have the same name");
    for (const o of body.options) if (new Set(o.values.map((v) => v.toLowerCase())).size !== o.values.length) throw new ProblemError(422, "options_invalid", `"${o.name}" lists a value twice`);
    if (!body.options.length && body.variants.length !== 1) throw new ProblemError(422, "variants_invalid", "a product without options has one variant");
    const combos = new Set<string>();
    for (const v of body.variants) {
      if (v.options.length !== body.options.length) throw new ProblemError(422, "variants_invalid", "each variant has one value of each option");
      const key = body.options.map((o) => {
        const val = v.options.find((x) => x.name.toLowerCase() === o.name.toLowerCase())?.value;
        if (!val || !o.values.includes(val)) throw new ProblemError(422, "variants_invalid", `a variant's "${o.name}" is not one of its values`);
        return `${o.name}=${val}`;
      }).join("|");
      if (combos.has(key)) throw new ProblemError(422, "variants_invalid", "two variants have the same option values");
      combos.add(key);
    }
    const skus = body.variants.map((v) => v.sku);
    if (new Set(skus).size !== skus.length) throw new ProblemError(422, "sku_taken", "two variants have the same SKU");

    return this.db.tenant(tenantId, async (trx) => {
      const currency = (await trx.selectFrom("tenants").select("base_currency").where("id", "=", tenantId).executeTakeFirstOrThrow()).base_currency.trim();
      const taken = await trx.selectFrom("variants").select("sku").where("sku", "in", skus).execute();
      if (taken.length) throw new ProblemError(409, "sku_taken", `already used: ${taken.map((t) => t.sku).join(", ")}`);
      const barcodes = body.variants.map((v) => v.barcode).filter((b): b is string => Boolean(b));
      if (new Set(barcodes).size !== barcodes.length) throw new ProblemError(409, "barcode_taken", "two variants have the same barcode");
      if (barcodes.length && (await trx.selectFrom("variants").select("id").where("barcode", "in", barcodes).executeTakeFirst())) throw new ProblemError(409, "barcode_taken", "a barcode is already another product's");
      const minor = (amount: string) => {
        try { return toMinor({ amount, currency }); } catch { throw new ProblemError(422, "price_decimals", `${currency} prices take fewer decimals`); }
      };
      const id = randomUUID();
      const now = new Date();
      await trx.insertInto("products").values({
        id, tenant_id: tenantId, title: body.title, status: body.status, handle: draftHandle(body.title, id),
        description_html: body.description ? textToHtml(body.description) : null, vendor: body.vendor || null, product_type: body.productType || null,
        tags: [...new Set(body.tags)], options: JSON.stringify(body.options),
      }).execute();
      for (const v of body.variants) {
        const price = minor(v.price);
        const cap = v.compareAtPrice !== undefined ? minor(v.compareAtPrice) : null;
        if (cap !== null && cap <= price) throw new ProblemError(422, "compare_at_low", "the compare-at price must be higher than the price");
        const ordered = body.options.map((o) => ({ name: o.name, value: v.options.find((x) => x.name.toLowerCase() === o.name.toLowerCase())!.value }));
        await trx.insertInto("variants").values({
          tenant_id: tenantId, product_id: id, sku: v.sku, title: ordered.length ? ordered.map((o) => o.value).join(" / ") : null,
          price_minor: price, compare_at_minor: cap, currency, options: JSON.stringify(ordered),
          ...(v.barcode ? { barcode: v.barcode, barcode_set_at: now } : {}),
          ...(v.cost !== undefined ? { cogs_minor: minor(v.cost), cogs_set_at: now } : {}),
        }).execute();
      }
      await this.audit.record(trx, { action: "catalog.product_created", tenantId, ...auditActor(auth), entity: { type: "product", id }, after: { title: body.title, variants: body.variants.length, options: body.options.map((o) => o.name) } });
      await this.events.emit(trx, { type: "product.created", tenantId, entity: { type: "product", id }, actor: { type: "user", id: auth.user.id }, data: { title: body.title, variants: body.variants.length } });
      return { id };
    });
  }

  /** A picture for a product made in Mizan (a store's product gets its pictures in the store). */
  async addPicture(auth: AuthContext, productId: string, bytes: Buffer | undefined) {
    const tenantId = auth.tenant!.id;
    if (!Buffer.isBuffer(bytes)) throw new ProblemError(415, "picture_type", "send the picture's bytes as image/jpeg, image/png or image/webp");
    return this.db.tenant(tenantId, async (trx) => {
      const p = await this.ownProduct(trx, productId, true);
      const { n, last } = await trx.selectFrom("product_images").select([sql<string>`count(*)`.as("n"), sql<number | null>`max(position)`.as("last")]).where("product_id", "=", p.id).executeTakeFirstOrThrow();
      if (Number(n) >= MAX_PICTURES) throw new ProblemError(409, "too_many_pictures", `${MAX_PICTURES} pictures per product at most`);
      const saved = await this.media.savePicture(trx, tenantId, `p/${p.id}`, bytes);
      const row = await trx.insertInto("product_images").values({
        tenant_id: tenantId, product_id: p.id, media_id: saved.full.id, url: saved.full.url, thumb_url: saved.thumb.url,
        width: saved.full.width, height: saved.full.height, position: last === null ? 0 : Number(last) + 1, is_main: Number(n) === 0,
      }).returning(["id", "url", "thumb_url", "alt", "width", "height", "is_main"]).executeTakeFirstOrThrow();
      await trx.updateTable("products").set({ updated_at: new Date() }).where("id", "=", p.id).execute();
      await this.audit.record(trx, { action: "catalog.picture_added", tenantId, ...auditActor(auth), entity: { type: "product", id: p.id }, after: { imageId: row.id, bytes: bytes.length } });
      return { id: row.id, url: row.url, thumbUrl: row.thumb_url, alt: row.alt, width: row.width, height: row.height, isMain: row.is_main };
    });
  }

  async removePicture(auth: AuthContext, productId: string, imageId: string): Promise<void> {
    const tenantId = auth.tenant!.id;
    await this.db.tenant(tenantId, async (trx) => {
      const p = await this.ownProduct(trx, productId, true);
      const img = await trx.selectFrom("product_images as i").leftJoin("media_objects as m", "m.id", "i.media_id")
        .select(["i.id", "i.is_main", "i.media_id", "m.key"]).where("i.id", "=", imageId).where("i.product_id", "=", p.id).executeTakeFirst();
      if (!img) throw new ProblemError(404, "not_found", "no such picture on this product");
      await trx.deleteFrom("product_images").where("id", "=", img.id).execute();
      if (img.is_main) {
        // The next picture is the main one now.
        const next = await trx.selectFrom("product_images").select("id").where("product_id", "=", p.id).orderBy("position").limit(1).executeTakeFirst();
        if (next) await trx.updateTable("product_images").set({ is_main: true }).where("id", "=", next.id).execute();
      }
      if (img.media_id && img.key) {
        const thumb = await trx.selectFrom("media_objects").select("id").where("key", "=", img.key.replace(/\.webp$/, "_400.webp")).executeTakeFirst();
        await this.media.remove(trx, tenantId, [img.media_id, ...(thumb ? [thumb.id] : [])]);
      }
      await trx.updateTable("products").set({ updated_at: new Date() }).where("id", "=", p.id).execute();
      await this.audit.record(trx, { action: "catalog.picture_removed", tenantId, ...auditActor(auth), entity: { type: "product", id: p.id }, before: { imageId: img.id } });
    });
  }

  /** Put a product made in Mizan on a connected store (outbox); the result comes back through the engine. */
  async publish(auth: AuthContext, productId: string, connectionId: string): Promise<{ status: "publishing" }> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const p = await this.ownProduct(trx, productId, true);
      if (p.publish_status === "publishing") throw new ProblemError(409, "publishing", "the product is on its way to the store already");
      const c = await trx.selectFrom("connections").select(["id", "provider", "kind", "status"]).where("id", "=", connectionId).executeTakeFirst();
      if (!c || c.kind !== "store" || !STORES.has(c.provider)) throw new ProblemError(422, "not_a_store", "choose a connected Shopify or WooCommerce store");
      if (c.status !== "active") throw new ProblemError(409, "store_not_active", "the store's connection needs attention first");
      const variants = await trx.selectFrom("variants").select("id").where("product_id", "=", p.id).execute();
      if (!variants.length) throw new ProblemError(422, "variants_invalid", "the product has no variant");
      const attempt = p.publish_attempts + 1;
      await trx.updateTable("products").set({ publish_status: "publishing", publish_connection_id: c.id, publish_error: null, publish_attempts: attempt, updated_at: new Date() }).where("id", "=", p.id).execute();
      const provider = c.provider as "shopify" | "woocommerce";
      const store = new SqlStore(trxQueryClient(trx), { tenantId, connections: { [provider]: c.id }, store: c.id });
      await store.enqueue(MizanEngine.productPublishJob(provider, p.id, attempt), Date.now());
      await this.audit.record(trx, { action: "catalog.product_publish_requested", tenantId, ...auditActor(auth), entity: { type: "product", id: p.id }, after: { connectionId: c.id, provider, attempt } });
      return { status: "publishing" as const };
    });
  }

  /** The engine's loadProductDraft hook: the product as the store should get it; only while it is being published. */
  async loadDraft(tenantId: string, productId: string): Promise<ProductDraft | undefined> {
    return this.db.tenant(tenantId, async (trx) => {
      const p = await trx.selectFrom("products").selectAll().where("id", "=", productId).where("publish_status", "=", "publishing").where("connection_id", "is", null).executeTakeFirst();
      if (!p) return undefined;
      const variants = await trx.selectFrom("variants").select(["id", "sku", "price_minor", "compare_at_minor", "currency", "barcode", "options"]).where("product_id", "=", p.id).orderBy("created_at").orderBy("sku").execute();
      const images = await trx.selectFrom("product_images").select(["id", "url", "alt"]).where("product_id", "=", p.id).where("media_id", "is not", null).orderBy("position").execute();
      const options = Array.isArray(p.options) ? (p.options as Array<{ name: string; values: string[] }>) : [];
      // In the options' order (S before M), as the store shows them; created together, they share a time.
      const rank = (raw: unknown) => {
        const vals = Array.isArray(raw) ? (raw as Array<{ name: string; value: string }>) : [];
        return options.map((o) => o.values.indexOf(vals.find((x) => x.name === o.name)?.value ?? ""));
      };
      variants.sort((a, b) => {
        const [x, y] = [rank(a.options), rank(b.options)];
        for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
        return 0;
      });
      const currency = variants[0]?.currency.trim() ?? "EGP";
      return {
        productId: p.id, title: p.title, handle: draftHandle(p.title, p.id), descriptionHtml: p.description_html ?? undefined,
        status: p.status as ProductDraft["status"], vendor: p.vendor ?? undefined, productType: p.product_type ?? undefined, tags: p.tags, options,
        variants: variants.map((v) => ({
          variantId: v.id, sku: v.sku, price: fromMinor(BigInt(v.price_minor), v.currency.trim()).amount,
          compareAtPrice: v.compare_at_minor === null ? undefined : fromMinor(BigInt(v.compare_at_minor), v.currency.trim()).amount,
          barcode: v.barcode ?? undefined, options: Array.isArray(v.options) ? (v.options as Array<{ name: string; value: string }>) : [],
        })),
        images: images.map((i) => ({ imageId: i.id, url: i.url, alt: i.alt ?? undefined })),
        currency,
      };
    });
  }

  /**
   * The engine's onProductPublished hook. On success the product becomes the store's: linked to
   * its ids (product, variants, pictures) before the store's copy is read back. Settled once.
   */
  async recordPublished(tenantId: string, productId: string, result: ProductPublishOutcome): Promise<void> {
    await this.db.tenant(tenantId, async (trx) => {
      const p = await trx.selectFrom("products").select(["id", "title", "publish_status", "publish_connection_id", "connection_id"]).where("id", "=", productId).forUpdate().executeTakeFirst();
      if (!p || p.publish_status !== "publishing" || !p.publish_connection_id) return;
      const entity = { type: "product", id: p.id };
      if (!result.ok) {
        await trx.updateTable("products").set({ publish_status: "failed", publish_error: result.message.slice(0, 1000) }).where("id", "=", p.id).execute();
        await this.events.emit(trx, { type: "product.publish_failed", tenantId, entity, actor: { type: "engine" }, data: { reason: result.reason } });
        return;
      }
      const conn = p.publish_connection_id;
      await trx.updateTable("products").set({ connection_id: conn, external_id: result.externalId, publish_status: "published", publish_error: null, updated_at: new Date() }).where("id", "=", p.id).execute();
      for (const [variantId, externalId] of Object.entries(result.variants)) {
        await trx.insertInto("external_variants").values({ tenant_id: tenantId, connection_id: conn, external_id: externalId, external_product_id: result.externalId, variant_id: variantId })
          .onConflict((oc) => oc.columns(["connection_id", "external_id"]).doUpdateSet({ variant_id: variantId, external_product_id: result.externalId })).execute();
      }
      for (const [imageId, externalId] of Object.entries(result.images)) {
        await trx.updateTable("product_images").set({ external_id: externalId }).where("id", "=", imageId).where("product_id", "=", p.id).execute();
      }
      await this.events.emit(trx, { type: "product.published", tenantId, entity, actor: { type: "engine" }, data: { connectionId: conn, externalId: result.externalId } });
    });
  }

  /** A product made in Mizan (not a store's), locked when it is about to change. */
  private async ownProduct(trx: Transaction<DB>, id: string, lock = false) {
    let q = trx.selectFrom("products").select(["id", "connection_id", "publish_status", "publish_attempts"]).where("id", "=", id);
    if (lock) q = q.forUpdate();
    const p = await q.executeTakeFirst();
    if (!p) throw notFound();
    if (p.connection_id) throw new ProblemError(409, "store_product", "this product is the store's: change its pictures and publishing there");
    return p;
  }
}
