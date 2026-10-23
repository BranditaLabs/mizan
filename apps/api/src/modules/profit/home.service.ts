import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { fromMinor, toMinor } from "@mizan/shared";
import { Database } from "../../platform/db/database.js";
import { ProblemError } from "../../platform/http/problem.js";
import { AdSpendService } from "./ads/ad-spend.service.js";
import { daysOf, fixedCostsFor, percent } from "./home.js";
import type { HOME_LEAKS } from "./profit.dto.js";
import { addDays, asDate, dayText, localDay, storeClock } from "./store-day.js";

/** Periods the home offers (days ending yesterday's store day … today). */
export const HOME_PERIODS = [7, 30, 90] as const;

const SUMS = ["revenue", "refund", "cogs", "shipping", "cod_fee", "payment_fee", "channel_fee", "ads", "agent", "packaging", "rto", "chargeback", "net", "expected_net"] as const;
type Sums = Record<(typeof SUMS)[number], bigint> & { orders: bigint; live: bigint; delivered: bigint; returned: bigint; returnedNet: bigint; losing: bigint; losingNet: bigint };
const zero = (): Sums => ({ ...Object.fromEntries(SUMS.map((k) => [k, 0n])), orders: 0n, live: 0n, delivered: 0n, returned: 0n, returnedNet: 0n, losing: 0n, losingNet: 0n } as Sums);

/** Flags that point at a setting the owner can fix, in the order the home lists them. */
const SETUP_LEAKS = ["cost_missing", "shipping_rate_missing", "cod_fee_missing", "agent_cost_missing", "packaging_cost_missing", "payment_fee_missing", "fx_missing", "ads_fx_missing"] as const;

/**
 * The profit home (M5, E9-4): what the store really kept over a period of store days (orders by
 * the day they were placed), and yesterday; where each pound went; delivery and refusal; cash
 * still with couriers; and the leaks to fix. Realised profit counts money that is real (COD once
 * delivered); expected profit adds what orders still on their way make if they deliver. Monthly
 * fixed costs and ad spend no order carried are taken off the period, never hidden.
 */
@Injectable()
export class ProfitHomeService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AdSpendService) private readonly ads: AdSpendService,
  ) {}

  async home(tenantId: string, days: number, now = new Date()) {
    if (!(HOME_PERIODS as readonly number[]).includes(days)) throw new ProblemError(422, "validation_failed", "days must be 7, 30 or 90", [{ path: "days", code: "enum" }]);
    const result = await this.db.tenant(tenantId, async (trx) => {
      const { base, timezone } = await storeClock(trx, tenantId);
      const today = localDay(now, timezone);
      const to = today;
      const from = addDays(to, -(days - 1));
      const yesterday = addDays(today, -1);
      const prevTo = addDays(from, -1);
      const prevFrom = addDays(prevTo, -(days - 1));

      const byDay = await this.byDay(trx, base, from, to);
      const prev = sum([...(await this.byDay(trx, base, prevFrom, prevTo)).values()]);
      const period = sum([...byDay.values()]);
      const y = byDay.get(yesterday) ?? zero();
      const excluded = await trx.selectFrom("order_pnl").select(sql<string>`count(*)`.as("n"))
        .where("day", ">=", asDate(from)).where("day", "<=", asDate(to)).where("currency", "<>", base).executeTakeFirstOrThrow();

      const fixedRules = (await trx.selectFrom("cost_rules").select(["amount_minor", "currency", dayText("valid_from").as("valid_from"), dayText("valid_to").as("valid_to")])
        .where("kind", "=", "fixed_monthly").where("valid_from", "<=", asDate(to)).where((eb) => eb.or([eb("valid_to", "is", null), eb("valid_to", ">=", asDate(prevFrom))]))
        .execute()).filter((r) => r.currency?.trim() === base && r.amount_minor !== null)
        .map((r) => ({ amountMinor: BigInt(String(r.amount_minor)), validFrom: r.valid_from, validTo: r.valid_to }));
      const fixed = fixedCostsFor(fixedRules, from, to);
      const prevFixed = fixedCostsFor(fixedRules, prevFrom, prevTo);

      const cash = await trx.selectFrom("orders as o").leftJoin("order_pnl as p", "p.order_id", "o.id")
        .select([
          sql<string>`coalesce(sum(o.cod_minor) filter (where o.status = 'shipped'), 0)`.as("transit"),
          sql<string>`count(*) filter (where o.status = 'shipped' and o.cod_minor > 0)`.as("transit_n"),
          sql<string>`coalesce(sum(o.cod_minor) filter (where o.status = 'delivered' and 'awaiting_settlement' = any(coalesce(p.flags, '{}'))), 0)`.as("held"),
          sql<string>`count(*) filter (where o.status = 'delivered' and o.cod_minor > 0 and 'awaiting_settlement' = any(coalesce(p.flags, '{}')))`.as("held_n"),
        ])
        .where("o.currency", "=", base).where(sql<boolean>`o.cod_minor > 0`).executeTakeFirstOrThrow();

      const flags = await trx.selectFrom(
        trx.selectFrom("order_pnl as p").innerJoin("orders as o", "o.id", "p.order_id").select(sql<string>`unnest(p.flags)`.as("flag"))
          .where("p.day", ">=", asDate(from)).where("p.day", "<=", asDate(to)).where("o.status", "<>", "cancelled").as("x"),
      ).select(["x.flag", sql<string>`count(*)`.as("n")]).groupBy("x.flag").execute();
      return { base, today, from, to, yesterday, byDay, period, prev, y, excluded: Number(excluded.n), fixed, prevFixed, cash, flags };
    });

    const ads = await this.ads.list(tenantId, { from: result.from, to: result.to }, now);
    const prevAds = await this.ads.list(tenantId, { from: addDays(result.from, -days), to: addDays(result.from, -1) }, now);
    const { base, period: p, prev, y } = result;
    const m = (v: bigint) => fromMinor(v, base);
    const unallocated = toMinor(ads.unallocated);
    const prevUnallocated = toMinor(prevAds.unallocated);
    const kept = p.net - result.fixed - unallocated;
    const prevKept = prev.net - result.prevFixed - prevUnallocated;
    const ended = p.delivered + p.returned;
    const counts = new Map(result.flags.map((f) => [f.flag, Number(f.n)]));

    const leaks: Array<{ kind: (typeof HOME_LEAKS)[number]; count: number; amount: ReturnType<typeof m> | null }> = [];
    if (p.losing > 0n) leaks.push({ kind: "losing_orders", count: Number(p.losing), amount: m(-p.losingNet) });
    if (p.returned > 0n && p.returnedNet < 0n) leaks.push({ kind: "refusals", count: Number(p.returned), amount: m(-p.returnedNet) });
    if (unallocated > 0n) leaks.push({ kind: "unallocated_ads", count: ads.days.filter((d) => d.perOrder === null).length, amount: m(unallocated) });
    if (result.excluded > 0) leaks.push({ kind: "other_currency", count: result.excluded, amount: null });
    for (const f of SETUP_LEAKS) if (counts.get(f)) leaks.push({ kind: f, count: counts.get(f)!, amount: null });
    leaks.sort((a, b) => (a.amount && b.amount ? Number(toMinor(b.amount) - toMinor(a.amount)) : a.amount ? -1 : b.amount ? 1 : 0));

    return {
      baseCurrency: base, today: result.today, from: result.from, to: result.to, days,
      yesterday: { day: result.yesterday, orders: Number(y.orders), revenue: m(y.revenue - y.refund), net: m(y.net), expectedNet: m(y.expected_net) },
      period: {
        orders: Number(p.orders), revenue: m(p.revenue - p.refund), net: m(p.net), expectedNet: m(p.expected_net),
        fixedCosts: m(result.fixed), unallocatedAds: m(unallocated), kept: m(kept), expectedKept: m(p.expected_net - result.fixed - unallocated),
        margin: percent(kept, p.revenue - p.refund), keptPer100: p.revenue - p.refund > 0n ? m((kept * 10000n) / (p.revenue - p.refund)) : null,
        previousKept: m(prevKept), change: percent(kept - prevKept, prevKept < 0n ? -prevKept : prevKept),
        delivered: Number(p.delivered), returned: Number(p.returned), deliveryRate: percent(p.delivered, ended), refusalLoss: m(p.returnedNet < 0n ? -p.returnedNet : 0n),
        adSpend: ads.total,
        breakdown: {
          revenue: m(p.revenue - p.refund), productCost: m(p.cogs), shippingAndCod: m(p.shipping + p.cod_fee), ads: m(p.ads + unallocated), returns: m(p.rto),
          team: m(p.agent), fees: m(p.payment_fee + p.channel_fee + p.packaging + p.chargeback), fixed: m(result.fixed), kept: m(kept),
        },
      },
      cash: { inTransit: m(BigInt(result.cash.transit)), inTransitOrders: Number(result.cash.transit_n), awaitingRemittance: m(BigInt(result.cash.held)), awaitingRemittanceOrders: Number(result.cash.held_n) },
      trend: daysOf(result.from, result.to).map((d) => {
        const s = result.byDay.get(d) ?? zero();
        return { day: d, orders: Number(s.orders), net: m(s.net), expectedNet: m(s.expected_net) };
      }),
      leaks,
    };
  }

  /** order_pnl summed per store day, in the base currency (orders without a rate are counted apart). */
  private async byDay(trx: Transaction<DB>, base: string, from: string, to: string): Promise<Map<string, Sums>> {
    const s = (col: string) => sql<string>`coalesce(sum(${sql.ref(`p.${col}_minor`)}), 0)`.as(col);
    const rows = await trx.selectFrom("order_pnl as p").innerJoin("orders as o", "o.id", "p.order_id")
      .select([
        dayText("p.day").as("day"), sql<string>`count(*)`.as("orders"), sql<string>`count(*) filter (where o.status <> 'cancelled')`.as("live"),
        ...SUMS.map(s),
        sql<string>`count(*) filter (where o.status = 'delivered')`.as("delivered"),
        sql<string>`count(*) filter (where o.status = 'returned' or (o.status = 'cancelled' and o.shipped_at is not null))`.as("returned"),
        sql<string>`coalesce(sum(p.net_minor) filter (where o.status = 'returned' or (o.status = 'cancelled' and o.shipped_at is not null)), 0)`.as("returned_net"),
        sql<string>`count(*) filter (where p.expected_net_minor < 0 and o.status <> 'cancelled')`.as("losing"),
        sql<string>`coalesce(sum(p.expected_net_minor) filter (where p.expected_net_minor < 0 and o.status <> 'cancelled'), 0)`.as("losing_net"),
      ])
      .where("p.day", ">=", asDate(from)).where("p.day", "<=", asDate(to)).where("p.currency", "=", base)
      .groupBy("p.day").execute();
    const out = new Map<string, Sums>();
    for (const r of rows as unknown as Array<Record<string, string>>) {
      const v = zero();
      for (const k of SUMS) v[k] = BigInt(r[k]!);
      v.orders = BigInt(r.orders!); v.live = BigInt(r.live!); v.delivered = BigInt(r.delivered!); v.returned = BigInt(r.returned!);
      v.returnedNet = BigInt(r.returned_net!); v.losing = BigInt(r.losing!); v.losingNet = BigInt(r.losing_net!);
      out.set(r.day!, v);
    }
    return out;
  }
}

function sum(xs: Sums[]): Sums {
  const t = zero();
  for (const x of xs) for (const k of Object.keys(t) as Array<keyof Sums>) t[k] += x[k];
  return t;
}
