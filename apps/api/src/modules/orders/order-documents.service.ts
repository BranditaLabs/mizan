import { Inject, Injectable } from "@nestjs/common";
import { fromMinor } from "@mizan/shared";
import type { z } from "zod";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { AuditService, auditActor } from "../../platform/audit/audit.service.js";
import { Database } from "../../platform/db/database.js";
import { ProblemError } from "../../platform/http/problem.js";
import { TokenBuckets } from "../../platform/http/rate-limit.js";
import { PiiCipher } from "../../platform/pii/pii-cipher.js";
import { variantPictures } from "../catalog/pictures.js";
import type { OrderDocumentsSchema } from "./orders.dto.js";
import { roleScope } from "./orders.service.js";

type Documents = z.infer<typeof OrderDocumentsSchema>;

/**
 * O4: what an invoice or a packing slip prints, for one order or many (the page lays them out,
 * in Arabic or English, and the browser saves them as PDF). They carry the delivery contact, so
 * they are personal data: decrypted for this request only, never cached, and every order's view
 * goes into the audit log like "Show details" (customer.pii_viewed, via the document). A redacted
 * order prints without the person.
 */
@Injectable()
export class OrderDocumentsService {
  /** Document requests per person per minute (each up to 100 orders): a day's printing, not an export of the store. */
  private readonly requests = new TokenBuckets(10);

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(PiiCipher) private readonly cipher: PiiCipher,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async documents(auth: AuthContext, orderIds: string[], kind: "invoice" | "packing_slip"): Promise<Documents> {
    const tenantId = auth.tenant!.id;
    const limit = this.requests.take(`${tenantId}:${auth.user.id}`);
    if (!limit.allowed) throw new ProblemError(429, "rate_limited", `too many documents; retry in ${Math.max(1, limit.resetS)} s`);
    return this.db.tenant(tenantId, async (trx) => {
      const store = await trx.selectFrom("tenants").select(["name", "country"]).where("id", "=", tenantId).executeTakeFirstOrThrow();
      const rows = await trx.selectFrom("orders as o")
        .select(["o.id", "o.number", "o.placed_at", "o.status", "o.currency", "o.payment_mode", "o.payment_status", "o.subtotal_minor", "o.shipping_minor", "o.total_minor",
          "o.paid_minor", "o.refunded_minor", "o.cod_minor", "o.ship_name", "o.ship_phone", "o.ship_line1", "o.ship_line2", "o.ship_city", "o.ship_province", "o.ship_country", "o.pii_redacted_at"])
        .where("o.id", "in", orderIds).where((eb) => roleScope(eb, auth)).execute();
      // All or nothing: a document set never silently leaves an order out.
      if (rows.length !== new Set(orderIds).size) throw new ProblemError(404, "not_found", "an order is not in this store or not yours to print");
      const lines = await trx.selectFrom("order_lines as l").leftJoin("variants as v", "v.id", "l.variant_id")
        .select(["l.order_id", "l.title", "l.sku", "l.quantity", "l.unit_price_minor", "l.variant_id", "v.barcode"])
        .where("l.order_id", "in", orderIds).orderBy("l.position").orderBy("l.id").execute();
      const pictures = kind === "packing_slip" ? await variantPictures(trx, lines.map((l) => l.variant_id)) : new Map();
      const pii = await this.cipher.forTenant(trx, tenantId);
      const byId = new Map(rows.map((r) => [r.id, r]));

      const orders = orderIds.filter((id, i) => orderIds.indexOf(id) === i).map((id) => {
        const o = byId.get(id)!;
        const cur = o.currency.trim();
        const money = (minor: string | number | bigint) => fromMinor(BigInt(minor), cur);
        const person = o.pii_redacted_at ? null : {
          name: pii.decrypt(o.ship_name, "orders.ship_name"), phone: pii.decrypt(o.ship_phone, "orders.ship_phone"),
          address: { line1: pii.decrypt(o.ship_line1, "orders.ship_line1"), line2: pii.decrypt(o.ship_line2, "orders.ship_line2"), city: o.ship_city, province: o.ship_province, country: o.ship_country },
        };
        const own = lines.filter((l) => l.order_id === id);
        return {
          id, number: o.number, placedAt: o.placed_at.toISOString(), status: o.status as Documents["orders"][number]["status"],
          paymentMode: o.payment_mode as Documents["orders"][number]["paymentMode"], paymentStatus: o.payment_status as Documents["orders"][number]["paymentStatus"],
          customer: person,
          lines: own.map((l) => ({
            title: l.title, sku: l.sku, barcode: l.barcode ?? null, quantity: l.quantity, unitPrice: money(l.unit_price_minor), total: money(BigInt(l.unit_price_minor) * BigInt(l.quantity)),
            picture: (l.variant_id && pictures.get(l.variant_id)) || null,
          })),
          pieces: own.reduce((n, l) => n + l.quantity, 0),
          subtotal: money(o.subtotal_minor), shipping: money(o.shipping_minor),
          discount: money(BigInt(o.subtotal_minor) + BigInt(o.shipping_minor) - BigInt(o.total_minor)),
          total: money(o.total_minor), paid: money(o.paid_minor), refunded: money(o.refunded_minor),
          // What the courier collects: the order's own figure, kept by cashToCollect when it was projected (rule 13).
          cod: money(o.cod_minor),
        };
      });
      for (const o of orders) {
        if (!o.customer) continue;
        const fields = [o.customer.name && "name", o.customer.phone && "phone", (o.customer.address.line1 || o.customer.address.line2) && "address"].filter((f): f is string => Boolean(f));
        await this.audit.record(trx, { action: "customer.pii_viewed", tenantId, ...auditActor(auth), entity: { type: "order", id: o.id }, after: { fields, via: kind } });
      }
      return { kind, store: { name: store.name, country: store.country.trim() }, generatedAt: new Date().toISOString(), orders };
    });
  }
}
