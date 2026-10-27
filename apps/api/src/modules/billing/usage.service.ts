import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { monthOf, monthStart, PLAN_LIMITS, previousMonth, type Plan } from "./plans.js";
import type { Usage } from "./usage.dto.js";

type Trx = Transaction<DB>;
export interface MonthUsage { orders: number; whatsappMessages: number; aiOffers: number; stores: number; users: number }

/**
 * Usage per store per month (E12-3): orders placed (every channel; the plan's main meter),
 * WhatsApp messages sent and offers Claude wrote (passed on at cost), and the stores and users
 * the plan counts. The live month is counted from the source tables, in the store's time zone;
 * a month that is over is frozen in `usage_months` (UsageCloser), so its numbers never move.
 */
@Injectable()
export class UsageService {
  constructor(@Inject(Database) private readonly db: Database) {}

  async get(auth: AuthContext, month?: string): Promise<Usage> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const t = await trx.selectFrom("tenants").select(["plan", "timezone"]).where("id", "=", tenantId).executeTakeFirstOrThrow();
      const current = monthOf(new Date(), t.timezone);
      const first = (month && monthStart(month)) || current;
      const frozen = await trx.selectFrom("usage_months").selectAll().where("month", "=", new Date(`${first}T00:00:00Z`)).executeTakeFirst();
      const usage = frozen
        ? { orders: frozen.orders, whatsappMessages: frozen.whatsapp_messages, aiOffers: frozen.ai_offers, stores: frozen.stores, users: frozen.users }
        : await this.count(trx, first, t.timezone);
      const months = [current];
      for (let i = 0; i < 5; i++) months.push(previousMonth(months.at(-1)!));
      const closed = new Map((await trx.selectFrom("usage_months").selectAll().where("month", "in", months.map((m) => new Date(`${m}T00:00:00Z`))).execute())
        .map((r) => [r.month.toISOString().slice(0, 10), r]));
      const live = await this.series(trx, months.at(-1)!, t.timezone);
      const plan = t.plan as Plan;
      return {
        month: first.slice(0, 7), timezone: t.timezone, plan, closed: Boolean(frozen), usage, limits: PLAN_LIMITS[plan],
        history: months.map((m) => {
          const c = closed.get(m);
          const l = live.get(m);
          return c
            ? { month: m.slice(0, 7), orders: c.orders, whatsappMessages: c.whatsapp_messages, aiOffers: c.ai_offers, closed: true }
            : { month: m.slice(0, 7), orders: l?.orders ?? 0, whatsappMessages: l?.whatsappMessages ?? 0, aiOffers: l?.aiOffers ?? 0, closed: false };
        }),
      };
    });
  }

  /** One month's usage, counted now (`first` = its first day, in the store's time zone). */
  async count(trx: Trx, first: string, timezone: string): Promise<MonthUsage> {
    const s = (await this.series(trx, first, timezone, first)).get(first);
    const stores = await trx.selectFrom("connections").select(sql<string>`count(*)`.as("n")).where("kind", "=", "store").where("status", "=", "active").executeTakeFirstOrThrow();
    const users = await trx.selectFrom("memberships").select(sql<string>`count(*)`.as("n")).where("status", "=", "active").executeTakeFirstOrThrow();
    return { orders: s?.orders ?? 0, whatsappMessages: s?.whatsappMessages ?? 0, aiOffers: s?.aiOffers ?? 0, stores: Number(stores.n), users: Number(users.n) };
  }

  /** Orders, messages and AI offers per month from `from` (to `to` if given), in the store's time zone. */
  private async series(trx: Trx, from: string, timezone: string, to?: string) {
    const start = sql`(${from}::date)::timestamp AT TIME ZONE ${timezone}`;
    const end = to ? sql`((${to}::date + interval '1 month')::timestamp AT TIME ZONE ${timezone})` : sql`'infinity'::timestamptz`;
    const month = (col: string) => sql<string>`to_char(date_trunc('month', ${sql.ref(col)} AT TIME ZONE ${timezone}), 'YYYY-MM-DD')`;
    const [orders, messages, offers] = await Promise.all([
      trx.selectFrom("orders").select([month("placed_at").as("m"), sql<string>`count(*)`.as("n")]).where(sql<boolean>`placed_at >= ${start} and placed_at < ${end}`).groupBy("m").execute(),
      trx.selectFrom("whatsapp_messages").select([month("created_at").as("m"), sql<string>`count(*)`.as("n")])
        .where("direction", "=", "out").where("status", "!=", "failed").where(sql<boolean>`created_at >= ${start} and created_at < ${end}`).groupBy("m").execute(),
      trx.selectFrom("order_offers").select([month("created_at").as("m"), sql<string>`count(*)`.as("n")])
        .where("source", "=", "ai").where(sql<boolean>`created_at >= ${start} and created_at < ${end}`).groupBy("m").execute(),
    ]);
    const out = new Map<string, { orders: number; whatsappMessages: number; aiOffers: number }>();
    const at = (m: string) => out.get(m) ?? (out.set(m, { orders: 0, whatsappMessages: 0, aiOffers: 0 }), out.get(m)!);
    for (const r of orders) at(r.m).orders = Number(r.n);
    for (const r of messages) at(r.m).whatsappMessages = Number(r.n);
    for (const r of offers) at(r.m).aiOffers = Number(r.n);
    return out;
  }
}
