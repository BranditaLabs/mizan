import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import type { Transaction } from "kysely";
import { asWorker, type DB } from "@mizan/db";
import { defaultRuntime } from "@mizan/engine";
import { convertMoney, ratio, type Money } from "@mizan/shared";
import { AuditService, auditActor } from "../../../platform/audit/audit.service.js";
import type { AuthContext } from "../../../platform/auth/auth.types.js";
import { APP_CONFIG, fxSourceOf, runsWorkerInProcess, type AppConfig } from "../../../platform/config.js";
import { Database } from "../../../platform/db/database.js";
import { EventsService } from "../../../platform/events/events.service.js";
import { MetricsService } from "../../../platform/metrics/metrics.service.js";
import { ProblemError } from "../../../platform/http/problem.js";
import type { FxRateView } from "../fx.dto.js";
import { addDays, asDate, dayText, localDay, storeClock } from "../store-day.js";
import { OpenErApiSource, type FxSource } from "./fx-source.js";

/** The feed is fetched in USD; every other pair is a cross rate (one request a day covers all). */
export const FEED_BASE = "USD";
/** How far back a feed rate may stand in for a day without one (marked stale). */
export const STALE_DAYS = 7;

export type ResolvedRate = Omit<FxRateView, "quote">;

/**
 * Daily exchange rates (M5, E9-1). The worker stores the feed's rates once a day (global table:
 * rates are not store data); a store's finance can set its own rate for a day. Lookup order:
 * the store's rate for the day → the feed's rate for the day → the feed's latest earlier rate
 * within 7 days (stale) → missing (profit stays provisional and says why, E9-2).
 */
@Injectable()
export class FxService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("Fx");
  private timer?: NodeJS.Timeout;
  private running?: Promise<unknown>;
  readonly source: FxSource | null;

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(MetricsService) private readonly metrics: MetricsService,
  ) {
    this.source = fxSourceOf(config) === "open-er-api" ? new OpenErApiSource(defaultRuntime()) : null;
  }

  onApplicationBootstrap(): void {
    if (runsWorkerInProcess(this.config)) this.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  start(): void {
    if (this.timer || !this.source) return;
    const tick = () => { this.running = this.refresh().catch((err) => this.logger.error({ err }, "fx refresh failed")); };
    this.timer = setInterval(tick, this.config.FX_REFRESH_MINUTES * 60_000);
    this.timer.unref();
    setTimeout(tick, 20_000).unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  /**
   * Stores today's feed rates unless they are already in. Safe to run any number of times: the
   * day's rows are upserted. A feed failure keeps every stored rate (lookups fall back to stale).
   */
  async refresh(now = new Date(), source: FxSource | null = this.source): Promise<{ stored: number; skipped: boolean }> {
    if (!source) return { stored: 0, skipped: true };
    const today = now.toISOString().slice(0, 10);
    const have = await asWorker(this.db.kysely, (trx) => trx.selectFrom("fx_rates").select("quote").where("day", "=", asDate(today)).where("base", "=", FEED_BASE).limit(1).execute());
    if (have.length) return { stored: 0, skipped: true };
    let quote;
    try {
      quote = await source.latest(FEED_BASE);
    } catch (err) {
      this.metrics.fxRefresh.inc({ result: "failed" });
      throw err;
    }
    const rows = Object.entries(quote.rates).filter(([code]) => code !== FEED_BASE)
      .map(([code, rate]) => ({ day: quote.day, base: FEED_BASE, quote: code, rate, source: source.name }));
    if (rows.length) {
      await asWorker(this.db.kysely, (trx) => trx.insertInto("fx_rates").values(rows)
        .onConflict((oc) => oc.columns(["day", "base", "quote"]).doUpdateSet((eb) => ({ rate: eb.ref("excluded.rate"), source: eb.ref("excluded.source") }))).execute());
    }
    this.metrics.fxRefresh.inc({ result: "stored" });
    this.logger.log({ day: quote.day, currencies: rows.length, source: source.name }, "fx rates stored");
    return { stored: rows.length, skipped: false };
  }

  /** 1 `base` = rate `quote` on `day`, for this store (inside its transaction). */
  async rate(trx: Transaction<DB>, tenantId: string, base: string, quote: string, day: string): Promise<ResolvedRate> {
    if (base === quote) return { rate: "1", source: "same", day, stale: false };
    const manual = await trx.selectFrom("fx_rate_overrides").select("rate").where("tenant_id", "=", tenantId).where("day", "=", asDate(day)).where("quote", "=", quote).executeTakeFirst();
    if (manual) return { rate: trim(manual.rate), source: "manual", day, stale: false };
    const need = [base, quote].filter((c) => c !== FEED_BASE);
    const rows = await trx.selectFrom("fx_rates").select([dayText("day").as("day"), "quote", "rate"])
      .where("base", "=", FEED_BASE).where("quote", "in", need).where("day", "<=", asDate(day)).where("day", ">=", asDate(addDays(day, -STALE_DAYS)))
      .orderBy("day", "desc").execute();
    const byDay = new Map<string, Record<string, string>>();
    for (const r of rows) byDay.set(r.day, { ...byDay.get(r.day), [r.quote.trim()]: trim(r.rate) });
    for (const [d, perUsd] of byDay) {
      const usd: Record<string, string> = { ...perUsd, [FEED_BASE]: "1" };
      if (usd[base] && usd[quote]) return { rate: trimZeros(ratio(usd[quote]!, usd[base]!, 10)), source: "feed", day: d, stale: d < day };
    }
    return { rate: null, source: "missing", day: null, stale: false };
  }

  /** An amount in the store's base currency for `day`, or null when no rate is known (E9-2). */
  async toBase(trx: Transaction<DB>, tenantId: string, base: string, money: Money, day: string): Promise<{ money: Money; rate: ResolvedRate } | null> {
    const r = await this.rate(trx, tenantId, base, money.currency, day);
    if (!r.rate) return null;
    return { money: convertMoney(money, base, ratio("1", r.rate, 12)), rate: r };
  }

  /** Rates for the settings screen: the store's base against USD and every currency its orders used lately. */
  async list(tenantId: string, day?: string, now = new Date()) {
    return this.db.tenant(tenantId, async (trx) => {
      const { base, timezone } = await storeClock(trx, tenantId);
      const on = day ?? localDay(now, timezone);
      const seen = await trx.selectFrom("orders").select("currency").distinct().where("placed_at", ">=", new Date(now.getTime() - 90 * 86_400_000)).execute();
      const quotes = [...new Set([FEED_BASE, ...seen.map((s) => s.currency.trim())])].filter((c) => c !== base).sort();
      const rates = [];
      for (const q of quotes) rates.push({ quote: q, ...(await this.rate(trx, tenantId, base, q, on)) });
      return { base, day: on, feed: this.source?.attribution ?? null, rates };
    });
  }

  async setOverride(auth: AuthContext, day: string, quote: string, rate: string, now = new Date()): Promise<FxRateView> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const { base, timezone } = await storeClock(trx, tenantId);
      if (quote === base) throw new ProblemError(422, "validation_failed", "the store's own currency is always 1", [{ path: "quote", code: "same_currency" }]);
      if (day > localDay(now, timezone)) throw new ProblemError(422, "validation_failed", "rates can be set for today or earlier", [{ path: "day", code: "future" }]);
      const before = await trx.selectFrom("fx_rate_overrides").select("rate").where("tenant_id", "=", tenantId).where("day", "=", asDate(day)).where("quote", "=", quote).executeTakeFirst();
      await trx.insertInto("fx_rate_overrides").values({ tenant_id: tenantId, day, quote, rate, set_by: auth.user.id })
        .onConflict((oc) => oc.columns(["tenant_id", "day", "quote"]).doUpdateSet({ rate, set_by: auth.user.id, set_at: now })).execute();
      await this.audit.record(trx, {
        action: "fx.rate_overridden", tenantId, ...auditActor(auth), entity: { type: "fx_rates", id: tenantId },
        before: before ? { rate: trim(before.rate) } : undefined, after: { base, quote, day, rate },
      });
      await this.events.emit(trx, { type: "fx.rate_overridden", tenantId, entity: { type: "fx_rates", id: tenantId }, actor: { type: "user", id: auth.user.id }, data: { base, quote, day } });
      return { quote, rate: trim(rate), source: "manual" as const, day, stale: false };
    });
  }
}

/** NUMERIC comes back padded ("48.75000000"). */
const trim = (v: string) => trimZeros(String(v));
const trimZeros = (v: string) => (v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v);
