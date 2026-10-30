import { createHash } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { DriftMonitor, parseComplianceWebhook, readShopifyHeaders, verifyShopifyHmac, type ComplianceRequest, type ComplianceTopic } from "@mizan/engine";
import { fromMinor, normalizePhone } from "@mizan/shared";
import { AuditService, auditActor } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { APP_CONFIG, type AppConfig } from "../../platform/config.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import { PiiCipher } from "../../platform/pii/pii-cipher.js";
import { phoneCountryOf } from "../../platform/pii/phone-country.js";
import { REDACTED_ORDER } from "../orders/order-projector.js";

/** Shopify asks for completion within 30 days. */
const DUE_MS = 30 * 86_400_000;

const SOURCES: Record<ComplianceTopic, "shopify_customers_data_request" | "shopify_customers_redact" | "shopify_shop_redact"> = {
  "customers/data_request": "shopify_customers_data_request",
  "customers/redact": "shopify_customers_redact",
  "shop/redact": "shopify_shop_redact",
};

/** What a request keeps: ids and a phone hash, never the email or phone Shopify sent. */
interface StoredPayload {
  shop: string;
  orderIds: string[];
  customerId?: string;
  phoneHash?: string;
  dataRequestId?: string;
}

export interface WebhookAnswer {
  status: number;
  body: Record<string, unknown>;
}

const json = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : v) as T;

/**
 * Privacy requests (docs/07 §3, E3-3). Shopify's compliance webhooks are recorded per store
 * that ever held the shop, answered at once, and processed by the `privacy.shopify` consumer:
 *
 *   customers/redact   personal data of the customer's orders from that shop is removed; totals,
 *                      statuses and counts stay. Customers known only through that shop lose
 *                      their personal data too; a customer also known from another channel keeps it.
 *   shop/redact        the same for every order and Shopify-only customer of that shop.
 *   data_request       the customer's data is compiled, encrypted, and offered to the store's
 *                      owner/admin (who answers the customer).
 *
 * Redacted orders keep `pii_redacted_at`, so a later webhook cannot bring the data back.
 */
@Injectable()
export class PrivacyService {
  private readonly log = new Logger("Privacy");
  private readonly drift = new DriftMonitor();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(Database) private readonly db: Database,
    @Inject(PiiCipher) private readonly cipher: PiiCipher,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {
    this.drift.onNew((e) => this.log.warn({ ...e }, "Shopify compliance payload drift"));
  }

  // ───────────── intake (POST /webhooks/shopify/gdpr) ─────────────

  async receiveShopify(headers: Record<string, string | undefined>, rawBody: string): Promise<WebhookAnswer> {
    const secret = this.config.SHOPIFY_API_SECRET;
    const hmac = headers["x-shopify-hmac-sha256"] ?? headers["X-Shopify-Hmac-SHA256"];
    if (!secret || !verifyShopifyHmac(rawBody, hmac, secret)) return { status: 401, body: { error: "invalid signature" } };
    const meta = readShopifyHeaders(headers);
    let request: ComplianceRequest | null;
    try {
      request = parseComplianceWebhook(meta.topic, JSON.parse(rawBody), this.drift, () => Date.now());
    } catch (err) {
      // A legal request we cannot read must be seen by a person, not dropped quietly.
      this.log.error({ topic: meta.topic, error: err instanceof Error ? err.message : String(err) }, "unreadable Shopify compliance webhook");
      return { status: 200, body: { ignored: "unreadable payload; flagged for review" } };
    }
    if (!request) return { status: 200, body: { ignored: "not a compliance topic" } };

    const dedupeKey = `shopify:${meta.eventId ?? meta.webhookId ?? createHash("sha256").update(rawBody).digest("hex")}`;
    const holders = await this.db.worker((trx) => trx.selectFrom("connections").select(["id", "tenant_id"])
      .where("provider", "=", "shopify").where("external_account", "=", request.shop).execute());
    let recorded = 0;
    for (const c of holders) {
      if (await this.record(c.tenant_id, c.id, request, dedupeKey)) recorded++;
    }
    return { status: 200, body: { accepted: true, recorded } };
  }

  private record(tenantId: string, connectionId: string, req: ComplianceRequest, dedupeKey: string): Promise<boolean> {
    return this.db.tenant(tenantId, async (trx) => {
      let phoneHash: string | undefined;
      if (req.customer?.phone) {
        const e164 = normalizePhone(req.customer.phone, await phoneCountryOf(trx, tenantId))?.e164;
        if (e164) phoneHash = (await this.cipher.forTenant(trx, tenantId)).phoneHash(e164);
      }
      const payload: StoredPayload = {
        shop: req.shop, orderIds: req.orderIds,
        ...(req.customer?.id ? { customerId: req.customer.id } : {}), ...(phoneHash ? { phoneHash } : {}),
        ...(req.dataRequestId ? { dataRequestId: req.dataRequestId } : {}),
      };
      const row = await trx.insertInto("privacy_requests").values({
        tenant_id: tenantId, connection_id: connectionId, source: SOURCES[req.topic], dedupe_key: dedupeKey,
        subject_ref: req.customer?.id ? `shopify:customer:${req.customer.id}` : null,
        payload: JSON.stringify(payload), due_at: new Date(Date.now() + DUE_MS),
      }).onConflict((oc) => oc.columns(["tenant_id", "dedupe_key"]).where("dedupe_key", "is not", null).doNothing()).returning("id").executeTakeFirst();
      if (!row) return false;
      const entity = { type: "privacy_request", id: row.id };
      await this.audit.record(trx, { action: "privacy.request_received", tenantId, entity, actor: { type: "system" }, after: { source: SOURCES[req.topic], orders: req.orderIds.length } });
      await this.events.emit(trx, { type: "privacy.requested", tenantId, entity, data: { source: SOURCES[req.topic] }, actor: null });
      return true;
    });
  }

  // ───────────── processing (consumer, in the event's tenant transaction) ─────────────

  async process(trx: Transaction<DB>, tenantId: string, requestId: string): Promise<void> {
    const req = await trx.selectFrom("privacy_requests").selectAll().where("id", "=", requestId).forUpdate().executeTakeFirst();
    if (!req || req.status === "done" || req.status === "rejected") return;
    const p = json<StoredPayload>(req.payload);
    let summary: Record<string, unknown>;
    let result: string | null = null;
    if (!req.connection_id) {
      summary = { skipped: "connection removed" };
    } else if (req.source === "shopify_customers_redact") {
      summary = await this.redact(trx, tenantId, req.connection_id, { orderIds: p.orderIds, phoneHash: p.phoneHash });
    } else if (req.source === "shopify_shop_redact") {
      summary = await this.redact(trx, tenantId, req.connection_id, { wholeShop: true });
    } else if (req.source === "shopify_customers_data_request") {
      const exported = await this.compile(trx, tenantId, req.connection_id, p);
      result = (await this.cipher.forTenant(trx, tenantId)).encrypt(JSON.stringify(exported.data), "privacy_requests.result");
      summary = { orders: exported.orders, customers: exported.customers };
    } else {
      return; // merchant- or customer-originated requests come with E9 (M9 CRM)
    }
    await trx.updateTable("privacy_requests").set({ status: "done", completed_at: new Date(), updated_at: new Date(), result })
      .where("id", "=", requestId).execute();
    const entity = { type: "privacy_request", id: requestId };
    await this.audit.record(trx, { action: "privacy.request_completed", tenantId, entity, actor: { type: "system" }, after: { source: req.source, ...summary } });
    await this.events.emit(trx, { type: "privacy.completed", tenantId, entity, data: { source: req.source }, actor: null });
  }

  /**
   * Remove personal data of the shop's orders (all, or the named ones and the customer's) and of
   * customers known only through this shop. Business facts stay. Engine records are scrubbed too.
   */
  private async redact(trx: Transaction<DB>, tenantId: string, connectionId: string,
    target: { wholeShop?: boolean; orderIds?: string[]; phoneHash?: string }): Promise<Record<string, number>> {
    let customers: string[];
    if (target.wholeShop) {
      customers = (await trx.selectFrom("orders").select("customer_id").distinct().where("connection_id", "=", connectionId)
        .where("customer_id", "is not", null).execute()).map((r) => r.customer_id!);
    } else {
      const named = target.orderIds?.length ? await trx.selectFrom("orders").select("customer_id")
        .where("connection_id", "=", connectionId).where("external_id", "in", target.orderIds).execute() : [];
      const byPhone = target.phoneHash ? await trx.selectFrom("customers").select("id as customer_id").where("phone_hash", "=", target.phoneHash).execute() : [];
      customers = [...new Set([...named, ...byPhone].map((r) => r.customer_id).filter((x): x is string => Boolean(x)))];
    }
    // Orders: the whole shop, or the named orders plus every order of the matched customers from this shop.
    let orders = trx.updateTable("orders").set({ ...REDACTED_ORDER, pii_redacted_at: sql`coalesce(pii_redacted_at, now())` }).where("connection_id", "=", connectionId);
    if (!target.wholeShop) {
      orders = orders.where((eb) => eb.or([
        ...(target.orderIds?.length ? [eb("external_id", "in", target.orderIds)] : []),
        ...(customers.length ? [eb("customer_id", "in", customers)] : []),
        eb.val(false),
      ]));
    }
    const redactedOrders = await orders.returning(["id", "external_id"]).execute();
    // An ad click id points at one visit by one person (M7-2): it goes with the rest.
    if (redactedOrders.length) {
      await trx.updateTable("order_sources").set({ click_id: null, click_id_kind: null }).where("order_id", "in", redactedOrders.map((o) => o.id)).execute();
    }

    // Customers known only through this shop. One also known from another channel keeps its data:
    // that channel's controller (the store) has its own basis for it.
    const onlyHere = customers.length ? (await trx.selectFrom("customers as c").select("c.id").where("c.id", "in", customers)
      .where(({ not, exists, selectFrom }) => not(exists(selectFrom("orders as o").select("o.id")
        .whereRef("o.customer_id", "=", "c.id").where("o.connection_id", "!=", connectionId))))
      .execute()).map((r) => r.id) : [];
    if (onlyHere.length) {
      await trx.updateTable("customers").set({ name: null, phone_e164: null, email: null, phone_hash: null, whatsapp_opt_in: false, opt_in_source: null, opt_in_at: null, redacted_at: sql`coalesce(redacted_at, now())` })
        .where("id", "in", onlyHere).execute();
    }

    // The engine keeps canonical orders for diffs: keep the business facts, drop the person.
    const keys = redactedOrders.map((o) => o.external_id).filter((k): k is string => Boolean(k));
    if (keys.length) {
      await sql`UPDATE mz_records SET value = jsonb_set(
          jsonb_set(value, '{order,customer}', '{"name": ""}'::jsonb),
          '{order,shippingAddress}',
          CASE WHEN jsonb_typeof(value->'order'->'shippingAddress') = 'object'
               THEN ((value->'order'->'shippingAddress') - 'name' - 'phone' - 'line2' - 'zip') || '{"line1": ""}'::jsonb
               ELSE 'null'::jsonb END)
        WHERE type = 'order' AND key = ANY(${keys}::text[])`.execute(trx);
    }
    return { orders: redactedOrders.length, customers: onlyHere.length, customersKept: customers.length - onlyHere.length };
  }

  /** The customer's data held from this shop, decrypted, for the store to hand over. */
  private async compile(trx: Transaction<DB>, tenantId: string, connectionId: string, p: StoredPayload) {
    const pii = await this.cipher.forTenant(trx, tenantId);
    const byPhone = p.phoneHash ? await trx.selectFrom("customers").select("id").where("phone_hash", "=", p.phoneHash).execute() : [];
    const customerIds = byPhone.map((c) => c.id);
    const rows = await trx.selectFrom("orders").selectAll().where("connection_id", "=", connectionId)
      .where((eb) => eb.or([
        ...(p.orderIds.length ? [eb("external_id", "in", p.orderIds)] : []),
        ...(customerIds.length ? [eb("customer_id", "in", customerIds)] : []),
        eb.val(false),
      ])).orderBy("placed_at").execute();
    const allCustomerIds = [...new Set([...customerIds, ...rows.map((o) => o.customer_id).filter((x): x is string => Boolean(x))])];
    const customers = allCustomerIds.length ? await trx.selectFrom("customers").selectAll().where("id", "in", allCustomerIds).execute() : [];
    const lines = rows.length ? await trx.selectFrom("order_lines").select(["order_id", "title", "sku", "quantity", "unit_price_minor"])
      .where("order_id", "in", rows.map((o) => o.id)).execute() : [];
    const data = {
      shop: p.shop, shopifyCustomerId: p.customerId ?? null, shopifyDataRequestId: p.dataRequestId ?? null, compiledAt: new Date().toISOString(),
      customers: customers.map((c) => ({
        name: pii.decrypt(c.name, "customers.name"), phone: pii.decrypt(c.phone_e164, "customers.phone_e164"), email: pii.decrypt(c.email, "customers.email"),
        whatsappOptIn: c.whatsapp_opt_in, whatsappOptInSource: c.opt_in_source, whatsappOptOutAt: c.whatsapp_opt_out_at?.toISOString() ?? null, firstSeen: c.created_at.toISOString(),
      })),
      orders: rows.map((o) => ({
        number: o.number, externalId: o.external_id, placedAt: o.placed_at.toISOString(), status: o.status,
        total: fromMinor(o.total_minor, o.currency), paymentMode: o.payment_mode, paymentStatus: o.payment_status,
        shipping: {
          name: pii.decrypt(o.ship_name, "orders.ship_name"), phone: pii.decrypt(o.ship_phone, "orders.ship_phone"),
          line1: pii.decrypt(o.ship_line1, "orders.ship_line1"), line2: pii.decrypt(o.ship_line2, "orders.ship_line2"),
          city: o.ship_city, province: o.ship_province, country: o.ship_country,
        },
        lines: lines.filter((l) => l.order_id === o.id).map((l) => ({ title: l.title, sku: l.sku, quantity: l.quantity, unitPrice: fromMinor(l.unit_price_minor, o.currency) })),
      })),
    };
    return { data, orders: rows.length, customers: customers.length };
  }

  // ───────────── store team (GET /v1/privacy-requests) ─────────────

  list(auth: AuthContext) {
    return this.db.tenant(auth.tenant!.id, async (trx) => {
      const rows = await trx.selectFrom("privacy_requests").select(["id", "source", "status", "due_at", "completed_at", "created_at", "result"])
        .orderBy("created_at", "desc").limit(200).execute();
      return {
        data: rows.map((r) => ({
          id: r.id, source: r.source, status: r.status, dueAt: r.due_at.toISOString(),
          completedAt: r.completed_at?.toISOString() ?? null, createdAt: r.created_at.toISOString(), hasExport: r.result !== null,
        })),
      };
    });
  }

  /** The compiled data for a customers/data_request; every download is audited. */
  export(auth: AuthContext, id: string) {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const row = await trx.selectFrom("privacy_requests").select(["id", "source", "status", "result"]).where("id", "=", id).executeTakeFirst();
      if (!row) throw new ProblemError(404, "not_found", "no such privacy request");
      if (!row.result) throw new ProblemError(409, "conflict", "this request has no export (not a data request, or not compiled yet)");
      const data = JSON.parse((await this.cipher.forTenant(trx, tenantId)).decrypt(row.result, "privacy_requests.result")!) as unknown;
      await this.audit.record(trx, { action: "privacy.export_downloaded", tenantId, entity: { type: "privacy_request", id }, ...auditActor(auth) });
      return data;
    });
  }
}
