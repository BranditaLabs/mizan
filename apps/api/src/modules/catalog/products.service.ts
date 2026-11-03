import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { trxQueryClient, type DB } from "@mizan/db";
import { MizanEngine, SqlStore } from "@mizan/engine";
import { fromMinor, toMinor, type ProductPatch } from "@mizan/shared";
import type { z } from "zod";
import { auditActor, AuditService } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import { ProductEventsService } from "../onboarding/product-events.service.js";
import { parseCostCsv, type CostCsvProblem } from "./cost-csv.js";
import type { ProductUpdateSchema } from "./catalog.dto.js";

type Query = { search?: string | undefined; status: "active" | "draft" | "archived" | "all"; missing?: "cost" | "barcode" | undefined; limit: number; cursor?: string | undefined };

/** Cursor = the last product's title and id: products are listed by title. */
const encode = (title: string, id: string) => Buffer.from(JSON.stringify([title, id])).toString("base64url");
function decode(cursor: string): { title: string; id: string } {
  try {
    const [title, id] = JSON.parse(Buffer.from(cursor, "base64url").toString()) as unknown[];
    if (typeof title === "string" && typeof id === "string") return { title, id };
  } catch { /* falls through */ }
  throw new ProblemError(400, "validation_failed", "cursor is not valid", [{ path: "cursor", code: "invalid" }]);
}
const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const isBarcodeClash = (e: unknown) => (e as { code?: string; constraint?: string }).code === "23505" && /variants_barcode/.test(String((e as { constraint?: string }).constraint ?? (e as Error).message));

/**
 * The catalogue (M4, E8-1): products as the store has them, with what Mizan adds — the cost (for
 * profit) and the barcode (for scanning). Field ownership: title, price, SKU, status and stock
 * come from the store and are changed there; the cost is Mizan's; the barcode is the store's until
 * it is set here. Costs arrive one by one or as a file (all lines valid or nothing saved).
 */
@Injectable()
export class ProductsService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ProductEventsService) private readonly productEvents: ProductEventsService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  async list(tenantId: string, q: Query) {
    const after = q.cursor ? decode(q.cursor) : null;
    return this.db.tenant(tenantId, async (trx) => {
      let query = trx.selectFrom("products as p").leftJoin("connections as c", "c.id", "p.connection_id")
        .select(["p.id", "p.title", "p.status", "p.connection_id", "c.provider", "c.external_account", "p.vendor", "p.product_type", "p.tags", "p.options"])
        .orderBy("p.title").orderBy("p.id").limit(q.limit + 1);
      query = q.status === "all" ? query.where("p.status", "!=", "archived") : query.where("p.status", "=", q.status);
      if (q.search) {
        const s = like(q.search);
        query = query.where((eb) => eb.or([
          eb("p.title", "ilike", s),
          eb.exists(eb.selectFrom("variants as v").select("v.id").whereRef("v.product_id", "=", "p.id").where((e) => e.or([e("v.sku", "ilike", s), e("v.barcode", "ilike", s), e("v.title", "ilike", s)]))),
        ]));
      }
      if (q.missing) {
        const col = q.missing === "cost" ? "v.cogs_set_at" : "v.barcode";
        query = query.where((eb) => eb.exists(eb.selectFrom("variants as v").select("v.id").whereRef("v.product_id", "=", "p.id").where(col, "is", null)));
      }
      if (after) query = query.where((eb) => eb.or([eb("p.title", ">", after.title), eb.and([eb("p.title", "=", after.title), eb("p.id", ">", after.id)])]));
      const rows = await query.execute();
      const page = rows.slice(0, q.limit);
      const variants = page.length
        ? await trx.selectFrom("variants").selectAll().where("product_id", "in", page.map((p) => p.id)).orderBy("created_at").orderBy("sku").execute()
        : [];
      const images = page.length
        ? await trx.selectFrom("product_images").select(["id", "product_id", "url", "thumb_url", "alt", "width", "height", "is_main"]).where("product_id", "in", page.map((p) => p.id)).orderBy("position").execute()
        : [];
      const counts = await trx.selectFrom("variants as v").innerJoin("products as p", "p.id", "v.product_id").where("p.status", "!=", "archived")
        .select([
          sql<string>`count(distinct p.id)`.as("products"), sql<string>`count(*)`.as("variants"),
          sql<string>`count(*) filter (where v.cogs_set_at is null)`.as("missing_cost"), sql<string>`count(*) filter (where v.barcode is null)`.as("missing_barcode"),
        ]).executeTakeFirstOrThrow();
      const last = page.at(-1);
      return {
        data: page.map((p) => {
          const own = images.filter((i) => i.product_id === p.id);
          const main = own.find((i) => i.is_main) ?? own[0];
          return {
            id: p.id, title: p.title, status: p.status as "active" | "draft" | "archived",
            store: p.connection_id && p.provider ? { connectionId: p.connection_id, provider: p.provider, name: p.external_account ?? p.provider } : null,
            mainImage: main ? imageView({ ...main, is_main: true }) : null, imageCount: own.length,
            vendor: p.vendor, productType: p.product_type, tags: p.tags, options: optionsOf(p.options),
            variants: inOptionOrder(variants.filter((v) => v.product_id === p.id).map(variantView), optionsOf(p.options)),
          };
        }),
        nextCursor: rows.length > q.limit && last ? encode(last.title, last.id) : null,
        counts: { products: Number(counts.products), variants: Number(counts.variants), missingCost: Number(counts.missing_cost), missingBarcode: Number(counts.missing_barcode) },
      };
    });
  }

  /** One product in full (P1): pictures with the main one, options, every variant, details and totals. */
  async detail(tenantId: string, id: string) {
    return this.db.tenant(tenantId, async (trx) => {
      const p = await trx.selectFrom("products as p").leftJoin("connections as c", "c.id", "p.connection_id")
        .select(["p.id", "p.title", "p.status", "p.handle", "p.description_html", "p.vendor", "p.product_type", "p.tags", "p.options", "p.updated_at",
          "p.external_id", "p.connection_id", "c.provider", "c.external_account", "c.config", "p.publish_status", "p.publish_connection_id", "p.publish_error"])
        .where("p.id", "=", id).executeTakeFirst();
      if (!p) throw new ProblemError(404, "not_found", "this product does not exist in this store");
      const variants = await trx.selectFrom("variants").selectAll().where("product_id", "=", id).orderBy("created_at").orderBy("sku").execute();
      const images = await trx.selectFrom("product_images").select(["id", "url", "thumb_url", "alt", "width", "height", "is_main"]).where("product_id", "=", id).orderBy("position").execute();
      const main = images.find((i) => i.is_main)?.id ?? images[0]?.id;
      const prices = variants.map((v) => ({ minor: BigInt(v.price_minor), currency: v.currency }));
      const one = prices.length > 0 && prices.every((x) => x.currency === prices[0]!.currency);
      const sorted = one ? [...prices].sort((a, b) => (a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0)) : [];
      const known = variants.filter((v) => v.available !== null);
      return {
        id: p.id, title: p.title, status: p.status as "active" | "draft" | "archived",
        store: p.connection_id && p.provider ? { connectionId: p.connection_id, provider: p.provider, name: p.external_account ?? p.provider } : null,
        vendor: p.vendor, productType: p.product_type, tags: p.tags, options: optionsOf(p.options),
        handle: p.handle, description: htmlToText(p.description_html ?? ""),
        images: images.map((i) => imageView({ ...i, is_main: i.id === main })),
        storeUrl: storeUrl(p.provider, p.external_account, p.external_id, p.config),
        publish: p.publish_status ? { status: p.publish_status as "publishing" | "published" | "failed", connectionId: p.publish_connection_id, error: p.publish_error } : null,
        updatedAt: p.updated_at.toISOString(),
        variants: inOptionOrder(variants.map(variantView), optionsOf(p.options)),
        totals: {
          variants: variants.length,
          available: known.length ? known.reduce((n, v) => n + (v.available ?? 0), 0) : null,
          priceMin: sorted[0] ? fromMinor(sorted[0].minor, sorted[0].currency) : null,
          priceMax: sorted.at(-1) ? fromMinor(sorted.at(-1)!.minor, sorted.at(-1)!.currency) : null,
          missingCost: variants.filter((v) => !v.cogs_set_at).length,
          missingBarcode: variants.filter((v) => !v.barcode).length,
        },
      };
    });
  }

  /**
   * P2: the team edits the product. Saved at once; a store's product gets the change through the
   * outbox (rule 3) as Mizan's desired values, so the latest edit wins whatever order the jobs run
   * in. Prices set here are Mizan's from then on (the engine puts them back if the store changes
   * them); other fields follow the last edit, here or in the store. Pictures are reordered, never
   * added or dropped here (P3), and the main one is first, as both stores have it.
   */
  async edit(auth: AuthContext, id: string, body: z.output<typeof ProductUpdateSchema>) {
    const tenantId = auth.tenant!.id;
    await this.db.tenant(tenantId, async (trx) => {
      const p = await trx.selectFrom("products as p").leftJoin("connections as c", "c.id", "p.connection_id")
        .select(["p.id", "p.title", "p.status", "p.description_html", "p.tags", "p.vendor", "p.product_type", "p.external_id", "p.connection_id", "c.provider", "p.publish_status"])
        .where("p.id", "=", id).forUpdate("p").executeTakeFirst();
      if (!p) throw new ProblemError(404, "not_found", "this product does not exist in this store");
      if (p.publish_status === "publishing") throw new ProblemError(409, "publishing", "the product is on its way to a store: wait until it is there");
      const provider = p.connection_id && p.external_id && (p.provider === "shopify" || p.provider === "woocommerce") ? p.provider : null;
      if (provider === "woocommerce" && (body.vendor !== undefined || body.productType !== undefined)) {
        throw new ProblemError(422, "field_not_in_store", "WooCommerce products have no vendor or product type");
      }

      // ── pictures: the same set, in the new order, the main one first ──
      const images = await trx.selectFrom("product_images").select(["id", "external_id", "position", "is_main"]).where("product_id", "=", id).orderBy("position").execute();
      let order: string[] | null = null;
      if (body.images) {
        const given = body.images.order;
        const known = new Set(images.map((i) => i.id));
        if (given.length !== images.length || new Set(given).size !== given.length || given.some((x) => !known.has(x))) {
          throw new ProblemError(422, "images_mismatch", "list every picture of the product once");
        }
        const main = body.images.main ?? given[0]!;
        if (!known.has(main)) throw new ProblemError(422, "images_mismatch", "the main picture is not one of the product's");
        order = [main, ...given.filter((x) => x !== main)];
        if (provider && images.some((i) => !i.external_id)) throw new ProblemError(422, "images_not_in_store", "a picture is not in the store yet");
      }

      // ── variants: their prices, a compare-at price above the price ──
      const variants = body.variants?.length ? await trx.selectFrom("variants").select(["id", "price_minor", "compare_at_minor", "currency"])
        .where("product_id", "=", id).where("id", "in", body.variants.map((v) => v.id)).execute() : [];
      if (variants.length !== new Set(body.variants?.map((v) => v.id) ?? []).size) throw new ProblemError(422, "unknown_variant", "a variant is not this product's");
      const prices = (body.variants ?? []).map((v) => {
        const row = variants.find((x) => x.id === v.id)!;
        const cur = row.currency.trim();
        const minor = (amount: string) => {
          try { return toMinor({ amount, currency: cur }); } catch { throw new ProblemError(422, "price_decimals", `${cur} prices take fewer decimals`); }
        };
        const price = v.price !== undefined ? minor(v.price) : BigInt(row.price_minor);
        const cap = v.compareAtPrice === undefined ? (row.compare_at_minor === null ? null : BigInt(row.compare_at_minor)) : v.compareAtPrice === null ? null : minor(v.compareAtPrice);
        if (cap !== null && cap <= price) throw new ProblemError(422, "compare_at_low", "the compare-at price must be higher than the price");
        return { id: v.id, cur, price, cap, was: { price: BigInt(row.price_minor), cap: row.compare_at_minor === null ? null : BigInt(row.compare_at_minor) } };
      });

      // ── saved here ──
      const fields: Record<string, unknown> = {};
      const html = body.description !== undefined ? textToHtml(body.description) : undefined;
      if (body.title !== undefined) fields.title = body.title;
      if (html !== undefined) fields.description_html = html;
      if (body.status !== undefined) fields.status = body.status;
      if (body.tags !== undefined) fields.tags = [...new Set(body.tags)];
      if (body.vendor !== undefined) fields.vendor = body.vendor || null;
      if (body.productType !== undefined) fields.product_type = body.productType || null;
      await trx.updateTable("products").set({ ...fields, updated_at: new Date() }).where("id", "=", id).execute();
      if (order) {
        // Two steps: one main picture per product at every moment (product_images_one_main).
        await trx.updateTable("product_images").set({ is_main: false }).where("product_id", "=", id).execute();
        for (const [position, imageId] of order.entries()) {
          await trx.updateTable("product_images").set({ position, is_main: position === 0, updated_at: new Date() }).where("id", "=", imageId).execute();
        }
      }
      for (const v of prices) {
        await trx.updateTable("variants").set({ price_minor: v.price, compare_at_minor: v.cap, updated_at: new Date() }).where("id", "=", v.id).execute();
      }

      // ── to the store ──
      if (provider) {
        const ext = prices.length ? new Map((await trx.selectFrom("external_variants").select(["variant_id", "external_id"])
          .where("connection_id", "=", p.connection_id!).where("variant_id", "in", prices.map((v) => v.id)).execute()).map((x) => [x.variant_id, x.external_id])) : new Map<string, string>();
        const extImage = new Map(images.map((i) => [i.id, i.external_id]));
        const patch: ProductPatch = {
          productExternalId: p.external_id!,
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(html !== undefined ? { descriptionHtml: html } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.tags !== undefined ? { tags: [...new Set(body.tags)] } : {}),
          ...(body.vendor !== undefined ? { vendor: body.vendor } : {}),
          ...(body.productType !== undefined ? { productType: body.productType } : {}),
          ...(order ? { mediaOrder: order.map((x) => extImage.get(x)!) } : {}),
          ...(prices.length ? {
            variants: prices.filter((v) => ext.get(v.id)).map((v) => ({
              externalId: ext.get(v.id)!, price: fromMinor(v.price, v.cur), compareAtPrice: v.cap === null ? null : fromMinor(v.cap, v.cur),
            })),
          } : {}),
        };
        const store = new SqlStore(trxQueryClient(trx), { tenantId, connections: { [provider]: p.connection_id! }, store: p.connection_id! });
        const now = Date.now();
        await store.enqueue(await MizanEngine.stageProductPatch(store, patch, now, provider), now);
      }

      const changed = [...Object.keys(body).filter((k) => body[k as keyof typeof body] !== undefined)];
      await this.audit.record(trx, {
        action: "catalog.product_updated", tenantId, ...auditActor(auth), entity: { type: "product", id },
        // Prices from and to, per variant: what the store sells at is worth a trace.
        before: {
          title: p.title, status: p.status, tags: p.tags, vendor: p.vendor, productType: p.product_type,
          ...(prices.length ? { variants: prices.map((v) => ({ id: v.id, price: fromMinor(v.was.price, v.cur).amount, compareAtPrice: v.was.cap === null ? null : fromMinor(v.was.cap, v.cur).amount })) } : {}),
        },
        after: {
          changed, ...(body.title !== undefined ? { title: body.title } : {}), ...(body.status !== undefined ? { status: body.status } : {}), store: provider,
          ...(prices.length ? { variants: prices.map((v) => ({ id: v.id, price: fromMinor(v.price, v.cur).amount, compareAtPrice: v.cap === null ? null : fromMinor(v.cap, v.cur).amount })) } : {}),
        },
      });
      await this.events.emit(trx, { type: "product.updated", tenantId, entity: { type: "product", id }, actor: { type: "user", id: auth.user.id }, data: { changed, store: provider } });
    });
    return this.detail(tenantId, id);
  }

  /** One variant's cost and/or barcode. A barcode set here is Mizan's; null gives it back to the store. */
  async updateVariant(auth: AuthContext, id: string, body: { cost?: string | undefined; barcode?: string | null | undefined }) {
    const tenantId = auth.tenant!.id;
    try {
      return await this.db.tenant(tenantId, async (trx) => {
        const v = await trx.selectFrom("variants").select(["id", "sku", "currency", "barcode", "barcode_set_at", "cogs_minor", "cogs_set_at"]).where("id", "=", id).executeTakeFirst();
        if (!v) throw new ProblemError(404, "not_found", "this variant does not exist in this store");
        const now = new Date();
        const set: { cogs_minor?: bigint; cogs_set_at?: Date; barcode?: string | null; barcode_set_at?: Date | null; updated_at: Date } = { updated_at: now };
        if (body.cost !== undefined) { set.cogs_minor = toMinor(body.cost, v.currency); set.cogs_set_at = now; }
        if (body.barcode !== undefined) {
          if (body.barcode !== null) await this.ensureFree(trx, body.barcode, id);
          set.barcode = body.barcode ?? (await this.storeBarcode(trx, id));
          set.barcode_set_at = body.barcode === null ? null : now;
        }
        await trx.updateTable("variants").set(set).where("id", "=", id).execute();
        await this.audit.record(trx, {
          action: "catalog.variant_updated", tenantId, entity: { type: "variant", id },
          before: { ...(body.cost !== undefined ? { cost: v.cogs_set_at ? fromMinor(BigInt(v.cogs_minor), v.currency).amount : null } : {}), ...(body.barcode !== undefined ? { barcode: v.barcode } : {}) },
          after: { ...(body.cost !== undefined ? { cost: body.cost } : {}), ...(body.barcode !== undefined ? { barcode: set.barcode ?? null, barcodeOwner: body.barcode === null ? "store" : "mizan" } : {}) },
          ...auditActor(auth),
        });
        if (body.cost !== undefined) await this.costsChanged(trx, auth, [id]);
        return variantView(await trx.selectFrom("variants").selectAll().where("id", "=", id).executeTakeFirstOrThrow());
      });
    } catch (e) {
      if (isBarcodeClash(e)) throw new ProblemError(409, "barcode_taken", "another variant in this store already has this barcode");
      throw e;
    }
  }

  /** A costs file: every line valid or nothing saved (each bad line named, up to 50). */
  async importCosts(auth: AuthContext, csv: string) {
    const tenantId = auth.tenant!.id;
    const { rows, skipped, problems } = parseCostCsv(csv);
    if (!rows.length) throw this.invalid(problems);
    return this.db.tenant(tenantId, async (trx) => {
      const variants = await trx.selectFrom("variants").select(["id", "sku", "currency", "barcode"]).where("sku", "in", [...new Set(rows.map((r) => r.sku))]).execute();
      const bySku = new Map(variants.map((v) => [v.sku, v]));
      // Every problem at once: the file's own, then the SKUs and barcodes the store does not allow.
      const found: CostCsvProblem[] = [...problems, ...rows.filter((r) => !bySku.has(r.sku)).map((r) => ({ line: r.line, problem: "unknown_sku" as const, value: r.sku }))];
      // A barcode is taken when a variant keeps it after this file: one not in the file, or one the file gives no new barcode.
      const newBarcode = new Map(rows.filter((r) => r.barcode).map((r) => [r.sku, r.barcode!]));
      const wanted = [...newBarcode.values()];
      const holders = wanted.length ? await trx.selectFrom("variants").select(["sku", "barcode"]).where("barcode", "in", wanted).execute() : [];
      for (const h of holders) {
        const row = rows.find((r) => r.barcode === h.barcode)!;
        if (h.sku !== row.sku && !newBarcode.has(h.sku)) found.push({ line: row.line, problem: "barcode_taken", value: h.barcode! });
      }
      if (found.length) throw this.invalid(found.sort((a, b) => a.line - b.line));

      const now = new Date();
      const costs = rows.filter((r) => r.cost !== undefined).map((r) => ({ id: bySku.get(r.sku)!.id, minor: toMinor(r.cost!, bySku.get(r.sku)!.currency) }));
      const barcodes = rows.filter((r) => r.barcode && bySku.get(r.sku)!.barcode !== r.barcode).map((r) => ({ id: bySku.get(r.sku)!.id, barcode: r.barcode! }));
      for (let i = 0; i < costs.length; i += 500) {
        const chunk = costs.slice(i, i + 500);
        await sql`UPDATE variants AS v SET cogs_minor = x.minor::bigint, cogs_set_at = ${now}, updated_at = ${now}
          FROM (VALUES ${sql.join(chunk.map((c) => sql`(${c.id}::uuid, ${c.minor.toString()})`))}) AS x(id, minor) WHERE v.id = x.id`.execute(trx);
      }
      // Barcodes move in two steps, so two variants can swap theirs in one file.
      if (barcodes.length) await trx.updateTable("variants").set({ barcode: null }).where("id", "in", barcodes.map((b) => b.id)).execute();
      for (let i = 0; i < barcodes.length; i += 500) {
        const chunk = barcodes.slice(i, i + 500);
        await sql`UPDATE variants AS v SET barcode = x.barcode, barcode_set_at = ${now}, updated_at = ${now}
          FROM (VALUES ${sql.join(chunk.map((b) => sql`(${b.id}::uuid, ${b.barcode})`))}) AS x(id, barcode) WHERE v.id = x.id`.execute(trx);
      }
      const missing = await this.missingCost(trx);
      await this.audit.record(trx, { action: "catalog.costs_imported", tenantId, after: { costs: costs.length, barcodes: barcodes.length, skipped, missingCost: missing }, ...auditActor(auth) });
      if (costs.length) await this.costsChanged(trx, auth, costs.map((c) => c.id));
      return { costs: costs.length, barcodes: barcodes.length, skipped, missingCost: missing };
    });
  }

  private invalid(problems: CostCsvProblem[]) {
    return new ProblemError(422, "csv_invalid", `${problems.length} line(s) could not be read; nothing was saved`,
      problems.slice(0, 50).map((p) => ({ path: `line:${p.line}`, code: p.problem, ...(p.value !== undefined ? { message: p.value.slice(0, 64) } : {}) })));
  }

  /** The barcode the store last sent for this variant (null when it has none, or another variant has it now). */
  private async storeBarcode(trx: Transaction<DB>, id: string): Promise<string | null> {
    const seen = await trx.selectFrom("external_variants").select("last_seen").where("variant_id", "=", id).executeTakeFirst();
    const barcode = (seen?.last_seen as { barcode?: unknown } | null)?.barcode;
    if (typeof barcode !== "string" || !barcode.trim()) return null;
    const taken = await trx.selectFrom("variants").select("id").where("barcode", "=", barcode.trim()).where("id", "!=", id).executeTakeFirst();
    return taken ? null : barcode.trim();
  }

  private async ensureFree(trx: Transaction<DB>, barcode: string, self: string) {
    const other = await trx.selectFrom("variants").select("sku").where("barcode", "=", barcode).where("id", "!=", self).executeTakeFirst();
    if (other) throw new ProblemError(409, "barcode_taken", "another variant in this store already has this barcode", [{ path: "barcode", code: "taken", message: other.sku }]);
  }

  private async missingCost(trx: Transaction<DB>) {
    return Number((await trx.selectFrom("variants as v").innerJoin("products as p", "p.id", "v.product_id")
      .where("p.status", "!=", "archived").where("v.cogs_set_at", "is", null).select(sql<string>`count(*)`.as("n")).executeTakeFirstOrThrow()).n);
  }

  /** Open orders with these products get their profit recomputed (E9-2); confirmed ones keep their locked cost. */
  private async costsChanged(trx: Transaction<DB>, auth: AuthContext, ids: string[]) {
    const tenantId = auth.tenant!.id;
    await this.productEvents.record(trx, tenantId, { name: "costs_entered", once: true, userId: auth.user.id, data: { variants: ids.length } });
    for (let i = 0; i < ids.length; i += 500) {
      await this.events.emit(trx, { type: "costs.changed", tenantId, entity: { type: "tenant", id: tenantId }, actor: { type: "user", id: auth.user.id }, data: { kind: "product_cost", variantIds: ids.slice(i, i + 500) } });
    }
  }
}

type VariantRow = {
  id: string; title: string | null; sku: string; barcode: string | null; barcode_set_at: Date | null; price_minor: string | bigint | number;
  compare_at_minor: string | bigint | number | null; currency: string; cogs_minor: string | bigint | number; cogs_set_at: Date | null; available: number | null;
  options: unknown; image_id: string | null;
};

function variantView(v: VariantRow) {
  return {
    id: v.id, title: v.title, sku: v.sku, barcode: v.barcode, barcodeOwner: v.barcode_set_at ? "mizan" as const : "store" as const,
    price: fromMinor(BigInt(v.price_minor), v.currency),
    compareAt: v.compare_at_minor === null ? null : fromMinor(BigInt(v.compare_at_minor), v.currency),
    cost: v.cogs_set_at ? fromMinor(BigInt(v.cogs_minor), v.currency) : null,
    available: v.available,
    options: (Array.isArray(v.options) ? v.options : []).filter((o): o is { name: string; value: string } =>
      Boolean(o) && typeof (o as { name?: unknown }).name === "string" && typeof (o as { value?: unknown }).value === "string"),
    imageId: v.image_id,
  };
}

/** Variants in the store's option order (Black before Sand, S before M); the rest keep their order. */
function inOptionOrder<V extends { options: Array<{ name: string; value: string }> }>(variants: V[], options: Array<{ name: string; values: string[] }>): V[] {
  if (!options.length) return variants;
  const rank = (v: V) => options.map((o) => {
    const i = o.values.indexOf(v.options.find((x) => x.name === o.name)?.value ?? "");
    return i < 0 ? o.values.length : i;
  });
  return variants.map((v, i) => ({ v, i, r: rank(v) })).sort((a, b) => {
    for (let k = 0; k < a.r.length; k++) if (a.r[k] !== b.r[k]) return a.r[k]! - b.r[k]!;
    return a.i - b.i;
  }).map((x) => x.v);
}

function imageView(i: { id: string; url: string; thumb_url?: string | null; alt: string | null; width: number | null; height: number | null; is_main: boolean }) {
  return { id: i.id, url: i.url, thumbUrl: i.thumb_url ?? null, alt: i.alt, width: i.width, height: i.height, isMain: i.is_main };
}

function optionsOf(raw: unknown): Array<{ name: string; values: string[] }> {
  return (Array.isArray(raw) ? raw : []).flatMap((o) => {
    const r = o as { name?: unknown; values?: unknown };
    return typeof r?.name === "string" && Array.isArray(r.values) ? [{ name: r.name, values: r.values.map(String) }] : [];
  });
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** A store's description HTML as plain text: block ends become new lines, tags go, entities are decoded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    // A paragraph ends with a blank line, a list item or a row with a line break: the editor reads them back the same way (P2).
    .replace(/<\s*\/\s*(p|div|h[1-6]|blockquote|ul|ol|table)\s*>/gi, "\n\n")
    .replace(/<\s*\/\s*(li|tr)\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "• ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 20_000);
}

/** Where the merchant edits this product in the store's own admin. */
function storeUrl(provider: string | null, account: string | null, externalId: string | null, config: unknown): string | null {
  if (!provider || !account || !externalId) return null;
  if (provider === "shopify") {
    const store = account.replace(/\.myshopify\.com$/, "");
    const numeric = externalId.split("/").pop();
    return numeric && /^\d+$/.test(numeric) ? `https://admin.shopify.com/store/${encodeURIComponent(store)}/products/${numeric}` : null;
  }
  if (provider === "woocommerce" && /^\d+$/.test(externalId)) {
    const site = (config as { siteUrl?: unknown } | null)?.siteUrl;
    const base = typeof site === "string" && /^https:\/\//.test(site) ? site.replace(/\/+$/, "") : `https://${account}`;
    return `${base}/wp-admin/post.php?post=${externalId}&action=edit`;
  }
  return null;
}

/** Plain text as the store's HTML (P2): paragraphs by blank lines, line breaks kept, nothing else. */
export function textToHtml(text: string): string {
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return text.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
}
