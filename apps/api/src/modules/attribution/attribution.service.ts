import { Inject, Injectable } from "@nestjs/common";
import { sql } from "kysely";
import { fromMinor } from "@mizan/shared";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { percent } from "../profit/home.js";
import { AdSpendService } from "../profit/ads/ad-spend.service.js";
import { addDays, asDate, storeClock } from "../profit/store-day.js";
import { MetricsService } from "../reports/metrics.service.js";
import type { AdPlatform } from "../profit/ads/ad-spend.csv.js";
import type { Roas, RoasQuery } from "./attribution.dto.js";
import { multiple, roasSummary } from "./roas.js";

const MOVING = ["new", "pending_confirmation", "confirmed", "shipped"];

/**
 * True ROAS (M7, M7-1): the period's ad spend against what the orders placed in it really brought,
 * followed to delivery and cash. Orders by the store day they were placed (the same cohort as the
 * profit home and the metric layer), money in the base currency; orders in another currency
 * without a rate are left out of the money, never guessed.
 */
@Injectable()
export class AttributionService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AdSpendService) private readonly adSpend: AdSpendService,
    @Inject(MetricsService) private readonly metrics: MetricsService,
  ) {}

  async roas(auth: AuthContext, q: RoasQuery, now = new Date()): Promise<Roas> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const { base, timezone } = await storeClock(trx, tenantId);
      const { from, to } = this.metrics.period(q, timezone, now);
      const spend = await this.adSpend.spendInBase(trx, tenantId, base, from, to);
      const local = sql`(o.placed_at AT TIME ZONE ${timezone})::date`;
      const day = sql<string>`to_char(${local}, 'YYYY-MM-DD')`;
      const rows = await trx.selectFrom("orders as o").leftJoin("order_pnl as p", (j) => j.onRef("p.order_id", "=", "o.id").on("p.currency", "=", base))
        .select([
          day.as("day"),
          sql<string>`count(*)`.as("placed"),
          sql<string>`count(*) filter (where o.status = 'cancelled' and o.shipped_at is null)`.as("cancelled"),
          sql<string>`count(*) filter (where o.status = 'returned' or (o.status = 'cancelled' and o.shipped_at is not null))`.as("returned"),
          sql<string>`count(*) filter (where o.status = 'delivered')`.as("delivered"),
          sql<string>`count(*) filter (where o.status in (${sql.join(MOVING)}))`.as("moving"),
          sql<string>`coalesce(sum(o.total_minor) filter (where o.currency = ${base}), 0)`.as("placed_value"),
          sql<string>`coalesce(sum(p.revenue_minor - p.refund_minor), 0)`.as("real"),
          sql<string>`coalesce(sum(greatest(p.expected_revenue_minor - p.revenue_minor, 0)) filter (where o.status in (${sql.join(MOVING)})), 0)`.as("pending"),
          sql<string>`coalesce(sum(p.net_minor), 0)`.as("net"),
        ])
        .where(sql<boolean>`${local} between ${asDate(from)} and ${asDate(to)}`).groupBy(sql`1`).execute();

      const sum = (k: keyof (typeof rows)[number]) => rows.reduce((a, r) => a + BigInt(r[k]), 0n);
      const facts = {
        spend: spend.total, orders: sum("placed"), placedValue: sum("placed_value"), cancelled: sum("cancelled"), returned: sum("returned"),
        delivered: sum("delivered"), moving: sum("moving"), real: sum("real"), pending: sum("pending"), net: sum("net"),
      };
      const r = roasSummary(facts);
      const m = (minor: bigint) => fromMinor(minor, base);
      const byDay = new Map(rows.map((x) => [x.day, x]));
      const days: Roas["days"] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) {
        const x = byDay.get(d);
        const s = spend.byDay.get(d) ?? 0n;
        const real = x ? BigInt(x.real) : 0n;
        days.push({ day: d, spend: m(s), orders: x ? Number(x.placed) : 0, delivered: x ? Number(x.delivered) : 0, real: m(real), trueRoas: multiple(real, s) });
      }
      return {
        from, to, currency: base, spend: m(spend.total), fxMissing: spend.fxMissing,
        trueRoas: r.trueRoas, reportedRoas: r.reportedRoas, projectedRoas: r.projectedRoas,
        costPerOrder: r.costPerOrder === null ? null : m(r.costPerOrder), costPerDelivered: r.costPerDelivered === null ? null : m(r.costPerDelivered),
        deliveredRate: r.deliveredRate, lostShare: r.lostShare,
        orders: { placed: Number(facts.orders), delivered: Number(facts.delivered), moving: Number(facts.moving), cancelled: Number(facts.cancelled), returned: Number(facts.returned) },
        money: { placed: m(facts.placedValue), real: m(facts.real), pending: m(facts.pending), net: m(facts.net) },
        byPlatform: [...spend.byPlatform].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
          .map(([platform, minor]) => ({ platform: platform as AdPlatform, spend: m(minor), share: percent(minor, spend.total) })),
        days,
      };
    });
  }
}
