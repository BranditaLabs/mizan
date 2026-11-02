import { Inject, Injectable } from "@nestjs/common";
import { sql } from "kysely";
import { trxQueryClient } from "@mizan/db";
import { MizanEngine, SqlStore } from "@mizan/engine";
import { fromMinor } from "@mizan/shared";
import { BACKFILL_DAYS } from "../../integrations/shopify-connected.consumer.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { percent } from "../profit/home.js";
import { AdSpendService } from "../profit/ads/ad-spend.service.js";
import { addDays, asDate, storeClock } from "../profit/store-day.js";
import { MetricsService } from "../reports/metrics.service.js";
import type { AdPlatform } from "../profit/ads/ad-spend.csv.js";
import type { OrderSources, Roas, RoasQuery } from "./attribution.dto.js";
import { multiple, roasSummary } from "./roas.js";

const MOVING = ["new", "pending_confirmation", "confirmed", "shipped"];
const LOST = sql<string>`count(*) filter (where o.status = 'returned' or (o.status = 'cancelled' and o.shipped_at is not null))`;

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

  /**
   * Where the period's orders came from (M7-2): orders, delivery and real money by source platform
   * and by UTM campaign, the same placed-day cohort as True ROAS. Orders with no source row yet
   * count as unknown, never hidden. A platform with recorded spend gets its true ROAS.
   */
  async sources(auth: AuthContext, q: RoasQuery, now = new Date()): Promise<OrderSources> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const { base, timezone } = await storeClock(trx, tenantId);
      const { from, to } = this.metrics.period(q, timezone, now);
      const spend = await this.adSpend.spendInBase(trx, tenantId, base, from, to);
      const local = sql`(o.placed_at AT TIME ZONE ${timezone})::date`;
      const platform = sql<string>`coalesce(s.platform, 'unknown')`;
      const cohort = trx.selectFrom("orders as o")
        .leftJoin("order_sources as s", "s.order_id", "o.id")
        .leftJoin("order_pnl as p", (j) => j.onRef("p.order_id", "=", "o.id").on("p.currency", "=", base))
        .where(sql<boolean>`${local} between ${asDate(from)} and ${asDate(to)}`);
      const measures = [
        sql<string>`count(*)`.as("orders"),
        sql<string>`count(*) filter (where o.status = 'delivered')`.as("delivered"),
        LOST.as("lost"),
        sql<string>`coalesce(sum(o.total_minor) filter (where o.currency = ${base}), 0)`.as("placed"),
        sql<string>`coalesce(sum(p.revenue_minor - p.refund_minor), 0)`.as("real"),
        sql<string>`coalesce(sum(p.net_minor), 0)`.as("net"),
      ] as const;
      const byPlatform = await cohort.select([platform.as("platform"), sql<string>`count(*) filter (where s.paid)`.as("paid"), ...measures]).groupBy(sql`1`).execute();
      const campaigns = await cohort.select([platform.as("platform"), sql<string>`s.utm_campaign`.as("campaign"), ...measures])
        .where("s.utm_campaign", "is not", null).groupBy(sql`1, 2`).orderBy(sql`count(*)`, "desc").orderBy(sql`2`).limit(20).execute();

      const m = (minor: bigint) => fromMinor(minor, base);
      const total = byPlatform.reduce((a, r) => a + BigInt(r.orders), 0n);
      const attributed = byPlatform.filter((r) => r.platform !== "unknown" && r.platform !== "direct").reduce((a, r) => a + BigInt(r.orders), 0n);
      const row = (r: { orders: string; delivered: string; lost: string; placed: string; real: string; net: string }) => ({
        orders: Number(r.orders), delivered: Number(r.delivered), lost: Number(r.lost),
        placed: m(BigInt(r.placed)), real: m(BigInt(r.real)), net: m(BigInt(r.net)),
        deliveredRate: percent(BigInt(r.delivered), BigInt(r.delivered) + BigInt(r.lost)),
      });
      type Platform = OrderSources["byPlatform"][number]["platform"];
      return {
        from, to, currency: base, orders: Number(total), attributedShare: percent(attributed, total),
        byPlatform: byPlatform.sort((a, b) => Number(b.orders) - Number(a.orders) || a.platform.localeCompare(b.platform)).map((r) => {
          const s = spend.byPlatform.get(r.platform);
          return {
            ...row(r), platform: r.platform as Platform, paid: Number(r.paid), share: percent(BigInt(r.orders), total),
            spend: s === undefined ? null : m(s), trueRoas: s === undefined ? null : multiple(BigInt(r.real), s),
          };
        }),
        campaigns: campaigns.map((r) => ({ ...row(r), platform: r.platform as Platform, campaign: r.campaign })),
      };
    });
  }

  /**
   * Read the stores' recent orders again so their source is captured (M7-2 backfill): the history
   * import jobs, keyed per request, through the engine (rule 3). Shopify serves 60 days without the
   * read_all_orders scope, so that is the window.
   */
  async backfillSources(auth: AuthContext, key: string, now = Date.now()) {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const conns = await trx.selectFrom("connections").select(["id", "provider"]).where("kind", "=", "store")
        .where("provider", "in", ["shopify", "woocommerce"]).where("status", "=", "active").execute();
      const since = now - BACKFILL_DAYS * 86_400_000;
      for (const c of conns) {
        const store = new SqlStore(trxQueryClient(trx), { tenantId, connections: { [c.provider]: c.id } });
        const runKey = `sources:${key}:${c.id}`;
        if (c.provider === "shopify") await store.enqueue(MizanEngine.shopifyBackfillJob(runKey, since, now), now);
        else await store.enqueue(MizanEngine.wooBackfillJob(runKey, since), now);
      }
      return { connections: conns.length, days: BACKFILL_DAYS };
    });
  }
}
