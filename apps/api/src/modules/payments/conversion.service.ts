import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { fromMinor, toMinor, type EventActor } from "@mizan/shared";
import { auditActor, AuditService } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import {
  CONVERSION_METHODS, conversionSettings, ConversionSettingsSchema,
  type Conversion, type ConversionMethod, type ConversionSettings, type NewConversion, type OrderConversion,
} from "./conversion.dto.js";

type Trx = Transaction<DB>;
const OPEN_STATUSES = new Set(["new", "pending_confirmation", "confirmed"]);
const LIVE_SHIPMENT = ["delivered", "returned", "cancelled", "lost"];
const isolate = (s: string) => `⁦${s}⁩`;
const METHOD_LABEL: Record<ConversionMethod, { ar: string; en: string }> = {
  instapay: { ar: "إنستاباي", en: "InstaPay" },
  wallet: { ar: "المحفظة", en: "mobile wallet" },
  bank_transfer: { ar: "تحويل بنكي", en: "bank transfer" },
  link: { ar: "اللينك ده", en: "this link" },
};

/**
 * COD to prepaid conversion (M15, E14-3; docs/12 §5.1). The team (or an automation) offers the
 * customer of a COD order to pay all of it, or a deposit, before shipping — by InstaPay, a wallet,
 * a bank transfer or the store's own payment page — and sends the message Mizan writes. When the
 * ledger has received that amount since the offer (the team records it; a gateway will, E14-2),
 * the offer is paid: the courier's cash has already dropped with the ledger, and a shipment booked
 * with the old amount goes to review so the courier is told. One open offer per order.
 */
@Injectable()
export class ConversionService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  async get(tenantId: string, orderId: string, now = new Date()): Promise<OrderConversion> {
    // The payment.received consumer closes a paid offer; reading catches up first so the screen
    // never shows an offer as waiting right after the team recorded the money.
    return this.db.tenant(tenantId, async (trx) => {
      await this.onPayment(trx, tenantId, orderId, now);
      return this.view(trx, tenantId, orderId, now);
    });
  }

  async offer(auth: AuthContext, orderId: string, body: NewConversion, now = new Date()): Promise<OrderConversion> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const c = await this.create(trx, tenantId, orderId, body, { type: "user", id: auth.user.id }, "manual", now);
      await this.audit.record(trx, { action: "payment.conversion_offered", tenantId, entity: { type: "order", id: orderId }, after: { conversionId: c.id, purpose: body.purpose, method: body.method, amountMinor: c.amountMinor }, ...auditActor(auth) });
      return this.view(trx, tenantId, orderId, now);
    });
  }

  async cancel(auth: AuthContext, orderId: string): Promise<OrderConversion> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const gone = await trx.updateTable("payment_links").set({ status: "cancelled" })
        .where("order_id", "=", orderId).where("purpose", "=", "convert_cod").where("status", "=", "open").returning("id").executeTakeFirst();
      if (!gone) throw new ProblemError(409, "no_open_offer", "this order has no open offer");
      await this.audit.record(trx, { action: "payment.conversion_cancelled", tenantId, entity: { type: "order", id: orderId }, after: { conversionId: gone.id }, ...auditActor(auth) });
      return this.view(trx, tenantId, orderId);
    });
  }

  /** Make an offer inside the caller's transaction (the web, or the automation action). */
  async create(trx: Trx, tenantId: string, orderId: string, body: NewConversion & { depositPct?: number }, actor: EventActor, source: "manual" | "automation", now = new Date()) {
    const o = await trx.selectFrom("orders").select(["id", "number", "status", "currency", "payment_mode", "paid_minor", "cod_minor"]).where("id", "=", orderId).forUpdate().executeTakeFirst();
    if (!o) throw new ProblemError(404, "not_found", "order not found");
    const s = await this.settings(trx, tenantId);
    const why = this.ineligible(o);
    if (why) throw new ProblemError(409, why, REASONS[why]);
    // An offer past its time no longer blocks a new one.
    await trx.updateTable("payment_links").set({ status: "expired" })
      .where("order_id", "=", orderId).where("purpose", "=", "convert_cod").where("status", "=", "open").where("expires_at", "<", now).execute();
    const open = await trx.selectFrom("payment_links").select("id").where("order_id", "=", orderId).where("purpose", "=", "convert_cod").where("status", "=", "open").executeTakeFirst();
    if (open) throw new ProblemError(409, "offer_open", "this order already has an open offer: cancel it first");
    const instructions = body.instructions ?? s.methods[body.method];
    if (!instructions) throw new ProblemError(422, "no_instructions", `say where to pay by ${body.method}, or set it in Settings → Payments`, [{ path: "instructions", code: "required" }]);
    const owed = BigInt(o.cod_minor);
    let amount = owed;
    if (body.purpose === "deposit") {
      if (body.amount) {
        try { amount = toMinor(body.amount, o.currency); } catch { throw new ProblemError(422, "validation_failed", `too many decimals for ${o.currency}`, [{ path: "amount", code: "invalid" }]); }
      } else {
        amount = this.deposit(owed, body.depositPct ?? s.depositPct, o.currency);
      }
      if (amount <= 0n || amount >= owed) throw new ProblemError(422, "validation_failed", "a deposit is more than zero and less than what is owed", [{ path: "amount", code: "out_of_range" }]);
    }
    const expiresAt = new Date(now.getTime() + s.expiresHours * 3_600_000);
    const row = await trx.insertInto("payment_links").values({
      tenant_id: tenantId, order_id: orderId, purpose: "convert_cod", kind: body.purpose, amount_minor: amount, currency: o.currency, method: body.method,
      instructions, paid_before_minor: BigInt(o.paid_minor), expires_at: expiresAt, status: "open", source,
      created_by: actor.type === "user" ? (actor.id ?? null) : null,
    }).returning("id").executeTakeFirstOrThrow();
    await trx.insertInto("order_events").values({
      tenant_id: tenantId, order_id: orderId, type: "conversion_offered", actor_type: actor.type === "user" ? "user" : "system", actor_id: actor.type === "user" ? actor.id ?? null : null,
      data: JSON.stringify({ purpose: body.purpose, method: body.method, amountMinor: String(amount), currency: o.currency }),
    }).execute();
    await this.events.emit(trx, {
      type: "payment.link_sent", tenantId, entity: { type: "order", id: orderId }, actor,
      data: { number: o.number, conversionId: row.id, purpose: body.purpose, method: body.method, amountMinor: String(amount), currency: o.currency, expiresAt: expiresAt.toISOString(), source },
    });
    return { id: row.id, number: o.number, amountMinor: String(amount) };
  }

  /**
   * Money came in (payment.received): an open offer whose amount has now been received since it
   * was made is paid. A booked, live shipment still carrying the old cash goes to review.
   */
  async onPayment(trx: Trx, tenantId: string, orderId: string, now = new Date()): Promise<boolean> {
    const link = await trx.selectFrom("payment_links").select(["id", "amount_minor", "paid_before_minor", "purpose"])
      .where("order_id", "=", orderId).where("purpose", "=", "convert_cod").where("status", "=", "open").forUpdate().executeTakeFirst();
    if (!link) return false;
    const o = await trx.selectFrom("orders").select(["number", "paid_minor", "cod_minor", "currency"]).where("id", "=", orderId).executeTakeFirstOrThrow();
    if (BigInt(o.paid_minor) - BigInt(link.paid_before_minor) < BigInt(link.amount_minor)) return false;
    await trx.updateTable("payment_links").set({ status: "paid", paid_at: now }).where("id", "=", link.id).execute();
    await trx.insertInto("order_events").values({
      tenant_id: tenantId, order_id: orderId, type: "conversion_paid", actor_type: "system", actor_id: null,
      data: JSON.stringify({ conversionId: link.id, codMinor: String(o.cod_minor), currency: o.currency }),
    }).execute();
    await this.events.emit(trx, {
      type: "payment.link_paid", tenantId, entity: { type: "order", id: orderId }, actor: { type: "system" },
      data: { number: o.number, conversionId: link.id, amountMinor: String(link.amount_minor), codMinor: String(o.cod_minor), currency: o.currency },
    });
    const stale = await trx.selectFrom("shipments").select(["id", "cod_minor", "provider"]).where("order_id", "=", orderId).where("booking", "=", "booked")
      .where("status", "not in", LIVE_SHIPMENT).where("cod_minor", "!=", o.cod_minor).execute();
    for (const sh of stale) {
      await trx.updateTable("shipments").set({ needs_review: true }).where("id", "=", sh.id).execute();
      await this.events.emit(trx, {
        type: "shipment.needs_review", tenantId, entity: { type: "shipment", id: sh.id }, actor: { type: "system" },
        data: { orderId, number: o.number, reason: "cod_changed", fromMinor: String(sh.cod_minor), toMinor: String(o.cod_minor), currency: o.currency, provider: sh.provider },
      });
    }
    return true;
  }

  async getSettings(tenantId: string): Promise<ConversionSettings> {
    return this.db.tenant(tenantId, (trx) => this.settings(trx, tenantId));
  }

  async putSettings(auth: AuthContext, body: ConversionSettings): Promise<ConversionSettings> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const t = await trx.selectFrom("tenants").select("settings").where("id", "=", tenantId).forUpdate().executeTakeFirstOrThrow();
      const before = conversionSettings(t.settings);
      const next = ConversionSettingsSchema.parse(body);
      await trx.updateTable("tenants").set({ settings: JSON.stringify({ ...(t.settings as object), conversion: next }) }).where("id", "=", tenantId).execute();
      await this.audit.record(trx, { action: "payments.conversion_settings_updated", tenantId, entity: { type: "tenant", id: tenantId }, before: { depositPct: before.depositPct, expiresHours: before.expiresHours, methods: Object.keys(before.methods) }, after: { depositPct: next.depositPct, expiresHours: next.expiresHours, methods: Object.keys(next.methods) }, ...auditActor(auth) });
      return next;
    });
  }

  private async settings(trx: Trx, tenantId: string): Promise<ConversionSettings> {
    const t = await trx.selectFrom("tenants").select("settings").where("id", "=", tenantId).executeTakeFirstOrThrow();
    return conversionSettings(t.settings);
  }

  /** A booked shipment does not block: once paid it goes to review so the courier collects the new amount. */
  private ineligible(o: { status: string; payment_mode: string; cod_minor: string | number | bigint }): keyof typeof REASONS | null {
    if (!OPEN_STATUSES.has(o.status)) return o.status === "cancelled" ? "closed" : "already_shipped";
    if (o.payment_mode !== "cod" && o.payment_mode !== "partial") return "not_cod";
    if (BigInt(o.cod_minor) <= 0n) return "nothing_owed";
    return null;
  }

  /** The deposit share, rounded up to a whole unit of the currency. */
  private deposit(owed: bigint, pct: number, currency: string): bigint {
    const unit = toMinor("1", currency);
    const raw = (owed * BigInt(pct) + 99n) / 100n;
    const rounded = ((raw + unit - 1n) / unit) * unit;
    return rounded >= owed ? raw : rounded;
  }

  private async view(trx: Trx, tenantId: string, orderId: string, now = new Date()): Promise<OrderConversion> {
    const o = await trx.selectFrom("orders").select(["id", "number", "status", "currency", "payment_mode", "cod_minor"]).where("id", "=", orderId).executeTakeFirst();
    if (!o) throw new ProblemError(404, "not_found", "order not found");
    const t = await trx.selectFrom("tenants").select(["name", "settings", "timezone"]).where("id", "=", tenantId).executeTakeFirstOrThrow();
    const s = conversionSettings(t.settings);
    const reason = this.ineligible(o);
    const owed = BigInt(o.cod_minor);
    const last = await trx.selectFrom("payment_links").selectAll().where("order_id", "=", orderId).where("purpose", "=", "convert_cod").orderBy("created_at", "desc").executeTakeFirst();
    let current: Conversion | null = null;
    if (last) {
      const expired = last.status === "open" && last.expires_at !== null && last.expires_at < now;
      current = {
        id: last.id, purpose: last.kind === "deposit" ? "deposit" : "full",
        method: (last.method ?? "instapay") as ConversionMethod, status: (expired ? "expired" : last.status) as Conversion["status"],
        amount: fromMinor(BigInt(last.amount_minor), o.currency), instructions: last.instructions,
        expiresAt: last.expires_at?.toISOString() ?? null, paidAt: last.paid_at?.toISOString() ?? null, createdAt: last.created_at.toISOString(),
        source: last.source as Conversion["source"],
      };
    }
    return {
      eligible: reason === null, reason, owed: fromMinor(owed, o.currency),
      deposit: fromMinor(owed > 0n ? this.deposit(owed, s.depositPct, o.currency) : 0n, o.currency),
      methods: CONVERSION_METHODS.filter((m) => Boolean(s.methods[m])),
      current,
      message: current && current.status === "open" ? this.message(t.name, o.number, current, owed, o.currency, t.timezone) : null,
    };
  }

  private message(store: string, number: string, c: Conversion, owedMinor: bigint, currency: string, timezone: string) {
    const restMinor = owedMinor - toMinor(c.amount.amount, currency);
    const restAmount = restMinor > 0n ? fromMinor(restMinor, currency).amount : null;
    const amount = `${c.amount.amount} ${currency}`;
    const rest = restAmount ? `${restAmount} ${currency}` : null;
    const cur = CURRENCY_AR[currency] ?? currency;
    const amountAr = `${c.amount.amount} ${cur}`;
    const restAr = restAmount ? `${restAmount} ${cur}` : null;
    const until = c.expiresAt ? new Intl.DateTimeFormat("en-GB", { timeZone: timezone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(c.expiresAt)) : null;
    const where = c.instructions ?? "";
    const m = METHOD_LABEL[c.method];
    const ar = [
      `أهلاً! أوردرك ${isolate(number)} من ${store} جاهز.`,
      `ادفع ${isolate(amountAr)} دلوقتي عن طريق ${m.ar}: ${isolate(where)} وابعتلنا صورة التحويل، وهنشحنه على طول${restAr ? ` (والباقي ${isolate(restAr)} عند الاستلام)` : ""}.`,
      until ? `العرض ساري لحد ${isolate(until)}.` : "",
    ].filter(Boolean).join("\n");
    const en = [
      `Hello! Your order ${number} from ${store} is ready.`,
      `Pay ${amount} now by ${m.en}: ${where} and send us the receipt, and we ship it right away${rest ? ` (the rest, ${rest}, on delivery)` : ""}.`,
      until ? `This offer is open until ${until}.` : "",
    ].filter(Boolean).join("\n");
    return { ar, en };
  }
}

const CURRENCY_AR: Record<string, string> = { EGP: "ج.م.", SAR: "ر.س.", AED: "د.إ.", KWD: "د.ك.", QAR: "ر.ق.", BHD: "د.ب.", OMR: "ر.ع.", USD: "دولار" };

const REASONS = {
  not_cod: "only a cash-on-delivery order is converted",
  nothing_owed: "nothing is left to collect on this order",
  already_shipped: "this order has already left",
  closed: "this order is cancelled",
} as const;
