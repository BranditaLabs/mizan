import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { ProblemError } from "../../platform/http/problem.js";
import { AdSpendService } from "../profit/ads/ad-spend.service.js";
import { addDays, asDate, localDay, storeClock } from "../profit/store-day.js";
import { METRICS, metricByKey, type MetricFacts } from "./metrics.js";
import type { MetricValuesQuery } from "./metrics.dto.js";

const PREPAID = ["prepaid", "bnpl", "bank_transfer", "store_credit"];
const COD = ["cod", "partial"];

/**
 * Serves the metric layer (E15-1): the catalogue in the reader's language, and values for a
 * period of store days, every metric from one set of facts. Each role sees only its metrics.
 */
@Injectable()
export class MetricsService {
  constructor(@Inject(Database) private readonly db: Database, @Inject(AdSpendService) private readonly adSpend: AdSpendService) {}

  catalogue(auth: AuthContext) {
    const lang = auth.user.language;
    return { data: this.visible(auth).map((m) => ({ key: m.key, version: m.version, unit: m.unit, module: m.module, name: m.name[lang], definition: m.definition[lang] })) };
  }

  async values(auth: AuthContext, q: MetricValuesQuery, now = new Date()) {
    const visible = this.visible(auth);
    const asked = q.keys ? q.keys.split(",").map((k) => k.trim()).filter(Boolean) : visible.map((m) => m.key);
    const unknown = asked.filter((k) => !metricByKey.has(k));
    if (unknown.length) throw new ProblemError(422, "validation_failed", "unknown metric", unknown.map((k) => ({ path: "keys", code: "unknown_metric", message: k })));
    const keys = asked.filter((k) => visible.some((m) => m.key === k)); // hidden, not zero
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const { base, timezone } = await storeClock(trx, tenantId);
      const { from, to } = this.period(q, timezone, now);
      const f = await this.facts(trx, tenantId, base, timezone, from, to);
      return {
        from, to, currency: base,
        data: keys.map((k) => { const m = metricByKey.get(k)!; return { key: m.key, version: m.version, unit: m.unit, ...m.compute(f) }; }),
      };
    });
  }

  /** Everything the metrics read, for store days `from`…`to` (inclusive). */
  async facts(trx: Transaction<DB>, tenantId: string, base: string, timezone: string, from: string, to: string): Promise<MetricFacts> {
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
    const local = sql`(o.placed_at AT TIME ZONE ${timezone})::date`;
    const o = await trx.selectFrom("orders as o").select([
      sql<string>`count(*)`.as("live"),
      sql<string>`count(*) filter (where o.payment_mode in (${sql.join(PREPAID)}))`.as("prepaid"),
      sql<string>`count(*) filter (where o.payment_mode in (${sql.join(COD)}))`.as("cod"),
      sql<string>`coalesce(sum(o.total_minor) filter (where o.currency = ${base}), 0)`.as("total_base"),
      sql<string>`count(*) filter (where o.currency = ${base})`.as("orders_base"),
    ]).where(sql<boolean>`${local} between ${asDate(from)} and ${asDate(to)}`).where("o.status", "!=", "cancelled").executeTakeFirstOrThrow();
    // The same rows and filters as the profit home (orders by store day, profit in the base currency).
    const p = await trx.selectFrom("order_pnl as p").innerJoin("orders as o", "o.id", "p.order_id").select([
      sql<string>`count(*) filter (where o.status = 'delivered')`.as("delivered"),
      sql<string>`count(*) filter (where o.status = 'returned' or (o.status = 'cancelled' and o.shipped_at is not null))`.as("returned"),
      sql<string>`coalesce(sum(p.net_minor), 0)`.as("net"),
      sql<string>`coalesce(sum(p.revenue_minor), 0)`.as("revenue"),
      sql<string>`coalesce(sum(p.refund_minor), 0)`.as("refunds"),
    ]).where("p.day", ">=", asDate(from)).where("p.day", "<=", asDate(to)).where("p.currency", "=", base).executeTakeFirstOrThrow();
    const stock = await trx.selectFrom("stock_levels").select(sql<string>`coalesce(sum(greatest(on_hand - reserved, 0)), 0)`.as("n")).executeTakeFirstOrThrow();
    const shipped = await trx.selectFrom("stock_movements").select(sql<string>`coalesce(-sum(delta), 0)`.as("n"))
      .where("reason", "=", "pick").where(sql<boolean>`(created_at AT TIME ZONE ${timezone})::date between ${asDate(from)} and ${asDate(to)}`).executeTakeFirstOrThrow();
    return {
      base, days, live: BigInt(o.live), prepaid: BigInt(o.prepaid), cod: BigInt(o.cod), totalBase: BigInt(o.total_base), ordersBase: BigInt(o.orders_base),
      delivered: BigInt(p.delivered), returned: BigInt(p.returned), net: BigInt(p.net), revenue: BigInt(p.revenue), refunds: BigInt(p.refunds),
      spend: (await this.adSpend.spendInBase(trx, tenantId, base, from, to)).total,
      available: BigInt(stock.n), unitsShipped: BigInt(shipped.n),
    };
  }

  /** Orders (placed, not cancelled) and net profit per store day, every day of the period present. */
  async daily(trx: Transaction<DB>, base: string, timezone: string, from: string, to: string): Promise<Array<{ day: string; orders: bigint; net: bigint }>> {
    const local = sql`(o.placed_at AT TIME ZONE ${timezone})::date`;
    const orders = await trx.selectFrom("orders as o").select([sql<string>`to_char(${local}, 'YYYY-MM-DD')`.as("day"), sql<string>`count(*)`.as("n")])
      .where(sql<boolean>`${local} between ${asDate(from)} and ${asDate(to)}`).where("o.status", "!=", "cancelled").groupBy(sql`1`).execute();
    const net = await trx.selectFrom("order_pnl as p").select([sql<string>`to_char(p.day, 'YYYY-MM-DD')`.as("day"), sql<string>`coalesce(sum(p.net_minor), 0)`.as("n")])
      .where("p.day", ">=", asDate(from)).where("p.day", "<=", asDate(to)).where("p.currency", "=", base).groupBy("p.day").execute();
    const o = new Map(orders.map((r) => [r.day, BigInt(r.n)]));
    const n = new Map(net.map((r) => [r.day, BigInt(r.n)]));
    const out: Array<{ day: string; orders: bigint; net: bigint }> = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push({ day: d, orders: o.get(d) ?? 0n, net: n.get(d) ?? 0n });
    return out;
  }

  /** The period a query asks for, in store days. */
  period(q: { days?: number; from?: string; to?: string }, timezone: string, now = new Date()): { from: string; to: string } {
    if (q.from && q.to) {
      const span = (Date.parse(`${q.to}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`)) / 86_400_000 + 1;
      if (span < 1 || span > 366) throw new ProblemError(422, "validation_failed", "from must be before to, at most 366 days", [{ path: "to", code: "range" }]);
      return { from: q.from, to: q.to };
    }
    const to = localDay(now, timezone);
    return { from: addDays(to, -((q.days ?? 30) - 1)), to };
  }

  visibleKeys(auth: AuthContext): Set<string> {
    return new Set(this.visible(auth).map((m) => m.key));
  }

  private visible(auth: AuthContext) {
    return METRICS.filter((m) => m.roles.has(auth.tenant!.role));
  }
}
