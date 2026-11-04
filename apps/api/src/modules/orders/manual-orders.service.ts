import { variantPictures } from "../catalog/pictures.js";
import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { fromMinor, normalizePhone } from "@mizan/shared";
import type { z } from "zod";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { AuditService, auditActor } from "../../platform/audit/audit.service.js";
import { Database } from "../../platform/db/database.js";
import { ProblemError } from "../../platform/http/problem.js";
import { phoneCountryOf } from "../../platform/pii/phone-country.js";
import { PiiCipher } from "../../platform/pii/pii-cipher.js";
import { buildManualOrder, type CatalogueVariant } from "./manual-order.js";
import { OrderProjector } from "./order-projector.js";
import type { CustomerHistory, NewOrderSchema } from "./orders.dto.js";

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
    @Inject(PiiCipher) private readonly cipher: PiiCipher,
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
      // The map pin the customer shared: for the driver (the canonical address has no place for it).
      if (body.address.location) await trx.updateTable("orders").set({ ship_lat: body.address.location.lat, ship_lng: body.address.location.lng }).where("id", "=", r.orderId).execute();
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
      const pictures = await variantPictures(trx, rows.map((v) => v.id));
      return { data: rows.map((v) => ({
        variantId: v.id, sku: v.sku, title: v.title ? `${v.product} — ${v.title}` : v.product, price: fromMinor(BigInt(v.price_minor), v.currency.trim()), available: v.available,
        picture: pictures.get(v.id) ?? null,
      })) };
    });
  }

  /**
   * Before an order is typed (mistakes avoided): what Mizan knows of this phone. Its orders by
   * outcome (a customer who refused before), the ones not shipped yet (a second order may be a
   * duplicate), and the last address to use again. Showing the address is audited like a reveal.
   */
  async customerHistory(auth: AuthContext, phoneText: string): Promise<CustomerHistory> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const phone = normalizePhone(phoneText, await phoneCountryOf(trx, tenantId))?.e164;
      if (!phone) throw new ProblemError(422, "validation_failed", "not a valid mobile number", [{ path: "phone", code: "invalid_phone" }]);
      const pii = await this.cipher.forTenant(trx, tenantId);
      const empty: CustomerHistory = { phone, known: false, name: null, orders: { total: 0, delivered: 0, returned: 0, cancelled: 0, open: 0 }, openOrders: [], lastAddress: null };
      const c = await trx.selectFrom("customers").select(["id", "name"]).where("phone_hash", "=", pii.phoneHash(phone)).executeTakeFirst();
      if (!c) return empty;
      const rows = await trx.selectFrom("orders").select(["id", "number", "status", "placed_at", "ship_line1", "ship_line2", "ship_city", "ship_province", "ship_lat", "ship_lng", "pii_redacted_at"])
        .where("customer_id", "=", c.id).orderBy("placed_at", "desc").limit(200).execute();
      if (!rows.length) return { ...empty, known: true, name: pii.decrypt(c.name, "customers.name") ?? null };
      const count = (...s: string[]) => rows.filter((r) => s.includes(r.status)).length;
      const open = rows.filter((r) => ["new", "pending_confirmation", "confirmed"].includes(r.status));
      const last = rows.find((r) => !r.pii_redacted_at) ?? null;
      const lastAddress = last ? {
        line1: pii.decrypt(last.ship_line1, "orders.ship_line1") ?? null, line2: pii.decrypt(last.ship_line2, "orders.ship_line2") ?? null,
        city: last.ship_city, province: last.ship_province,
        location: last.ship_lat !== null && last.ship_lng !== null ? { lat: last.ship_lat, lng: last.ship_lng } : null,
      } : null;
      if (last) await this.audit.record(trx, { action: "customer.pii_viewed", tenantId, ...auditActor(auth), entity: { type: "order", id: last.id }, after: { fields: ["address"], via: "order_entry" } });
      return {
        phone, known: true, name: pii.decrypt(c.name, "customers.name") ?? null,
        orders: { total: rows.length, delivered: count("delivered"), returned: count("returned"), cancelled: count("cancelled"), open: open.length },
        openOrders: open.slice(0, 5).map((r) => ({ id: r.id, number: r.number, placedAt: r.placed_at.toISOString() })),
        lastAddress,
      };
    });
  }
}
