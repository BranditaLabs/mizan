import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { fromMinor, toMinor } from "@mizan/shared";
import { auditActor, AuditService } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import { ProductEventsService } from "../onboarding/product-events.service.js";
import { parseCostCsv, type CostCsvProblem } from "./cost-csv.js";

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
        .select(["p.id", "p.title", "p.status", "p.connection_id", "c.provider", "c.external_account"])
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
      const counts = await trx.selectFrom("variants as v").innerJoin("products as p", "p.id", "v.product_id").where("p.status", "!=", "archived")
        .select([
          sql<string>`count(distinct p.id)`.as("products"), sql<string>`count(*)`.as("variants"),
          sql<string>`count(*) filter (where v.cogs_set_at is null)`.as("missing_cost"), sql<string>`count(*) filter (where v.barcode is null)`.as("missing_barcode"),
        ]).executeTakeFirstOrThrow();
      const last = page.at(-1);
      return {
        data: page.map((p) => ({
          id: p.id, title: p.title, status: p.status as "active" | "draft" | "archived",
          store: p.connection_id && p.provider ? { connectionId: p.connection_id, provider: p.provider, name: p.external_account ?? p.provider } : null,
          variants: variants.filter((v) => v.product_id === p.id).map((v) => ({
            id: v.id, title: v.title, sku: v.sku, barcode: v.barcode, barcodeOwner: v.barcode_set_at ? "mizan" as const : "store" as const,
            price: fromMinor(BigInt(v.price_minor), v.currency),
            compareAt: v.compare_at_minor === null ? null : fromMinor(BigInt(v.compare_at_minor), v.currency),
            cost: v.cogs_set_at ? fromMinor(BigInt(v.cogs_minor), v.currency) : null,
            available: v.available,
          })),
        })),
        nextCursor: rows.length > q.limit && last ? encode(last.title, last.id) : null,
        counts: { products: Number(counts.products), variants: Number(counts.variants), missingCost: Number(counts.missing_cost), missingBarcode: Number(counts.missing_barcode) },
      };
    });
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
        const after = await trx.selectFrom("variants").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
        return {
          id, title: after.title, sku: after.sku, barcode: after.barcode, barcodeOwner: after.barcode_set_at ? "mizan" as const : "store" as const,
          price: fromMinor(BigInt(after.price_minor), after.currency),
          compareAt: after.compare_at_minor === null ? null : fromMinor(BigInt(after.compare_at_minor), after.currency),
          cost: after.cogs_set_at ? fromMinor(BigInt(after.cogs_minor), after.currency) : null,
          available: after.available,
        };
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
