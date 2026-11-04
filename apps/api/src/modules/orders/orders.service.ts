import { variantPictures } from "../catalog/pictures.js";
import { Inject, Injectable } from "@nestjs/common";
import { sql, type ExpressionBuilder, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { fromMinor, normalizePhone } from "@mizan/shared";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { AuditService, auditActor } from "../../platform/audit/audit.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import { TokenBuckets } from "../../platform/http/rate-limit.js";
import { PiiCipher } from "../../platform/pii/pii-cipher.js";
import { phoneCountryOf } from "../../platform/pii/phone-country.js";
import { ORDER_STATUSES, type ListOrdersQuery, type OrderDetail, type OrderSummary, type RevealedCustomer } from "./orders.dto.js";

type Eb = ExpressionBuilder<DB & { o: DB["orders"] }, "o">;

/** Cursor = "<placed_at ISO>|<id>" (newest first, ties by id). */
const encode = (at: Date, id: string) => Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
function decode(cursor: string) {
  const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const d = new Date(at ?? "");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id) || Number.isNaN(d.getTime())) throw new ProblemError(422, "validation_failed", "cursor is not valid", [{ path: "cursor", code: "invalid" }]);
  return { at: d, id };
}
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const iso = (d: Date | null) => d?.toISOString() ?? null;
const notFound = () => new ProblemError(404, "not_found", "no such order in this store");

/** Timeline data keeps business facts only, whatever a writer put in the row. */
function eventData(raw: unknown): OrderDetail["events"][number]["data"] {
  const d = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const text = (k: string) => (typeof d[k] === "string" ? { [k]: d[k] as string } : {});
  const tags = Array.isArray(d.tags) ? { tags: d.tags.filter((x): x is string => typeof x === "string") } : {};
  const changed = Array.isArray(d.changed) ? { changed: d.changed.filter((x): x is string => typeof x === "string") } : {};
  return { ...text("source"), ...text("channel"), ...text("reason"), ...text("from"), ...text("to"), ...text("of"), ...text("into"), ...text("status"), ...text("name"), ...changed, ...tags };
}
/** Risk reasons as codes (E6-1 writes them; strings or { code }). */
const reasonCodes = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.flatMap((r) => (typeof r === "string" ? [r] : r && typeof r === "object" && typeof (r as { code?: unknown }).code === "string" ? [(r as { code: string }).code] : [])) : [];

/**
 * M1 order list (E5-1). Role scope: agents see orders assigned to them, warehouse sees confirmed
 * and shipped orders; owner, admin, ops manager and finance see all. Search never decrypts:
 * order numbers by prefix, store ids exactly, phones by their keyed hash. The row's customer label
 * ("Mona A.") is the only personal data decrypted for a list.
 */
@Injectable()
export class OrdersService {
  /** Reveals per person per minute: enough for a confirmation shift, not for scraping a store. */
  private readonly reveals = new TokenBuckets(30);

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(PiiCipher) private readonly cipher: PiiCipher,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext, q: ListOrdersQuery) {
    const tenantId = auth.tenant!.id;
    const after = q.cursor ? decode(q.cursor) : null;
    return this.db.tenant(tenantId, async (trx) => {
      const scope = await this.scope(trx, auth, q);
      let rows = trx.selectFrom("orders as o").leftJoin("connections as c", "c.id", "o.connection_id")
        .select(["o.id", "o.number", "o.status", "o.channel", "o.connection_id", "c.provider", "o.customer_label", "o.phone_last4", "o.total_minor", "o.cod_minor",
          "o.currency", "o.payment_mode", "o.payment_status", "o.risk_score", "o.tags", "o.placed_at", "o.duplicate_status", "o.stock_status", "o.ship_city"])
        .where(scope).orderBy("o.placed_at", "desc").orderBy("o.id", "desc").limit(q.limit + 1);
      if (q.status) rows = rows.where("o.status", "=", q.status);
      // Waiting for the team's call now: escalated confirmation whose retry time has come (E6-10).
      const needsCall = (eb: ExpressionBuilder<DB & { o: DB["orders"] }, "o">) => eb("o.id", "in", eb.selectFrom("confirmation_runs as r").select("r.order_id")
        .where("r.status", "=", "needs_agent").where((x) => x.or([x("r.call_after", "is", null), x("r.call_after", "<=", sql<Date>`now()`)])));
      if (q.confirmation === "needs_call") rows = rows.where((eb) => needsCall(eb as never));
      if (q.duplicate) rows = rows.where("o.duplicate_status", "=", q.duplicate);
      if (q.stock) rows = rows.where("o.stock_status", "=", q.stock);
      if (q.shipping === "ready") rows = rows.where((eb) => readyToShip(eb as never));
      if (after) rows = rows.where((eb) => eb.or([eb("o.placed_at", "<", after.at), eb.and([eb("o.placed_at", "=", after.at), eb("o.id", "<", after.id)])]));
      const found = await rows.execute();
      const counts = await trx.selectFrom("orders as o").where(scope).select(["o.status", sql<string>`count(*)`.as("n")]).groupBy("o.status").execute();
      const calls = await trx.selectFrom("orders as o").where(scope).where((eb) => needsCall(eb as never)).select(sql<string>`count(*)`.as("n")).executeTakeFirstOrThrow();
      const dupes = await trx.selectFrom("orders as o").where(scope).where("o.duplicate_status", "=", "suspected").select(sql<string>`count(*)`.as("n")).executeTakeFirstOrThrow();
      const ready = await trx.selectFrom("orders as o").where(scope).where((eb) => readyToShip(eb as never)).select(sql<string>`count(*)`.as("n")).executeTakeFirstOrThrow();
      const waiting = await trx.selectFrom("orders as o").where(scope).where("o.stock_status", "=", "short").select(sql<string>`count(*)`.as("n")).executeTakeFirstOrThrow();

      const page = found.slice(0, q.limit);
      const pii = page.some((r) => r.customer_label) ? await this.cipher.forTenant(trx, tenantId) : null;
      // What each order holds, at a glance: pieces, lines and the first items' pictures (O1).
      const lines = page.length ? await trx.selectFrom("order_lines").select(["order_id", "variant_id", "quantity"]).where("order_id", "in", page.map((r) => r.id)).orderBy("position").orderBy("id").execute() : [];
      const pictures = await variantPictures(trx, lines.map((l) => l.variant_id));
      // The courier of each order's latest delivery, and how many notes the team left (O2).
      const ids = page.map((r) => r.id);
      const couriers = ids.length ? await trx.selectFrom("shipments as s").innerJoin("connections as k", "k.id", "s.connection_id")
        .select(["s.order_id", "k.id", "k.provider", "k.display_name"]).distinctOn("s.order_id")
        .where("s.order_id", "in", ids).where("s.is_return_leg", "=", false).orderBy("s.order_id").orderBy("s.created_at", "desc").execute() : [];
      const courierOf = new Map(couriers.map((c) => [c.order_id, { id: c.id, provider: c.provider, name: c.display_name }]));
      const noteCounts = ids.length ? await trx.selectFrom("order_notes").select(["order_id", sql<string>`count(*)`.as("n")])
        .where("order_id", "in", ids).groupBy("order_id").execute() : [];
      const notesOf = new Map(noteCounts.map((n) => [n.order_id, Number(n.n)]));
      const items = (orderId: string) => {
        const own = lines.filter((l) => l.order_id === orderId);
        const seen = new Set<string>();
        const shown = own.flatMap((l) => {
          const pic = l.variant_id ? pictures.get(l.variant_id) : undefined;
          if (!pic || seen.has(pic.url)) return [];
          seen.add(pic.url);
          return [pic];
        }).slice(0, 3);
        return { count: own.reduce((n, l) => n + l.quantity, 0), lines: own.length, pictures: shown };
      };
      const byStatus = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<(typeof ORDER_STATUSES)[number], number>;
      for (const c of counts) byStatus[c.status as keyof typeof byStatus] = Number(c.n);
      const last = page.at(-1);
      return {
        // status, channel and payment columns are TEXT with CHECK constraints (migrations 0001, 0002).
        data: page.map((r): OrderSummary => ({
          id: r.id, number: r.number, status: r.status as OrderSummary["status"], channel: r.channel,
          store: { connectionId: r.connection_id, provider: r.provider },
          customer: { label: pii?.decrypt(r.customer_label, "orders.customer_label") ?? null, phoneLast4: r.phone_last4 },
          total: fromMinor(BigInt(r.total_minor), r.currency), cod: fromMinor(BigInt(r.cod_minor), r.currency),
          paymentMode: r.payment_mode as OrderSummary["paymentMode"], paymentStatus: r.payment_status as OrderSummary["paymentStatus"],
          risk: r.risk_score, tags: r.tags, placedAt: r.placed_at.toISOString(), duplicate: r.duplicate_status as OrderSummary["duplicate"],
          stock: r.stock_status as OrderSummary["stock"],
          items: items(r.id),
          city: r.ship_city, courier: courierOf.get(r.id) ?? null, notes: notesOf.get(r.id) ?? 0,
        })),
        nextCursor: found.length > q.limit && last ? encode(last.placed_at, last.id) : null,
        counts: { all: Object.values(byStatus).reduce((a, b) => a + b, 0), ...byStatus },
        needsCall: Number(calls.n),
        duplicates: Number(dupes.n),
        waitingStock: Number(waiting.n),
        readyToShip: Number(ready.n),
      };
    });
  }

  /** One order (E5-2): masked like the list; out of the caller's scope reads as not found. */
  async detail(auth: AuthContext, id: string): Promise<OrderDetail> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const o = await trx.selectFrom("orders as o").leftJoin("connections as c", "c.id", "o.connection_id").selectAll("o").select("c.provider")
        .where("o.id", "=", id).where((eb) => roleScope(eb, auth)).executeTakeFirst();
      if (!o) throw notFound();
      const [lines, payments, shipments, events, source] = await Promise.all([
        trx.selectFrom("order_lines as l").leftJoin("variants as v", "v.id", "l.variant_id")
          .select(["l.id", "l.sku", "l.title", "l.quantity", "l.unit_price_minor", "l.variant_id", "v.product_id"]).where("l.order_id", "=", id).orderBy("l.position").orderBy("l.id").execute(),
        trx.selectFrom("payments").select(["id", "kind", "method", "status", "amount_minor", "currency", "occurred_at"]).where("order_id", "=", id).orderBy("occurred_at", "desc").execute(),
        trx.selectFrom("shipments").select(["id", "provider", "tracking_number", "status", "status_at", "cod_minor", "currency", "booking", "error_code", "tracking_url"]).where("order_id", "=", id).orderBy("created_at", "desc").execute(),
        trx.selectFrom("order_events").select(["id", "type", "from_status", "to_status", "actor_type", "data", "created_at"]).where("order_id", "=", id)
          .orderBy("created_at", "desc").orderBy("id", "desc").limit(200).execute(),
        trx.selectFrom("order_sources").selectAll().where("order_id", "=", id).executeTakeFirst(),
      ]);
      const pii = o.customer_label ? await this.cipher.forTenant(trx, tenantId) : null;
      const pictures = await variantPictures(trx, lines.map((l) => l.variant_id));
      // O2: the latest delivery's courier and the team's notes count, as on the list.
      const courier = await trx.selectFrom("shipments as s").innerJoin("connections as k", "k.id", "s.connection_id").select(["k.id", "k.provider", "k.display_name"])
        .where("s.order_id", "=", id).where("s.is_return_leg", "=", false).orderBy("s.created_at", "desc").limit(1).executeTakeFirst();
      const lastEdit = await trx.selectFrom("order_edits").select(["id", "status", "failure", "failure_message", "created_at", "settled_at"])
        .where("order_id", "=", id).orderBy("created_at", "desc").limit(1).executeTakeFirst();
      const { n: noteCount } = await trx.selectFrom("order_notes").select(sql<string>`count(*)`.as("n")).where("order_id", "=", id).executeTakeFirstOrThrow();
      const twin = o.duplicate_of ? await trx.selectFrom("orders").select(["id", "number", "status"]).where("id", "=", o.duplicate_of).executeTakeFirst() : undefined;
      const why = (o.duplicate_reason ?? {}) as { items?: string[]; minutesApart?: number };
      const money = (minor: string | number | bigint, currency = o.currency) => fromMinor(BigInt(minor), currency);
      return {
        id: o.id, number: o.number, externalId: o.external_id, status: o.status as OrderDetail["status"], channel: o.channel,
        storeCopy: o.store_copy_status ? { status: o.store_copy_status as "pending" | "created" | "failed", name: o.store_copy_name, error: o.store_copy_error } : null,
        store: { connectionId: o.connection_id, provider: o.provider },
        customer: { label: pii?.decrypt(o.customer_label, "orders.customer_label") ?? null, phoneLast4: o.phone_last4 },
        currency: o.currency,
        total: money(o.total_minor), cod: money(o.cod_minor), subtotal: money(o.subtotal_minor), shipping: money(o.shipping_minor), discount: money(o.discount_minor),
        paid: money(o.paid_minor), refunded: money(o.refunded_minor), balance: money(String(o.balance_minor ?? 0)),
        paymentMode: o.payment_mode as OrderDetail["paymentMode"], paymentStatus: o.payment_status as OrderDetail["paymentStatus"],
        risk: o.risk_score, riskReasons: reasonCodes(o.risk_reasons), tags: o.tags, assignedTo: o.assigned_to,
        duplicate: o.duplicate_status as OrderDetail["duplicate"],
        stock: o.stock_status as OrderDetail["stock"],
        duplicateOf: twin ? { id: twin.id, number: twin.number, status: twin.status as OrderDetail["status"], items: why.items ?? [], minutesApart: why.minutesApart ?? 0 } : null,
        area: { city: o.ship_city, province: o.ship_province, country: o.ship_country },
        edit: lastEdit ? {
          id: lastEdit.id, status: lastEdit.status as "sending" | "applied" | "failed", failure: lastEdit.failure as "validation" | null,
          message: lastEdit.failure_message, at: (lastEdit.settled_at ?? lastEdit.created_at).toISOString(),
        } : null,
        city: o.ship_city, courier: courier ? { id: courier.id, provider: courier.provider, name: courier.display_name } : null, notes: Number(noteCount),
        hasLocation: o.ship_lat !== null && o.ship_lng !== null,
        redacted: o.pii_redacted_at !== null,
        source: source ? {
          platform: source.platform as NonNullable<OrderDetail["source"]>["platform"], paid: source.paid, rule: source.rule as NonNullable<OrderDetail["source"]>["rule"],
          utm: { source: source.utm_source, medium: source.utm_medium, campaign: source.utm_campaign, content: source.utm_content, term: source.utm_term },
          clickIdKind: source.click_id_kind, referrerDomain: source.referrer_domain, landingPath: source.landing_path,
          firstPlatform: source.first_platform as NonNullable<OrderDetail["source"]>["firstPlatform"], firstSeenAt: iso(source.first_seen_at), discountCodes: source.discount_codes,
        } : null,
        placedAt: o.placed_at.toISOString(),
        timestamps: { placedAt: o.placed_at.toISOString(), confirmedAt: iso(o.confirmed_at), shippedAt: iso(o.shipped_at), deliveredAt: iso(o.delivered_at), cancelledAt: iso(o.cancelled_at) },
        lines: lines.map((l) => ({
          id: l.id, sku: l.sku, title: l.title, quantity: l.quantity, unitPrice: money(l.unit_price_minor), total: money(BigInt(l.unit_price_minor) * BigInt(l.quantity)), variantId: l.variant_id,
          productId: l.product_id, picture: (l.variant_id && pictures.get(l.variant_id)) || null,
        })),
        items: {
          count: lines.reduce((n, l) => n + l.quantity, 0), lines: lines.length,
          pictures: [...new Map(lines.flatMap((l) => { const pic = l.variant_id ? pictures.get(l.variant_id) : undefined; return pic ? [[pic.url, pic] as const] : []; })).values()].slice(0, 3),
        },
        payments: payments.map((p) => ({ id: p.id, kind: p.kind, method: p.method, status: p.status, amount: money(p.amount_minor, p.currency), occurredAt: p.occurred_at.toISOString() })),
        partialDelivery: o.partial_items && o.partial_due_minor !== null && o.partial_at
          ? { due: money(o.partial_due_minor), items: o.partial_items as Array<{ lineId: string; quantity: number }>, at: o.partial_at.toISOString() } : null,
        refusal: o.refusal_reason && o.refused_at ? { reason: o.refusal_reason, openBox: o.refusal_open_box ?? false, at: o.refused_at.toISOString() } : null,
        shipments: shipments.map((x) => ({ id: x.id, provider: x.provider, trackingNumber: x.tracking_number, status: x.status, statusAt: iso(x.status_at), cod: money(x.cod_minor, x.currency),
          booking: x.booking as OrderDetail["shipments"][number]["booking"], errorCode: x.error_code, trackingUrl: x.tracking_url })),
        events: events.map((e) => ({
          id: e.id, type: e.type, fromStatus: e.from_status, toStatus: e.to_status, actorType: e.actor_type as OrderDetail["events"][number]["actorType"],
          at: e.created_at.toISOString(), data: eventData(e.data),
        })),
      };
    });
  }

  /**
   * The delivery contact in full (E5-2), decrypted for this caller only and recorded as
   * `customer.pii_viewed` (field names, never values) in the same transaction.
   */
  async reveal(auth: AuthContext, id: string): Promise<RevealedCustomer> {
    const tenantId = auth.tenant!.id;
    const limit = this.reveals.take(`${tenantId}:${auth.user.id}`);
    if (!limit.allowed) throw new ProblemError(429, "rate_limited", `too many customer views; retry in ${Math.max(1, limit.resetS)} s`);
    return this.db.tenant(tenantId, async (trx) => {
      const o = await trx.selectFrom("orders as o")
        .select(["o.id", "o.ship_name", "o.ship_phone", "o.ship_line1", "o.ship_line2", "o.ship_city", "o.ship_province", "o.ship_country", "o.ship_lat", "o.ship_lng", "o.pii_redacted_at"])
        .where("o.id", "=", id).where((eb) => roleScope(eb, auth)).executeTakeFirst();
      if (!o) throw notFound();
      if (o.pii_redacted_at) throw new ProblemError(410, "pii_redacted", "this customer's details were deleted on request");
      const pii = await this.cipher.forTenant(trx, tenantId);
      const shown: RevealedCustomer = {
        name: pii.decrypt(o.ship_name, "orders.ship_name"),
        phone: pii.decrypt(o.ship_phone, "orders.ship_phone"),
        address: { line1: pii.decrypt(o.ship_line1, "orders.ship_line1"), line2: pii.decrypt(o.ship_line2, "orders.ship_line2"), city: o.ship_city, province: o.ship_province, country: o.ship_country },
        location: o.ship_lat !== null && o.ship_lng !== null ? { lat: o.ship_lat, lng: o.ship_lng } : null,
      };
      const fields = [shown.name && "name", shown.phone && "phone", (shown.address.line1 || shown.address.line2) && "address", shown.location && "location"].filter((f): f is string => Boolean(f));
      await this.audit.record(trx, { action: "customer.pii_viewed", tenantId, ...auditActor(auth), entity: { type: "order", id }, after: { fields } });
      return shown;
    });
  }

  /** Everything but the status filter (the tabs count across statuses). */
  private async scope(trx: Transaction<DB>, auth: AuthContext, q: ListOrdersQuery) {
    let phoneHash: string | null = null;
    if (q.q) {
      const phone = normalizePhone(q.q, await phoneCountryOf(trx, auth.tenant!.id));
      if (phone) phoneHash = (await this.cipher.forTenant(trx, auth.tenant!.id)).phoneHash(phone.e164);
    }
    return (eb: Eb) => {
      const and = [roleScope(eb, auth)];
      if (q.paymentMode) and.push(eb("o.payment_mode", "=", q.paymentMode));
      if (q.connectionId) and.push(eb("o.connection_id", "=", q.connectionId));
      if (q.from) and.push(eb("o.placed_at", ">=", new Date(q.from)));
      if (q.to) and.push(eb("o.placed_at", "<", new Date(q.to)));
      if (q.tag) and.push(eb(sql`o.tags`, "@>", sql`ARRAY[${q.tag}]::text[]`));
      if (q.city) and.push(eb(sql`lower(btrim(o.ship_city))`, "=", q.city.toLowerCase()));
      if (q.courierId) {
        and.push(eb.exists(eb.selectFrom("shipments as s").select("s.id").whereRef("s.order_id", "=", "o.id")
          .where("s.connection_id", "=", q.courierId).where("s.is_return_leg", "=", false)));
      }
      if (q.productId) {
        and.push(eb.exists(eb.selectFrom("order_lines as l").innerJoin("variants as v", "v.id", "l.variant_id").select("l.id")
          .whereRef("l.order_id", "=", "o.id").where("v.product_id", "=", q.productId)));
      }
      if (q.q) {
        const n = likeEscape(q.q.replace(/^#/, "").toLowerCase());
        const any = [
          eb(sql`lower(o.number)`, "like", `${n}%`), eb(sql`lower(o.number)`, "like", `#${n}%`), eb("o.external_id", "=", q.q),
        ];
        if (phoneHash) any.push(eb("o.customer_id", "in", eb.selectFrom("customers").select("id").where("phone_hash", "=", phoneHash)));
        and.push(eb.or(any));
      }
      return eb.and(and);
    };
  }
}

/** What a role may see: agents their assigned orders, warehouse confirmed and shipped; others all. */
export function roleScope(eb: Eb, auth: AuthContext) {
  const role = auth.tenant!.role;
  if (role === "agent") return eb("o.assigned_to", "=", auth.user.id);
  if (role === "warehouse") return eb("o.status", "in", ["confirmed", "shipped"]);
  return eb.and([]);
}

/** Ready for the courier (E7-2): confirmed, no live shipment, not waiting for stock or a duplicate decision. */
function readyToShip(eb: ExpressionBuilder<DB & { o: DB["orders"] }, "o">) {
  return eb.and([
    eb("o.status", "=", "confirmed"),
    eb.or([eb("o.stock_status", "is", null), eb("o.stock_status", "!=", "short")]),
    eb.or([eb("o.duplicate_status", "is", null), eb("o.duplicate_status", "!=", "suspected")]),
    eb.not(eb.exists(eb.selectFrom("shipments as s").select("s.id").whereRef("s.order_id", "=", "o.id").where("s.is_return_leg", "=", false)
      .where("s.booking", "!=", "failed").where("s.status", "!=", "cancelled"))),
  ]);
}
