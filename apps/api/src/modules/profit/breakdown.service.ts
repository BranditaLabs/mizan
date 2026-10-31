import { Inject, Injectable } from "@nestjs/common";
import { sql } from "kysely";
import { fromMinor } from "@mizan/shared";
import { Database } from "../../platform/db/database.js";
import { ProblemError } from "../../platform/http/problem.js";
import { aggregate, splitByLines, zeroComps, COMPONENTS, type BreakdownRow, type Dimension, type LineFact, type OrderFact, type Slice } from "./breakdown.js";
import { addDays, asDate, dayText, localDay, storeClock } from "./store-day.js";

/** Keys the screen names itself (in both languages); every other key is a store, courier, country or product. */
export const SPECIAL_KEYS = { manual: "manual", noCourier: "none", noCountry: "unknown", noProducts: "no_products" } as const;
const MAX_DAYS = 366;

/**
 * Profit breakdown (M5, E9-5): order_pnl over a range of store days (orders by the day they were
 * placed, base currency only, like the home), grouped by day, store, courier (the order's latest
 * shipment), country or product. Counts and money only, no customer data.
 */
@Injectable()
export class ProfitBreakdownService {
  constructor(@Inject(Database) private readonly db: Database) {}

  async breakdown(tenantId: string, q: { by: Dimension; days?: number | undefined; from?: string | undefined; to?: string | undefined }, now = new Date()) {
    return this.db.tenant(tenantId, async (trx) => {
      const { base, timezone } = await storeClock(trx, tenantId);
      const today = localDay(now, timezone);
      const to = q.to ?? today;
      const from = q.from ?? addDays(to, -((q.days ?? 30) - 1));
      if (from > to) throw new ProblemError(422, "validation_failed", "from must be on or before to", [{ path: "from", code: "range" }]);
      if (addDays(from, MAX_DAYS - 1) < to) throw new ProblemError(422, "validation_failed", `at most ${MAX_DAYS} days`, [{ path: "to", code: "range" }]);

      const rows = await trx.selectFrom("order_pnl as p").innerJoin("orders as o", "o.id", "p.order_id")
        .leftJoin("connections as c", "c.id", "o.connection_id")
        .leftJoinLateral((eb) => eb.selectFrom("shipments as s").select(["s.connection_id", "s.provider"]).whereRef("s.order_id", "=", "o.id").orderBy("s.created_at", "desc").limit(1).as("s"), (j) => j.onTrue())
        .select([
          "o.id", "o.status", "o.shipped_at", "o.connection_id", "o.ship_country", "c.provider as store_provider", "c.external_account", "s.connection_id as courier_id", "s.provider as courier",
          dayText("p.day").as("day"), ...COMPONENTS.map((k) => sql<string>`${sql.ref(`p.${k}_minor`)}`.as(k)),
        ])
        .where("p.day", ">=", asDate(from)).where("p.day", "<=", asDate(to)).where("p.currency", "=", base).execute();

      const facts = rows.map((r) => {
        const comps = zeroComps();
        for (const k of COMPONENTS) comps[k] = BigInt((r as unknown as Record<string, string>)[k]!);
        const fact: OrderFact = { orderId: r.id, delivered: r.status === "delivered", returned: r.status === "returned" || (r.status === "cancelled" && r.shipped_at !== null), comps };
        return { r, fact };
      });

      let slices: Slice[];
      if (q.by === "product") {
        const ids = facts.map((f) => f.r.id);
        const lines = ids.length ? await trx.selectFrom("order_lines as l").leftJoin("variants as v", "v.id", "l.variant_id").leftJoin("products as pr", "pr.id", "v.product_id")
          .select(["l.order_id", "l.variant_id", "l.title", "l.quantity", "l.unit_price_minor", "l.unit_cost_minor", "pr.title as product", "v.title as variant"])
          .where("l.order_id", "in", ids).orderBy("l.order_id").orderBy("l.external_line_id").execute() : [];
        const byOrder = new Map<string, LineFact[]>();
        for (const l of lines) {
          const label = l.product ? (l.variant ? `${l.product} — ${l.variant}` : l.product) : l.title;
          const q2 = BigInt(l.quantity);
          const list = byOrder.get(l.order_id) ?? [];
          list.push({ key: l.variant_id ?? `title:${l.title}`, label, valueMinor: BigInt(l.unit_price_minor) * q2, costMinor: BigInt(l.unit_cost_minor ?? 0) * q2 });
          byOrder.set(l.order_id, list);
        }
        slices = facts.flatMap(({ fact }) => splitByLines(fact, byOrder.get(fact.orderId) ?? [], { key: SPECIAL_KEYS.noProducts, label: SPECIAL_KEYS.noProducts }));
      } else {
        slices = facts.map(({ r, fact }) => {
          const [key, label] = q.by === "day" ? [r.day, r.day]
            : q.by === "store" ? (r.connection_id ? [r.connection_id, r.external_account ?? r.store_provider ?? r.connection_id] : [SPECIAL_KEYS.manual, SPECIAL_KEYS.manual])
            : q.by === "courier" ? (r.courier_id ? [r.courier_id, r.courier ?? r.courier_id] : [SPECIAL_KEYS.noCourier, SPECIAL_KEYS.noCourier])
            : r.ship_country?.trim() ? [r.ship_country.trim(), r.ship_country.trim()] : [SPECIAL_KEYS.noCountry, SPECIAL_KEYS.noCountry];
          return { key, label, ...fact };
        });
      }
      const { rows: out, total } = aggregate(slices, q.by);
      const money = (row: BreakdownRow) => ({
        key: row.key, label: row.label, special: (Object.values(SPECIAL_KEYS) as string[]).includes(row.key),
        orders: row.orders, delivered: row.delivered, returned: row.returned,
        revenue: fromMinor(row.revenue, base), productCost: fromMinor(row.productCost, base), shippingAndCod: fromMinor(row.shippingAndCod, base), ads: fromMinor(row.ads, base),
        returns: fromMinor(row.returns, base), team: fromMinor(row.team, base), fees: fromMinor(row.fees, base), net: fromMinor(row.net, base), expectedNet: fromMinor(row.expectedNet, base), margin: row.margin,
      });
      return { by: q.by, from, to, baseCurrency: base, rows: out.map(money), total: money(total) };
    });
  }
}
