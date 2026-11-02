import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { convertMoney, fromMinor, ratio, toMinor, type Money } from "@mizan/shared";
import { AuditService, auditActor } from "../../../platform/audit/audit.service.js";
import type { AuthContext } from "../../../platform/auth/auth.types.js";
import { Database } from "../../../platform/db/database.js";
import { EventsService } from "../../../platform/events/events.service.js";
import { ProblemError } from "../../../platform/http/problem.js";
import { FxService } from "../fx/fx.service.js";
import { ProfitService } from "../profit.service.js";
import { addDays, asDate, dayText, localDay, storeClock } from "../store-day.js";
import { MAX_AGE_DAYS, parseSpendCsv, type AdPlatform } from "./ad-spend.csv.js";

/** The longest range one list returns. */
const MAX_RANGE_DAYS = 92;

/**
 * Ad spend (M5, E9-3) before the ad platforms' APIs (M7): a day's spend per store and platform,
 * typed in or imported from a CSV. Each change emits `ads.spend_changed`; the profit consumer then
 * gives that store day's orders their new share (`ProfitService.adsShare`).
 */
@Injectable()
export class AdSpendService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(FxService) private readonly fx: FxService,
    @Inject(ProfitService) private readonly profit: ProfitService,
  ) {}

  async list(tenantId: string, q: { from?: string; to?: string }, now = new Date()) {
    return this.db.tenant(tenantId, async (trx) => {
      const { base, timezone } = await storeClock(trx, tenantId);
      const today = localDay(now, timezone);
      const to = q.to ?? today;
      const from = q.from ?? addDays(to, -29);
      if (from > to || from < addDays(to, -(MAX_RANGE_DAYS - 1))) {
        throw new ProblemError(422, "validation_failed", `from must be on or before to, at most ${MAX_RANGE_DAYS} days`, [{ path: "from", code: "range" }]);
      }
      const rows = await trx.selectFrom("ad_spend").select(["connection_id", dayText("day").as("day"), "platform", "campaign_id", "campaign_name", "spend_minor", "currency", "source", "updated_at"])
        .where("day", ">=", asDate(from)).where("day", "<=", asDate(to)).orderBy("day", "desc").orderBy("platform").orderBy("campaign_id").execute();

      const zero = 0n;
      let total = zero;
      let unallocated = zero;
      const platforms = new Map<string, bigint>();
      const groups = new Map<string, { day: string; connectionId: string; byCurrency: Map<string, bigint>; byPlatform: Map<string, Map<string, bigint>> }>();
      for (const r of rows) {
        const k = `${r.connection_id}|${r.day}`;
        const g = groups.get(k) ?? { day: r.day, connectionId: r.connection_id, byCurrency: new Map(), byPlatform: new Map() };
        const cur = r.currency.trim();
        g.byCurrency.set(cur, (g.byCurrency.get(cur) ?? 0n) + BigInt(r.spend_minor));
        const pc = g.byPlatform.get(r.platform) ?? new Map<string, bigint>();
        pc.set(cur, (pc.get(cur) ?? 0n) + BigInt(r.spend_minor));
        g.byPlatform.set(r.platform, pc);
        groups.set(k, g);
      }
      const days = [];
      for (const g of groups.values()) {
        const { minor, fxMissing } = await this.toBase(trx, tenantId, base, g.day, g.byCurrency);
        for (const [platform, pc] of g.byPlatform) platforms.set(platform, (platforms.get(platform) ?? 0n) + (await this.toBase(trx, tenantId, base, g.day, pc)).minor);
        const orders = (await this.profit.dayOrders(trx, g.connectionId, g.day, timezone)).length;
        total += minor;
        if (!orders) unallocated += minor;
        days.push({
          day: g.day, connectionId: g.connectionId, spend: fromMinor(minor, base), orders, fxMissing,
          perOrder: orders ? fromMinor(minor / BigInt(orders), base) : null,
        });
      }
      return {
        from, to, baseCurrency: base, total: fromMinor(total, base), unallocated: fromMinor(unallocated, base),
        byPlatform: [...platforms].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0)).map(([platform, m]) => ({ platform: platform as AdPlatform, spend: fromMinor(m, base) })),
        days,
        data: rows.map((r) => ({
          day: r.day, platform: r.platform as AdPlatform, campaign: r.campaign_name ?? (r.campaign_id || null), spend: fromMinor(BigInt(r.spend_minor), r.currency.trim()),
          source: r.source as "manual", connectionId: r.connection_id, updatedAt: r.updated_at.toISOString(),
        })),
      };
    });
  }

  /** Set a day's spend on a platform (typed in): replaces whatever that day and platform had. */
  async set(auth: AuthContext, body: { day: string; platform: AdPlatform; amount: string; currency?: string | undefined; connectionId?: string | undefined }, now = new Date()) {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const { base, timezone } = await storeClock(trx, tenantId);
      const connectionId = await this.store(trx, body.connectionId);
      this.checkDay(body.day, localDay(now, timezone));
      const currency = body.currency ?? base;
      let minor: bigint;
      try { minor = toMinor(body.amount, currency); } catch { throw new ProblemError(422, "validation_failed", `too many decimals for ${currency}`, [{ path: "amount", code: "decimals" }]); }
      const before = await this.replace(trx, tenantId, connectionId, [{ day: body.day, platform: body.platform, campaign: "", spendMinor: minor, currency }], "manual", auth.user.id, now);
      await this.audit.record(trx, {
        action: "ad_spend.changed", tenantId, ...auditActor(auth), entity: { type: "connection", id: connectionId },
        before: { day: body.day, platform: body.platform, spend: before }, after: { day: body.day, platform: body.platform, spend: fromMinor(minor, currency) },
      });
      await this.changed(trx, tenantId, connectionId, [body.day], "manual");
      return { day: body.day, platform: body.platform, spend: fromMinor(minor, currency), connectionId };
    });
  }

  /** Remove a day's spend on a platform (every campaign of it). */
  async remove(auth: AuthContext, day: string, platform: AdPlatform, connectionId?: string) {
    const tenantId = auth.tenant!.id;
    await this.db.tenant(tenantId, async (trx) => {
      const conn = await this.store(trx, connectionId);
      const gone = await trx.deleteFrom("ad_spend").where("connection_id", "=", conn).where("day", "=", asDate(day)).where("platform", "=", platform)
        .returning(["spend_minor", "currency"]).execute();
      if (!gone.length) throw new ProblemError(404, "not_found", "no spend recorded for that day and platform");
      await this.audit.record(trx, { action: "ad_spend.changed", tenantId, ...auditActor(auth), entity: { type: "connection", id: conn }, before: { day, platform, spend: summary(gone) }, after: { day, platform, spend: null } });
      await this.changed(trx, tenantId, conn, [day], "manual");
    });
  }

  /**
   * Import a CSV: all lines valid or nothing saved (each bad line named). Every day and platform in
   * the file replaces what was recorded for it; rows for the same day, platform and campaign add up.
   */
  async import(auth: AuthContext, body: { csv: string; platform?: AdPlatform | undefined; connectionId?: string | undefined }, now = new Date()) {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const { base, timezone } = await storeClock(trx, tenantId);
      const connectionId = await this.store(trx, body.connectionId);
      const { rows, problems } = parseSpendCsv(body.csv, { today: localDay(now, timezone), currency: base, ...(body.platform ? { platform: body.platform } : {}) });
      if (problems.length) {
        throw new ProblemError(422, "csv_invalid", `${problems.length} line(s) could not be read; nothing was saved`,
          problems.slice(0, 50).map((p) => ({ path: `line:${p.line}`, code: p.problem, ...(p.value !== undefined ? { message: p.value.slice(0, 60) } : {}) })));
      }
      const merged = new Map<string, { day: string; platform: AdPlatform; campaign: string; spendMinor: bigint; currency: string }>();
      for (const r of rows) {
        const k = `${r.day}|${r.platform}|${r.campaign}|${r.currency}`;
        const m = merged.get(k);
        if (m) m.spendMinor += r.spendMinor; else merged.set(k, { day: r.day, platform: r.platform, campaign: r.campaign, spendMinor: r.spendMinor, currency: r.currency });
      }
      const sameCampaign = new Set<string>();
      for (const m of merged.values()) {
        const k = `${m.day}|${m.platform}|${m.campaign}`;
        if (sameCampaign.has(k)) throw new ProblemError(422, "csv_invalid", "one day, platform and campaign has two currencies", [{ path: `day:${m.day}`, code: "currency" }]);
        sameCampaign.add(k);
      }
      await this.replace(trx, tenantId, connectionId, [...merged.values()], "csv", auth.user.id, now);
      const days = [...new Set([...merged.values()].map((m) => m.day))].sort();
      await this.audit.record(trx, { action: "ad_spend.changed", tenantId, ...auditActor(auth), entity: { type: "connection", id: connectionId }, after: { imported: rows.length, from: days[0], to: days.at(-1), days: days.length } });
      await this.changed(trx, tenantId, connectionId, days, "csv");
      return { rows: rows.length, days: days.length };
    });
  }

  /** Replace the (day, platform) pairs given with these rows; returns what one pair had before (for the audit). */
  private async replace(trx: Transaction<DB>, tenantId: string, connectionId: string, rows: Array<{ day: string; platform: AdPlatform; campaign: string; spendMinor: bigint; currency: string }>, source: "manual" | "csv", userId: string, now: Date) {
    const pairs = [...new Map(rows.map((r) => [`${r.day}|${r.platform}`, r])).values()];
    let before: Money[] | null = null;
    for (const p of pairs) {
      const gone = await trx.deleteFrom("ad_spend").where("connection_id", "=", connectionId).where("day", "=", asDate(p.day)).where("platform", "=", p.platform)
        .returning(["spend_minor", "currency"]).execute();
      before ??= gone.length ? summary(gone) : null;
    }
    for (let i = 0; i < rows.length; i += 500) {
      await trx.insertInto("ad_spend").values(rows.slice(i, i + 500).map((r) => ({
        tenant_id: tenantId, connection_id: connectionId, day: asDate(r.day), platform: r.platform, campaign_id: r.campaign, campaign_name: r.campaign || null,
        spend_minor: r.spendMinor.toString(), currency: r.currency, source, updated_at: now, updated_by: userId,
      }))).execute();
    }
    return before;
  }

  private async changed(trx: Transaction<DB>, tenantId: string, connectionId: string, days: string[], source: string) {
    await this.events.emit(trx, { type: "ads.spend_changed", tenantId, entity: { type: "connection", id: connectionId }, actor: { type: "system" }, data: { connectionId, days, source } });
  }

  private checkDay(day: string, today: string) {
    if (day > today) throw new ProblemError(422, "validation_failed", "spend cannot be in the future", [{ path: "day", code: "future" }]);
    if (day < addDays(today, -MAX_AGE_DAYS)) throw new ProblemError(422, "validation_failed", `at most ${MAX_AGE_DAYS} days back`, [{ path: "day", code: "too_old" }]);
  }

  /** The store the spend belongs to: the one named, else the only one connected. */
  private async store(trx: Transaction<DB>, connectionId?: string): Promise<string> {
    const stores = await trx.selectFrom("connections").select("id").where("kind", "in", ["store", "marketplace"]).execute();
    if (connectionId) {
      if (!stores.some((s) => s.id === connectionId)) throw new ProblemError(404, "not_found", "no such store connection");
      return connectionId;
    }
    if (!stores.length) throw new ProblemError(422, "no_store", "connect a store first: ad spend is spread over its orders");
    if (stores.length > 1) throw new ProblemError(422, "store_required", "this account has several stores: say which one (connectionId)", [{ path: "connectionId", code: "required" }]);
    return stores[0]!.id;
  }

  /** Spend by currency on a day, in the base currency at that day's rates. */
  /**
   * Spend for store days `from`…`to` in the base currency (each day at its own rate), by day and
   * platform, for ROAS (M7-1) and the metric layer. A day in a currency without a rate is left out
   * and flagged, never guessed.
   */
  async spendInBase(trx: Transaction<DB>, tenantId: string, base: string, from: string, to: string) {
    const rows = await trx.selectFrom("ad_spend").select([dayText("day").as("day"), "platform", "currency", sql<string>`sum(spend_minor)`.as("minor")])
      .where("day", ">=", asDate(from)).where("day", "<=", asDate(to)).groupBy(["day", "platform", "currency"]).execute();
    const byDay = new Map<string, bigint>();
    const byPlatform = new Map<string, bigint>();
    let total = 0n;
    let fxMissing = false;
    for (const r of rows) {
      const { minor, fxMissing: missing } = await this.toBase(trx, tenantId, base, r.day, new Map([[r.currency.trim(), BigInt(r.minor)]]));
      fxMissing ||= missing;
      total += minor;
      byDay.set(r.day, (byDay.get(r.day) ?? 0n) + minor);
      byPlatform.set(r.platform, (byPlatform.get(r.platform) ?? 0n) + minor);
    }
    return { total, byDay, byPlatform, fxMissing };
  }

  private async toBase(trx: Transaction<DB>, tenantId: string, base: string, day: string, byCurrency: Map<string, bigint>) {
    let minor = 0n;
    let fxMissing = false;
    for (const [cur, m] of byCurrency) {
      if (cur === base) { minor += m; continue; }
      const r = await this.fx.rate(trx, tenantId, base, cur, day);
      if (!r.rate) { fxMissing = true; continue; }
      minor += toMinor(convertMoney(fromMinor(m, cur), base, ratio("1", r.rate, 12)));
    }
    return { minor, fxMissing };
  }
}

/** Removed rows as money per currency (audit). */
function summary(rows: Array<{ spend_minor: string | bigint; currency: string }>): Money[] {
  const by = new Map<string, bigint>();
  for (const r of rows) by.set(r.currency.trim(), (by.get(r.currency.trim()) ?? 0n) + BigInt(r.spend_minor));
  return [...by].map(([c, m]) => fromMinor(m, c));
}

