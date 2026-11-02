import { Inject, Injectable } from "@nestjs/common";
import { sql } from "kysely";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { deliveredRate } from "../reports/metrics.js";
import { percent } from "../profit/home.js";
import type { Scorecard, ScorecardQuery } from "./scorecard.dto.js";

interface Counts { shipments: bigint; delivered: bigint; returned: bigint; inFlight: bigint; daysSum: number; daysN: bigint }

/**
 * M3 courier scorecard (E7-4): per courier and zone (governorate, or the city), how many shipments
 * were delivered, came back and are still out, and how long delivery took — so the owner sees which
 * courier to use where. Delivered rate is the metric layer's formula, the same number as everywhere.
 * Days to remit wait for settlements (M8).
 */
@Injectable()
export class ScorecardService {
  constructor(@Inject(Database) private readonly db: Database) {}

  async get(auth: AuthContext, q: ScorecardQuery): Promise<Scorecard> {
    return this.db.tenant(auth.tenant!.id, async (trx) => {
      const rows = await trx.selectFrom("shipments as s").innerJoin("orders as o", "o.id", "s.order_id")
        .select([
          "s.provider",
          sql<string | null>`nullif(trim(coalesce(o.ship_province, o.ship_city)), '')`.as("zone"),
          sql<string>`count(*)`.as("shipments"),
          sql<string>`count(*) filter (where s.status = 'delivered')`.as("delivered"),
          sql<string>`count(*) filter (where s.status in ('returned', 'returning'))`.as("returned"),
          sql<string>`count(*) filter (where s.status not in ('delivered', 'returned', 'returning', 'cancelled', 'lost'))`.as("in_flight"),
          sql<number | null>`sum(greatest(0, extract(epoch from (s.status_at - coalesce(s.booked_at, s.created_at)))) / 86400) filter (where s.status = 'delivered' and s.status_at is not null)`.as("days_sum"),
          sql<string>`count(*) filter (where s.status = 'delivered' and s.status_at is not null)`.as("days_n"),
        ])
        .where("s.booking", "=", "booked").where("s.is_return_leg", "=", false)
        .where("s.created_at", ">=", sql<Date>`now() - make_interval(days => ${q.days})`)
        .groupBy(["s.provider", sql`2`]).execute();

      const couriers = new Map<string, { total: Counts; zones: Map<string | null, Counts> }>();
      const zero = (): Counts => ({ shipments: 0n, delivered: 0n, returned: 0n, inFlight: 0n, daysSum: 0, daysN: 0n });
      const add = (a: Counts, r: (typeof rows)[number]) => {
        a.shipments += BigInt(r.shipments); a.delivered += BigInt(r.delivered); a.returned += BigInt(r.returned); a.inFlight += BigInt(r.in_flight);
        a.daysSum += Number(r.days_sum ?? 0); a.daysN += BigInt(r.days_n);
      };
      for (const r of rows) {
        const c = couriers.get(r.provider) ?? { total: zero(), zones: new Map() };
        couriers.set(r.provider, c);
        add(c.total, r);
        const z = c.zones.get(r.zone) ?? zero();
        c.zones.set(r.zone, z);
        add(z, r);
      }
      const stats = (c: Counts) => ({
        shipments: Number(c.shipments), delivered: Number(c.delivered), returned: Number(c.returned), inFlight: Number(c.inFlight),
        deliveredRate: deliveredRate(c.delivered, c.returned), rtoRate: percent(c.returned, c.delivered + c.returned),
        avgDaysToDeliver: c.daysN > 0n ? (c.daysSum / Number(c.daysN)).toFixed(1) : null,
      });
      return {
        days: q.days,
        couriers: [...couriers].sort((a, b) => Number(b[1].total.shipments - a[1].total.shipments) || a[0].localeCompare(b[0])).map(([courier, c]) => ({
          courier, ...stats(c.total),
          zones: [...c.zones].sort((a, b) => Number(b[1].shipments - a[1].shipments) || String(a[0]).localeCompare(String(b[0]))).map(([zone, z]) => ({ zone, ...stats(z) })),
        })),
      };
    });
  }
}
