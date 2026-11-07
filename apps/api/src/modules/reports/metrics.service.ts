import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { ProblemError } from "../../platform/http/problem.js";
import { AdSpendService } from "../profit/ads/ad-spend.service.js";
import { addDays, asDate, localDay, storeClock } from "../profit/store-day.js";
import { COST_FLAGS, METRICS, metricByKey, profitQuality, type MetricFacts } from "./metrics.js";
import type { MetricValuesQuery } from "./metrics.dto.js";
import { isoWeekRange, lastFullWeek } from "./week.js";

const PREPAID = ["prepaid", "bnpl", "bank_transfer", "store_credit"];
const COD = ["cod", "partial"];
/** Confirmation channels with no person on Mizan's side: the routing rule, the bot, the link page, an SMS link, an automated or AI call. */
export const AUTOMATED_CONFIRMATION = ["auto", "whatsapp", "link", "sms", "voice_ivr", "voice_ai", "voice_bot"];

/**
 * Profit honesty (FX-2): for store days `from`…`to`, the orders (not cancelled; base currency, as the
 * home, or any currency when its exchange rate is missing) whose profit misses an input, and the distinct products in them with no cost yet. One query
 * pair shared by the home, the metric layer and the reports, so every screen agrees.
 */
export async function costGaps(trx: Transaction<DB>, base: string, from: string, to: string): Promise<{ ordersMissingCosts: bigint; productsMissingCost: bigint }> {
  const flagged = trx.selectFrom("order_pnl as p").innerJoin("orders as o", "o.id", "p.order_id").select("p.order_id")
    .where("p.day", ">=", asDate(from)).where("p.day", "<=", asDate(to)).where("o.status", "<>", "cancelled")
    // An order with no exchange rate stays in its own currency (pnl.ts), so fx_missing counts whatever the currency.
    .where((eb) => eb.or([eb("p.currency", "=", base), sql<boolean>`'fx_missing' = any(p.flags)`]))
    .where(sql<boolean>`p.flags && array[${sql.join([...COST_FLAGS])}]::text[]`);
  const orders = await trx.selectFrom(flagged.as("f")).select(sql<string>`count(*)`.as("n")).executeTakeFirstOrThrow();
  const products = await trx.selectFrom("order_lines as l").leftJoin("variants as v", "v.id", "l.variant_id")
    .select(sql<string>`count(distinct coalesce(l.variant_id::text, 'title:' || l.title))`.as("n"))
    .where("l.order_id", "in", flagged).where("l.cost_set_at", "is", null).where((eb) => eb.or([eb("v.id", "is", null), eb("v.cogs_set_at", "is", null)]))
    .executeTakeFirstOrThrow();
  return { ordersMissingCosts: BigInt(orders.n), productsMissingCost: BigInt(products.n) };
}

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
      const quality = profitQuality(f);
      return {
        from, to, currency: base,
        // FX-2: whether the money figures are final; screens mark them "provisional" otherwise.
        quality,
        data: keys.map((k) => { const m = metricByKey.get(k)!; return { key: m.key, version: m.version, unit: m.unit, provisional: Boolean(m.profit) && quality.provisional, ...m.compute(f) }; }),
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
    const ended = sql<boolean>`(o.status = 'delivered' or o.status = 'returned' or (o.status = 'cancelled' and o.shipped_at is not null))`;
    const p = await trx.selectFrom("order_pnl as p").innerJoin("orders as o", "o.id", "p.order_id").select([
      sql<string>`count(*) filter (where o.status = 'delivered')`.as("delivered"),
      sql<string>`count(*) filter (where o.status = 'returned' or (o.status = 'cancelled' and o.shipped_at is not null))`.as("returned"),
      sql<string>`coalesce(sum(p.net_minor), 0)`.as("net"),
      // Only the orders that ended: one still moving carries its costs but not yet its cash.
      sql<string>`coalesce(sum(p.net_minor) filter (where ${ended}), 0)`.as("net_ended"),
      sql<string>`coalesce(sum(p.revenue_minor), 0)`.as("revenue"),
      sql<string>`coalesce(sum(p.refund_minor), 0)`.as("refunds"),
    ]).where("p.day", ">=", asDate(from)).where("p.day", "<=", asDate(to)).where("p.currency", "=", base).executeTakeFirstOrThrow();
    // Automation share (L1-7): orders of the period that were confirmed, the same test as the
    // confirmation analytics (E6-6: confirmed or further, or confirmed then cancelled), and of those
    // the ones with a confirmed attempt where nobody was involved. No attempt (confirmed from the
    // store, an exchange's replacement) counts as not automated.
    const confirmedOrder = sql<boolean>`(o.status in ('confirmed', 'shipped', 'delivered', 'returned') or o.confirmed_at is not null)`;
    const automated = sql<boolean>`exists (select 1 from confirmations c where c.order_id = o.id and c.outcome = 'confirmed' and c.agent_id is null and c.channel in (${sql.join(AUTOMATED_CONFIRMATION)}))`;
    const c = await trx.selectFrom("orders as o").select([
      sql<string>`count(*) filter (where ${confirmedOrder})`.as("confirmed"),
      sql<string>`count(*) filter (where ${confirmedOrder} and ${automated})`.as("auto"),
    ]).where(sql<boolean>`${local} between ${asDate(from)} and ${asDate(to)}`).executeTakeFirstOrThrow();
    const stock = await trx.selectFrom("stock_levels").select(sql<string>`coalesce(sum(greatest(on_hand - reserved, 0)), 0)`.as("n")).executeTakeFirstOrThrow();
    const shipped = await trx.selectFrom("stock_movements").select(sql<string>`coalesce(-sum(delta), 0)`.as("n"))
      .where("reason", "=", "pick").where(sql<boolean>`(created_at AT TIME ZONE ${timezone})::date between ${asDate(from)} and ${asDate(to)}`).executeTakeFirstOrThrow();
    return {
      base, days, live: BigInt(o.live), prepaid: BigInt(o.prepaid), cod: BigInt(o.cod), totalBase: BigInt(o.total_base), ordersBase: BigInt(o.orders_base),
      delivered: BigInt(p.delivered), returned: BigInt(p.returned), net: BigInt(p.net), netEnded: BigInt(p.net_ended), revenue: BigInt(p.revenue), refunds: BigInt(p.refunds),
      spend: (await this.adSpend.spendInBase(trx, tenantId, base, from, to)).total,
      available: BigInt(stock.n), unitsShipped: BigInt(shipped.n),
      confirmed: BigInt(c.confirmed), confirmedAuto: BigInt(c.auto),
      ...(await costGaps(trx, base, from, to)),
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
  period(q: { days?: number; from?: string; to?: string; week?: string }, timezone: string, now = new Date()): { from: string; to: string } {
    if (q.week) {
      const range = isoWeekRange(q.week === "last" ? lastFullWeek(localDay(now, timezone)) : q.week);
      if (!range) throw new ProblemError(422, "validation_failed", "an ISO week such as 2026-W43, or last", [{ path: "week", code: "invalid_week" }]);
      return range;
    }
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
