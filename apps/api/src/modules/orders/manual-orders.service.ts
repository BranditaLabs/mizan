import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { fromMinor, normalizePhone } from "@mizan/shared";
import type { z } from "zod";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { AuditService, auditActor } from "../../platform/audit/audit.service.js";
import { Database } from "../../platform/db/database.js";
import { ProblemError } from "../../platform/http/problem.js";
import { phoneCountryOf } from "../../platform/pii/phone-country.js";
import { buildManualOrder, type CatalogueVariant } from "./manual-order.js";
import { OrderProjector } from "./order-projector.js";
import type { NewOrderSchema } from "./orders.dto.js";

const ERRORS = {
  unknown_product: "a product is not in the catalogue (or archived)",
  currency_mismatch: "products in different currencies cannot share an order",
  total_invalid: "the total must be above zero (discount larger than the order)",
  paid_invalid: "the amount paid does not fit the payment: a deposit must be between zero and the total; prepaid and a received transfer pay the total; cash on delivery takes no deposit",
} as const;

/**
 * Manual orders (M1, E5-5): numbered M-1001, M-1002… per store, projected like a store's order
 * (channel manual, no connection) in the same transaction, so everything downstream reacts to
 * order.created as usual. An agent's order is assigned to them. Audited.
 */
@Injectable()
export class ManualOrdersService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(OrderProjector) private readonly projector: OrderProjector,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async create(auth: AuthContext, body: z.output<typeof NewOrderSchema>, now = new Date()) {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      // Numbers are per store and never reused: the tenant row is the lock.
      const t = await trx.selectFrom("tenants").select(["country", "base_currency"]).where("id", "=", tenantId).forUpdate().executeTakeFirstOrThrow();
      if (!normalizePhone(body.customer.phone, await phoneCountryOf(trx, tenantId))) throw new ProblemError(422, "phone_invalid", "the phone number is not valid for this store's country");
      const ids = [...new Set(body.lines.flatMap((l) => (l.variantId ? [l.variantId] : [])))];
      const rows = ids.length ? await trx.selectFrom("variants as v").innerJoin("products as p", "p.id", "v.product_id")
        .select(["v.id", "v.sku", "v.title", "p.title as product", "v.price_minor", "v.currency"]).where("v.id", "in", ids).where("p.status", "=", "active").execute() : [];
      const variants = new Map<string, CatalogueVariant>(rows.map((v) => [v.id, {
        id: v.id, sku: v.sku, title: v.title ? `${v.product} — ${v.title}` : v.product, priceMinor: BigInt(v.price_minor), currency: v.currency.trim(),
      }]));
      const count = await trx.selectFrom("orders").select((eb) => eb.fn.countAll<string>().as("n")).where("channel", "=", "manual").executeTakeFirstOrThrow();
      const built = buildManualOrder(body, {
        variants, baseCurrency: t.base_currency.trim(), country: t.country.trim(), number: `M-${1001 + Number(count.n)}`, externalId: `manual:${randomUUID()}`, now,
      });
      if ("error" in built) throw new ProblemError(422, built.error, ERRORS[built.error]);
      const r = await this.projector.projectIn(trx, tenantId, null, built.order, { channel: "manual", actor: { type: "user", id: auth.user.id }, variantIds: built.variantIds });
      if (auth.tenant!.role === "agent") await trx.updateTable("orders").set({ assigned_to: auth.user.id }).where("id", "=", r.orderId).execute();
      const o = await trx.selectFrom("orders").select(["number", "status", "total_minor", "currency"]).where("id", "=", r.orderId).executeTakeFirstOrThrow();
      await this.audit.record(trx, {
        action: "order.created_manually", tenantId, ...auditActor(auth), entity: { type: "order", id: r.orderId },
        after: { number: o.number, source: body.source, paymentMode: body.payment.mode, total: fromMinor(BigInt(o.total_minor), o.currency.trim()).amount, lines: body.lines.length },
      });
      return { id: r.orderId, number: o.number, status: o.status as "new" };
    });
  }

  /** Active products to pick, by title or SKU (100 at most). */
  async products(tenantId: string, q: string | undefined) {
    return this.db.tenant(tenantId, async (trx) => {
      let query = trx.selectFrom("variants as v").innerJoin("products as p", "p.id", "v.product_id")
        .select(["v.id", "v.sku", "v.title", "p.title as product", "v.price_minor", "v.currency", "v.available"]).where("p.status", "=", "active").orderBy("p.title").orderBy("v.sku").limit(100);
      if (q) {
        const like = q.replace(/[%_\\]/g, "\\$&");
        query = query.where((eb) => eb.or([eb("p.title", "ilike", `%${like}%`), eb("v.sku", "ilike", `${like}%`)]));
      }
      const rows = await query.execute();
      return { data: rows.map((v) => ({ variantId: v.id, sku: v.sku, title: v.title ? `${v.product} — ${v.title}` : v.product, price: fromMinor(BigInt(v.price_minor), v.currency.trim()), available: v.available })) };
    });
  }
}
