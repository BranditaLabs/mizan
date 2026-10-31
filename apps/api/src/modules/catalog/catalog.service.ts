import { Inject, Injectable } from "@nestjs/common";
import { sql } from "kysely";
import { fromMinor, toMinor } from "@mizan/shared";
import { auditActor, AuditService } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { ProblemError } from "../../platform/http/problem.js";
import { ProductEventsService } from "../onboarding/product-events.service.js";
import { EventsService } from "../../platform/events/events.service.js";
import type { SetCostsBody, VariantCost } from "./catalog.dto.js";

/** Cursor = "<created_at ISO>|<id>": stable order even when costs change between pages. */
const encode = (at: Date, id: string) => Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
function decode(cursor: string): { at: Date; id: string } {
  const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const d = new Date(at ?? "");
  if (!id || Number.isNaN(d.getTime())) throw new ProblemError(400, "validation_failed", "cursor is not valid", [{ path: "cursor", code: "invalid" }]);
  return { at: d, id };
}

/** Product costs (COGS) for the profit engine (E4-5 onboarding; full catalogue screens are E8-1). */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ProductEventsService) private readonly productEvents: ProductEventsService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  async costs(tenantId: string, q: { missingCost: boolean; limit: number; cursor?: string | undefined }) {
    const after = q.cursor ? decode(q.cursor) : null;
    return this.db.tenant(tenantId, async (trx) => {
      let query = trx.selectFrom("variants as v").innerJoin("products as p", "p.id", "v.product_id")
        .select(["v.id", "v.sku", "v.title", "v.price_minor", "v.cogs_minor", "v.cogs_set_at", "v.currency", "v.created_at", "p.title as product_title"])
        .where("p.status", "!=", "archived")
        .orderBy("v.created_at").orderBy("v.id").limit(q.limit + 1);
      if (q.missingCost) query = query.where("v.cogs_set_at", "is", null);
      if (after) query = query.where((eb) => eb.or([eb("v.created_at", ">", after.at), eb.and([eb("v.created_at", "=", after.at), eb("v.id", ">", after.id)])]));
      const rows = await query.execute();
      const page = rows.slice(0, q.limit);
      const counts = await trx.selectFrom("variants as v").innerJoin("products as p", "p.id", "v.product_id").where("p.status", "!=", "archived")
        .select([sql<string>`count(*)`.as("variants"), sql<string>`count(*) filter (where v.cogs_set_at is null)`.as("missing")]).executeTakeFirstOrThrow();
      const data: VariantCost[] = page.map((r) => ({
        variantId: r.id, productTitle: r.product_title, variantTitle: r.title, sku: r.sku,
        price: fromMinor(BigInt(r.price_minor), r.currency),
        cost: r.cogs_set_at ? fromMinor(BigInt(r.cogs_minor), r.currency) : null,
      }));
      const last = page.at(-1);
      return {
        data, nextCursor: rows.length > q.limit && last ? encode(last.created_at, last.id) : null,
        counts: { variants: Number(counts.variants), missingCost: Number(counts.missing) },
      };
    });
  }

  /** Set costs in the variant's currency (decimal strings, never floats). Repeating it is harmless. */
  async setCosts(auth: AuthContext, body: SetCostsBody) {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const ids = [...new Set(body.items.map((i) => i.variantId))];
      const variants = await trx.selectFrom("variants").select(["id", "currency"]).where("id", "in", ids).execute();
      const currency = new Map(variants.map((v) => [v.id, v.currency]));
      const unknown = ids.filter((id) => !currency.has(id));
      if (unknown.length) throw new ProblemError(404, "not_found", "some variants do not exist in this store", unknown.map((id) => ({ path: "items.variantId", code: "not_found", message: id })));
      const now = new Date();
      for (const item of body.items) {
        await trx.updateTable("variants").set({ cogs_minor: toMinor(item.cost, currency.get(item.variantId)!), cogs_set_at: now, updated_at: now })
          .where("id", "=", item.variantId).execute();
      }
      const missing = Number((await trx.selectFrom("variants as v").innerJoin("products as p", "p.id", "v.product_id")
        .where("p.status", "!=", "archived").where("v.cogs_set_at", "is", null).select(sql<string>`count(*)`.as("n")).executeTakeFirstOrThrow()).n);
      await this.audit.record(trx, { action: "catalog.costs_updated", tenantId, after: { variants: ids.length, missingCost: missing }, ...auditActor(auth) });
      await this.productEvents.record(trx, tenantId, { name: "costs_entered", once: true, userId: auth.user.id, data: { variants: ids.length } });
      // Open orders with these products get their profit recomputed (E9-2); confirmed ones keep their locked cost.
      await this.events.emit(trx, { type: "costs.changed", tenantId, entity: { type: "tenant", id: tenantId }, actor: { type: "user", id: auth.user.id }, data: { kind: "product_cost", variantIds: ids.slice(0, 500) } });
      return { updated: ids.length, missingCost: missing };
    });
  }
}
