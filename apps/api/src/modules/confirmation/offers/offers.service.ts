import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { fromMinor, type Money } from "@mizan/shared";
import { auditActor, AuditService } from "../../../platform/audit/audit.service.js";
import type { AuthContext } from "../../../platform/auth/auth.types.js";
import { Database } from "../../../platform/db/database.js";
import { EventsService } from "../../../platform/events/events.service.js";
import { ProblemError } from "../../../platform/http/problem.js";
import { offerSettings, OfferSettingsSchema, type OfferSettings } from "./offer.settings.js";
import { recommend, type Candidate, type Rule } from "./recommend.js";

export type OfferDecision = "accept" | "decline";
export type OfferChannel = "whatsapp" | "call_team" | "agent";
export interface OfferRow {
  id: string; order_id: string; run_id: string; variant_id: string; qty: number; currency: string; unit_price_minor: string; discount_pct: string;
  offer_price_minor: string; source: string; message_ar: string | null; message_en: string | null; status: string; title: string;
}

/** Orders from this long ago tell what is bought together; popularity is the last 90 days. */
const TOGETHER_DAYS = 180;
const POPULAR_DAYS = 90;
/** An offer can be taken until the order ships, and at most this long after it was made. */
export const OFFER_TTL_MS = 48 * 3_600_000;
const OPEN_ORDER = ["new", "pending_confirmation", "confirmed"];

/**
 * Upsell and cross-sell at confirmation (M2, E6-11). One offer per confirmation run, chosen when
 * the run starts (owner rules, else bought-together, `recommend.ts`) and shown in the WhatsApp
 * chat right after the customer confirms and in the team's call script. Accepting records it and
 * emits offer.accepted; adding it to the store's order is E6-13.
 */
@Injectable()
export class OffersService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async settings(trx: Transaction<DB>, tenantId: string): Promise<OfferSettings> {
    const t = await trx.selectFrom("tenants").select("settings").where("id", "=", tenantId).executeTakeFirstOrThrow();
    return offerSettings(t.settings);
  }

  /** Chooses and records the run's offer (null when off or nothing fits). In the run's transaction. */
  async propose(trx: Transaction<DB>, tenantId: string, run: { id: string; order_id: string }, now = new Date()): Promise<OfferRow | null> {
    const s = await this.settings(trx, tenantId);
    if (!s.enabled) return null;
    const order = await trx.selectFrom("orders").select(["number", "currency", "total_minor"]).where("id", "=", run.order_id).executeTakeFirstOrThrow();
    const currency = order.currency.trim();
    const lines = await trx.selectFrom("order_lines").select("variant_id").where("order_id", "=", run.order_id).where("variant_id", "is not", null).execute();
    const orderVariantIds = [...new Set(lines.map((l) => l.variant_id!))];

    const rules: Rule[] = (await trx.selectFrom("offer_rules").select(["id", "trigger_variant_id", "offer_variant_id", "discount_pct", "priority", "message_ar", "message_en"])
      .where("active", "=", true).execute()).map((r) => ({
      id: r.id, triggerVariantId: r.trigger_variant_id, offerVariantId: r.offer_variant_id, discountPct: String(r.discount_pct), priority: r.priority, messageAr: r.message_ar, messageEn: r.message_en,
    }));
    const boughtWith = new Map<string, number>();
    if (orderVariantIds.length && s.mode !== "rules") {
      const rows = await trx.selectFrom("order_lines as a").innerJoin("order_lines as b", (j) => j.onRef("b.order_id", "=", "a.order_id"))
        .innerJoin("orders as o", "o.id", "a.order_id")
        .select(["b.variant_id", sql<string>`count(distinct a.order_id)`.as("n")])
        .where("a.variant_id", "in", orderVariantIds).where("b.variant_id", "is not", null).where("a.order_id", "!=", run.order_id)
        .where("o.placed_at", ">", new Date(now.getTime() - TOGETHER_DAYS * 86_400_000)).where("o.status", "!=", "cancelled")
        .groupBy("b.variant_id").orderBy(sql`count(distinct a.order_id)`, "desc").limit(50).execute();
      for (const r of rows) if (r.variant_id) boughtWith.set(r.variant_id, Number(r.n));
    }
    const popularity = new Map<string, number>();
    if (s.mode !== "rules") {
      const rows = await trx.selectFrom("order_lines as l").innerJoin("orders as o", "o.id", "l.order_id")
        .select(["l.variant_id", sql<string>`count(distinct l.order_id)`.as("n")])
        .where("l.variant_id", "is not", null).where("o.placed_at", ">", new Date(now.getTime() - POPULAR_DAYS * 86_400_000)).where("o.status", "!=", "cancelled")
        .groupBy("l.variant_id").orderBy(sql`count(distinct l.order_id)`, "desc").limit(50).execute();
      for (const r of rows) if (r.variant_id) popularity.set(r.variant_id, Number(r.n));
    }

    const ids = [...new Set([...rules.map((r) => r.offerVariantId), ...boughtWith.keys(), ...popularity.keys()])];
    const candidates = new Map<string, Candidate>();
    if (ids.length) {
      const rows = await trx.selectFrom("variants as v").innerJoin("products as p", "p.id", "v.product_id")
        .select(["v.id", "v.title", "p.title as product", "v.price_minor", "v.currency", "v.cogs_minor", "v.cogs_set_at", "v.available", "p.status"])
        .where("v.id", "in", ids).execute();
      for (const v of rows) {
        if (v.currency.trim() !== currency) continue; // never mix currencies
        candidates.set(v.id, {
          variantId: v.id, title: v.title ? `${v.product} — ${v.title}` : v.product, priceMinor: BigInt(v.price_minor),
          costMinor: v.cogs_set_at ? BigInt(String(v.cogs_minor)) : null, available: v.available, active: v.status === "active",
        });
      }
    }
    const offer = recommend({
      mode: s.mode, maxDiscountPct: s.maxDiscountPct, autoDiscountPct: s.autoDiscountPct, currency, orderTotalMinor: BigInt(order.total_minor),
      orderVariantIds, rules, candidates, boughtWith, popularity,
    });
    if (!offer) return null;
    const row = await trx.insertInto("order_offers").values({
      tenant_id: tenantId, order_id: run.order_id, run_id: run.id, rule_id: offer.ruleId, variant_id: offer.variantId, qty: offer.qty, currency,
      unit_price_minor: offer.unitPriceMinor.toString(), discount_pct: offer.discountPct, offer_price_minor: offer.offerPriceMinor.toString(),
      source: offer.source, message_ar: offer.messageAr, message_en: offer.messageEn, created_at: now, updated_at: now,
    }).onConflict((oc) => oc.column("run_id").doNothing()).returning("id").executeTakeFirst();
    if (!row) return this.forRun(trx, run.id);
    await this.events.emit(trx, {
      type: "offer.proposed", tenantId, entity: { type: "order", id: run.order_id }, actor: { type: "system" },
      data: { number: order.number, offerId: row.id, variantId: offer.variantId, source: offer.source, discountPct: offer.discountPct, offerPriceMinor: offer.offerPriceMinor.toString(), currency },
    });
    return this.forRun(trx, run.id);
  }

  async forRun(trx: Transaction<DB>, runId: string): Promise<OfferRow | null> {
    return (await this.base(trx).where("f.run_id", "=", runId).executeTakeFirst() as OfferRow | undefined) ?? null;
  }

  async latestForOrder(trx: Transaction<DB>, orderId: string): Promise<OfferRow | null> {
    return (await this.base(trx).where("f.order_id", "=", orderId).orderBy("f.created_at", "desc").executeTakeFirst() as OfferRow | undefined) ?? null;
  }

  private base(trx: Transaction<DB>) {
    return trx.selectFrom("order_offers as f").innerJoin("variants as v", "v.id", "f.variant_id").innerJoin("products as p", "p.id", "v.product_id")
      .select(["f.id", "f.order_id", "f.run_id", "f.variant_id", "f.qty", "f.currency", "f.unit_price_minor", "f.discount_pct", "f.offer_price_minor", "f.source", "f.message_ar", "f.message_en", "f.status", "f.created_at"])
      .select(sql<string>`CASE WHEN v.title IS NULL THEN p.title ELSE p.title || ' — ' || v.title END`.as("title"));
  }

  /**
   * The customer's (or the team's) answer. Only a proposed offer changes; one past its time, or on
   * an order that shipped or was cancelled, expires instead. Returns the offer's status after.
   */
  async decide(trx: Transaction<DB>, tenantId: string, offerId: string, decision: OfferDecision, by: { channel: OfferChannel; userId?: string }, now = new Date()): Promise<{ status: string; changed: boolean }> {
    const f = await trx.selectFrom("order_offers").select(["id", "order_id", "status", "variant_id", "qty", "offer_price_minor", "currency", "created_at"]).where("id", "=", offerId).forUpdate().executeTakeFirst();
    if (!f) throw new ProblemError(404, "not_found", "no such offer");
    if (f.status !== "proposed") return { status: f.status, changed: false };
    const order = await trx.selectFrom("orders").select(["status", "number", "shipped_at"]).where("id", "=", f.order_id).executeTakeFirstOrThrow();
    const late = !OPEN_ORDER.includes(order.status) || Boolean(order.shipped_at) || now.getTime() - f.created_at.getTime() > OFFER_TTL_MS;
    const status = late ? "expired" : decision === "accept" ? "accepted" : "declined";
    await trx.updateTable("order_offers").set({ status, channel: by.channel, decided_at: now, decided_by: by.userId ?? null, updated_at: now }).where("id", "=", f.id).execute();
    await trx.insertInto("order_events").values({
      tenant_id: tenantId, order_id: f.order_id, type: `offer_${status}`, actor_type: by.userId ? "user" : "customer", actor_id: by.userId ?? null, data: JSON.stringify({ channel: by.channel }),
    }).execute();
    await this.events.emit(trx, {
      type: `offer.${status}` as "offer.accepted", tenantId, entity: { type: "order", id: f.order_id }, actor: by.userId ? { type: "user", id: by.userId } : { type: "system" },
      data: { number: order.number, offerId: f.id, variantId: f.variant_id, qty: f.qty, offerPriceMinor: String(f.offer_price_minor), currency: f.currency.trim(), channel: by.channel },
    });
    return { status, changed: true };
  }

  /** The team records the customer's answer to the offer on the call. */
  async decideByTeam(auth: AuthContext, orderId: string, decision: OfferDecision, now = new Date()) {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const f = await this.latestForOrder(trx, orderId);
      if (!f) throw new ProblemError(404, "not_found", "this order has no offer");
      const r = await this.decide(trx, tenantId, f.id, decision, { channel: "call_team", userId: auth.user.id }, now);
      if (r.changed) await this.audit.record(trx, { action: "offer.decided", tenantId, ...auditActor(auth), entity: { type: "order", id: orderId }, after: { offerId: f.id, status: r.status } });
      return { status: r.status as "accepted" };
    });
  }

  /** What an offer looks like on screens and in messages. */
  view(f: OfferRow) {
    const m = (v: string | number | bigint): Money => fromMinor(BigInt(v), f.currency.trim());
    return {
      id: f.id, title: f.title, qty: f.qty, unitPrice: m(f.unit_price_minor), offerPrice: m(f.offer_price_minor), discountPct: String(Number(f.discount_pct)),
      source: f.source as "rule", status: f.status as "proposed", messageAr: f.message_ar, messageEn: f.message_en,
    };
  }

  // ───────────── settings, rules, summary ─────────────

  async getSettings(tenantId: string) {
    return this.db.tenant(tenantId, (trx) => this.settings(trx, tenantId));
  }

  async putSettings(auth: AuthContext, body: OfferSettings) {
    const tenantId = auth.tenant!.id;
    const next = OfferSettingsSchema.parse(body);
    return this.db.tenant(tenantId, async (trx) => {
      const t = await trx.selectFrom("tenants").select("settings").where("id", "=", tenantId).forUpdate().executeTakeFirstOrThrow();
      const before = offerSettings(t.settings);
      await trx.updateTable("tenants").set({ settings: JSON.stringify({ ...(t.settings as object), offers: next }) }).where("id", "=", tenantId).execute();
      await this.audit.record(trx, { action: "offers.settings_updated", tenantId, ...auditActor(auth), entity: { type: "tenant", id: tenantId }, before, after: next });
      return next;
    });
  }

  async rules(tenantId: string) {
    return this.db.tenant(tenantId, async (trx) => {
      const rows = await trx.selectFrom("offer_rules as r")
        .innerJoin("variants as ov", "ov.id", "r.offer_variant_id").innerJoin("products as op", "op.id", "ov.product_id")
        .leftJoin("variants as tv", "tv.id", "r.trigger_variant_id").leftJoin("products as tp", "tp.id", "tv.product_id")
        .select(["r.id", "r.trigger_variant_id", "r.offer_variant_id", "r.discount_pct", "r.priority", "r.message_ar", "r.message_en", "r.active", "r.created_at",
          "op.title as offer_product", "ov.title as offer_variant", "ov.price_minor", "ov.currency", "tp.title as trigger_product", "tv.title as trigger_variant"])
        .orderBy("r.active", "desc").orderBy("r.priority", "desc").orderBy("r.created_at").execute();
      const title = (p: string | null, v: string | null) => (p ? (v ? `${p} — ${v}` : p) : null);
      return {
        data: rows.map((r) => ({
          id: r.id, trigger: r.trigger_variant_id ? { variantId: r.trigger_variant_id, title: title(r.trigger_product, r.trigger_variant)! } : null,
          offer: { variantId: r.offer_variant_id, title: title(r.offer_product, r.offer_variant)!, price: fromMinor(BigInt(r.price_minor), r.currency.trim()) },
          discountPct: String(Number(r.discount_pct)), priority: r.priority, messageAr: r.message_ar, messageEn: r.message_en, active: r.active, createdAt: r.created_at.toISOString(),
        })),
      };
    });
  }

  async addRule(auth: AuthContext, body: { triggerVariantId: string | null; offerVariantId: string; discountPct: string; priority: number; messageAr?: string | undefined; messageEn?: string | undefined }) {
    const tenantId = auth.tenant!.id;
    if (body.triggerVariantId === body.offerVariantId) throw new ProblemError(422, "same_product", "offer a different product than the one that triggers it");
    return this.db.tenant(tenantId, async (trx) => {
      const ids = [body.offerVariantId, ...(body.triggerVariantId ? [body.triggerVariantId] : [])];
      const found = await trx.selectFrom("variants").select("id").where("id", "in", ids).execute();
      if (found.length !== ids.length) throw new ProblemError(404, "not_found", "no such product in this store");
      const row = await trx.insertInto("offer_rules").values({
        tenant_id: tenantId, trigger_variant_id: body.triggerVariantId, offer_variant_id: body.offerVariantId, discount_pct: body.discountPct, priority: body.priority,
        message_ar: body.messageAr ?? null, message_en: body.messageEn ?? null, created_by: auth.user.id,
      }).returning("id").executeTakeFirstOrThrow();
      await this.audit.record(trx, { action: "offer_rule.changed", tenantId, ...auditActor(auth), entity: { type: "offer_rule", id: row.id }, after: { ...body, active: true } });
      return { id: row.id };
    });
  }

  async setRuleActive(auth: AuthContext, id: string, active: boolean) {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const r = await trx.updateTable("offer_rules").set({ active, updated_at: new Date() }).where("id", "=", id).returning("id").executeTakeFirst();
      if (!r) throw new ProblemError(404, "not_found", "no such rule");
      await this.audit.record(trx, { action: "offer_rule.changed", tenantId, ...auditActor(auth), entity: { type: "offer_rule", id }, after: { active } });
    });
  }

  /** Products to pick in a rule: active, by title or SKU. */
  async searchProducts(tenantId: string, q: string | undefined) {
    return this.db.tenant(tenantId, async (trx) => {
      let query = trx.selectFrom("variants as v").innerJoin("products as p", "p.id", "v.product_id")
        .select(["v.id", "v.sku", "v.title", "p.title as product", "v.price_minor", "v.currency", "v.available"]).where("p.status", "=", "active").orderBy("p.title").orderBy("v.sku").limit(100);
      if (q) query = query.where((eb) => eb.or([eb("p.title", "ilike", `%${q.replace(/[%_\\]/g, "\\$&")}%`), eb("v.sku", "ilike", `${q.replace(/[%_\\]/g, "\\$&")}%`)]));
      const rows = await query.execute();
      return { data: rows.map((v) => ({ variantId: v.id, sku: v.sku, title: v.title ? `${v.product} — ${v.title}` : v.product, price: fromMinor(BigInt(v.price_minor), v.currency.trim()), available: v.available })) };
    });
  }

  /** Offers in the last `days`: made, taken, and what they added (in each currency). */
  async summary(tenantId: string, days: number, now = new Date()) {
    return this.db.tenant(tenantId, async (trx) => {
      const since = new Date(now.getTime() - days * 86_400_000);
      const rows = await trx.selectFrom("order_offers").select(["status", "currency", sql<string>`count(*)`.as("n"), sql<string>`coalesce(sum(offer_price_minor * qty), 0)`.as("value")])
        .where("created_at", ">=", since).groupBy(["status", "currency"]).execute();
      const count = (s: string[]) => rows.filter((r) => s.includes(r.status)).reduce((a, r) => a + Number(r.n), 0);
      const added = new Map<string, bigint>();
      for (const r of rows) if (["accepted", "applying", "applied"].includes(r.status)) added.set(r.currency.trim(), (added.get(r.currency.trim()) ?? 0n) + BigInt(r.value));
      return {
        days, offered: count(["proposed", "accepted", "declined", "expired", "applying", "applied", "failed"]), accepted: count(["accepted", "applying", "applied"]), declined: count(["declined"]),
        added: [...added.entries()].map(([c, v]) => fromMinor(v, c)),
      };
    });
  }
}
