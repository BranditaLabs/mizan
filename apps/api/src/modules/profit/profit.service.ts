import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { convertMoney, fromMinor, ratio, toMinor, type Money } from "@mizan/shared";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import { CostRulesService } from "./cost-rules.service.js";
import { FxService } from "./fx/fx.service.js";
import { computePnl, spreadShare, stageOf, type Pnl } from "./pnl.js";
import { asDate, dayText, localDay, storeClock } from "./store-day.js";

/** Orders recomputed at most per trigger in one transaction; the rest on the next trigger or POST /profit/recalculate. */
export const RECOMPUTE_BATCH = 2000;
const CONFIRMED = new Set(["confirmed", "shipped", "delivered", "returned"]);

/**
 * The profit service (M5, E9-2): gathers what is known about an order (amounts, its lines' locked
 * costs, payments, the cost rules and exchange rate of its day), runs `computePnl`, and keeps
 * order_pnl current. Called by the profit consumer on every order, payment, cost and rate change.
 */
@Injectable()
export class ProfitService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(CostRulesService) private readonly rules: CostRulesService,
    @Inject(FxService) private readonly fx: FxService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  /** Recompute one order's P&L in the caller's transaction; emits pnl.recomputed when a number changed. */
  async recompute(trx: Transaction<DB>, tenantId: string, orderId: string, now = new Date()): Promise<Pnl | null> {
    const o = await trx.selectFrom("orders").select([
      "id", "number", "status", "payment_mode", "currency", "total_minor", "cod_minor", "refunded_minor", "placed_at", "confirmed_at", "shipped_at", "connection_id", "ship_city",
    ]).where("id", "=", orderId).executeTakeFirst();
    if (!o) return null;
    const { base, timezone } = await storeClock(trx, tenantId);
    const day = localDay(o.placed_at, timezone);
    const currency = o.currency.trim();

    let rateToBase: string | null = "1";
    if (currency !== base) {
      const r = await this.fx.rate(trx, tenantId, base, currency, day);
      rateToBase = r.rate ? ratio("1", r.rate, 12) : null;
    }

    // Product costs are locked on the order's lines when it is confirmed; until then today's cost.
    const confirmed = Boolean(o.confirmed_at) || CONFIRMED.has(o.status);
    const lines = await trx.selectFrom("order_lines as l").leftJoin("variants as v", "v.id", "l.variant_id")
      .select(["l.id", "l.quantity", "l.unit_cost_minor", "l.cost_set_at", "v.cogs_minor", "v.cogs_set_at"]).where("l.order_id", "=", orderId).execute();
    const locked = new Map<string, bigint>();
    for (const l of lines) {
      if (l.cost_set_at) locked.set(l.id, BigInt(String(l.unit_cost_minor)));
      else if (confirmed && l.cogs_set_at) {
        await trx.updateTable("order_lines").set({ unit_cost_minor: l.cogs_minor ?? 0, cost_set_at: now }).where("id", "=", l.id).execute();
        locked.set(l.id, BigInt(String(l.cogs_minor ?? 0)));
      }
    }

    const payments = await trx.selectFrom("payments").select(["kind", "method", "amount_minor", "fee_minor", "fee_is_actual"])
      .where("order_id", "=", orderId).where("status", "=", "succeeded").execute();
    const shipment = await trx.selectFrom("shipments").select("provider").where("order_id", "=", orderId).where("is_return_leg", "=", false)
      .orderBy("created_at", "desc").executeTakeFirst();
    const courier = shipment?.provider ?? (await trx.selectFrom("connections").select("provider").where("kind", "=", "courier").where("status", "=", "active")
      .orderBy("created_at").executeTakeFirst())?.provider;
    const zone = o.ship_city?.trim().toLowerCase();

    const facts = { ...(o.connection_id ? { connectionId: o.connection_id } : {}) };
    const [packaging, agent, cod, rate] = await Promise.all([
      this.rules.resolve(trx, "packaging_per_order", facts, day),
      this.rules.resolve(trx, "agent_per_order", facts, day),
      this.rules.resolve(trx, "cod_fee_pct", courier ? { courier } : {}, day),
      courier ? this.rules.resolve(trx, "courier_rate", { courier, ...(zone ? { zone } : {}) }, day) : Promise.resolve(null),
    ]);
    const methods = [...new Set(payments.map((p) => p.method))];
    const fees = new Map<string, { pct: string; fixed: Money | null } | null>();
    for (const m of methods) {
      const r = await this.rules.resolve(trx, "payment_fee_pct", { method: m }, day);
      fees.set(m, r?.pct ? { pct: r.pct, fixed: r.fixed } : null);
    }

    const ads = o.connection_id ? await this.adsShare(trx, tenantId, { id: o.id, connectionId: o.connection_id }, day, base, timezone) : null;

    const pnl = computePnl({
      stage: stageOf(o.status, Boolean(o.shipped_at)), paymentMode: o.payment_mode, currency, base, rateToBase,
      totalMinor: BigInt(o.total_minor), codMinor: BigInt(o.cod_minor), refundedMinor: BigInt(o.refunded_minor), confirmed,
      lines: lines.map((l) => ({ quantity: l.quantity, unitCostMinor: locked.get(l.id) ?? (l.cogs_set_at ? BigInt(String(l.cogs_minor ?? 0)) : null) })),
      payments: payments.map((p) => ({ kind: p.kind, method: p.method, amountMinor: BigInt(p.amount_minor), feeMinor: BigInt(p.fee_minor ?? 0), feeIsActual: p.fee_is_actual })),
      rules: {
        packaging: packaging?.amount ?? null, agent: agent?.amount ?? null, codPct: cod?.pct ?? null,
        courier: rate ? { amount: rate.amount, returnAmount: rate.returnAmount } : null,
        paymentFee: (m) => fees.get(m) ?? null,
      },
      ...(ads ? { adsMinor: ads.minor, adsFxMissing: ads.fxMissing } : {}),
    });

    const row = {
      currency: pnl.currency, revenue_minor: pnl.revenue.toString(), refund_minor: pnl.refund.toString(), cogs_minor: pnl.cogs.toString(), shipping_minor: pnl.shipping.toString(),
      cod_fee_minor: pnl.codFee.toString(), payment_fee_minor: pnl.paymentFee.toString(), channel_fee_minor: pnl.channelFee.toString(), ads_minor: pnl.ads.toString(),
      agent_minor: pnl.agent.toString(), packaging_minor: pnl.packaging.toString(), rto_minor: pnl.rto.toString(), chargeback_minor: pnl.chargeback.toString(),
      expected_revenue_minor: pnl.expectedRevenue.toString(), expected_net_minor: pnl.expectedNet.toString(), is_final: pnl.isFinal, flags: pnl.flags,
    };
    const before = await trx.selectFrom("order_pnl").select(["net_minor", "expected_net_minor", "is_final", "currency"]).where("order_id", "=", orderId).executeTakeFirst();
    await trx.insertInto("order_pnl").values({ order_id: orderId, tenant_id: tenantId, day: asDate(day), fx_day: asDate(day), computed_at: now, ...row })
      .onConflict((oc) => oc.column("order_id").doUpdateSet({ ...row, day: asDate(day), fx_day: asDate(day), computed_at: now, version: sql`order_pnl.version + 1` })).execute();
    const changed = !before || BigInt(String(before.net_minor ?? 0)) !== pnl.net || BigInt(String(before.expected_net_minor)) !== pnl.expectedNet || before.is_final !== pnl.isFinal || before.currency.trim() !== pnl.currency;
    if (changed) {
      await this.events.emit(trx, {
        type: "pnl.recomputed", tenantId, entity: { type: "order", id: orderId }, actor: { type: "system" },
        data: { number: o.number, currency: pnl.currency, netMinor: pnl.net.toString(), expectedNetMinor: pnl.expectedNet.toString(), isFinal: pnl.isFinal, flags: pnl.flags },
      });
    }
    return pnl;
  }

  /**
   * This order's share of its store's ad spend for its day (E9-3): the day's spend in the base
   * currency (each currency at that day's rate), split over the store's orders placed that day
   * and not cancelled before shipping, in placing order. Null when the store spent nothing then.
   */
  async adsShare(trx: Transaction<DB>, tenantId: string, order: { id: string; connectionId: string }, day: string, base: string, timezone: string): Promise<{ minor: bigint; fxMissing: boolean } | null> {
    const spend = await trx.selectFrom("ad_spend").select(["currency", sql<string>`sum(spend_minor)`.as("minor")])
      .where("connection_id", "=", order.connectionId).where("day", "=", asDate(day)).groupBy("currency").execute();
    if (!spend.length) return null;
    let total = 0n;
    let fxMissing = false;
    for (const s of spend) {
      const cur = s.currency.trim();
      const minor = BigInt(s.minor);
      if (cur === base) { total += minor; continue; }
      const r = await this.fx.rate(trx, tenantId, base, cur, day);
      if (!r.rate) { fxMissing = true; continue; }
      total += toMinor(convertMoney(fromMinor(minor, cur), base, ratio("1", r.rate, 12)));
    }
    const ids = (await this.dayOrders(trx, order.connectionId, day, timezone)).map((r) => r.id);
    return { minor: spreadShare(total, ids.length, ids.indexOf(order.id)), fxMissing };
  }

  /** A store's orders placed on a store day that share its ad spend: all but those cancelled before shipping. */
  dayOrders(trx: Transaction<DB>, connectionId: string, day: string, timezone: string) {
    return trx.selectFrom("orders").select("id").where("connection_id", "=", connectionId)
      .where(sql<boolean>`placed_at >= (${day}::date::timestamp AT TIME ZONE ${timezone})`)
      .where(sql<boolean>`placed_at < ((${day}::date + 1)::timestamp AT TIME ZONE ${timezone})`)
      .where((eb) => eb.not(eb.and([eb("status", "=", "cancelled"), eb("shipped_at", "is", null)])))
      .orderBy("placed_at").orderBy("id").limit(RECOMPUTE_BATCH).execute();
  }

  /**
   * An order joined or left its day's split (created, cancelled): the other orders of that store
   * day get their new share. Nothing to do when the store spent nothing that day.
   */
  async respreadDayOf(trx: Transaction<DB>, tenantId: string, orderId: string, now = new Date()): Promise<number> {
    const o = await trx.selectFrom("orders").select(["connection_id", "placed_at"]).where("id", "=", orderId).executeTakeFirst();
    if (!o?.connection_id) return 0;
    const { timezone } = await storeClock(trx, tenantId);
    const day = localDay(o.placed_at, timezone);
    return this.respreadDay(trx, tenantId, o.connection_id, day, now);
  }

  /** Recompute a store day's orders after its spend or its orders changed (bounded). */
  async respreadDay(trx: Transaction<DB>, tenantId: string, connectionId: string, day: string, now = new Date()): Promise<number> {
    const any = await trx.selectFrom("ad_spend").select("day").where("connection_id", "=", connectionId).where("day", "=", asDate(day)).executeTakeFirst();
    const { timezone } = await storeClock(trx, tenantId);
    const ids = await this.dayOrders(trx, connectionId, day, timezone);
    // Without spend a share can only have been dropped: only orders still carrying one change.
    if (!ids.length) return 0;
    const targets = any ? ids.map((r) => r.id)
      : (await trx.selectFrom("order_pnl").select("order_id").where("order_id", "in", ids.map((r) => r.id)).where(sql<boolean>`ads_minor > 0`).execute()).map((r) => r.order_id);
    for (const id of targets) await this.recompute(trx, tenantId, id, now);
    return targets.length;
  }

  /** Recompute provisional orders matching a filter (a cost or rate change); bounded per call. */
  async recomputeOpen(trx: Transaction<DB>, tenantId: string, filter: { fromDay?: string; toDay?: string; variantIds?: string[]; currency?: string; day?: string }, now = new Date()) {
    const { timezone } = await storeClock(trx, tenantId);
    let q = trx.selectFrom("orders as o").leftJoin("order_pnl as p", "p.order_id", "o.id").select("o.id")
      .where((eb) => eb.or([eb("p.is_final", "is", null), eb("p.is_final", "=", false)]));
    const localDate = sql`(o.placed_at AT TIME ZONE ${timezone})::date`;
    if (filter.fromDay) q = q.where(sql<boolean>`${localDate} >= ${filter.fromDay}::date`);
    if (filter.toDay) q = q.where(sql<boolean>`${localDate} <= ${filter.toDay}::date`);
    if (filter.day) q = q.where(sql<boolean>`${localDate} = ${filter.day}::date`);
    if (filter.currency) q = q.where("o.currency", "=", filter.currency);
    if (filter.variantIds?.length) q = q.where("o.id", "in", trx.selectFrom("order_lines").select("order_id").where("variant_id", "in", filter.variantIds));
    const ids = await q.orderBy("o.placed_at", "desc").limit(RECOMPUTE_BATCH + 1).execute();
    for (const { id } of ids.slice(0, RECOMPUTE_BATCH)) await this.recompute(trx, tenantId, id, now);
    return { recomputed: Math.min(ids.length, RECOMPUTE_BATCH), truncated: ids.length > RECOMPUTE_BATCH };
  }

  /** One order's P&L for the order screen (computed now if it never was). */
  async orderPnl(auth: AuthContext, orderId: string) {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const exists = await trx.selectFrom("orders").select("id").where("id", "=", orderId).executeTakeFirst();
      if (!exists) throw new ProblemError(404, "not_found", "no such order in this store");
      let row = await this.row(trx, orderId);
      if (!row) {
        await this.recompute(trx, tenantId, orderId);
        row = await this.row(trx, orderId);
      }
      const r = row!;
      const cur = r.currency.trim();
      const m = (v: unknown) => fromMinor(BigInt(String(v ?? 0)), cur);
      return {
        currency: cur, day: r.day, isFinal: r.is_final, flags: r.flags, computedAt: r.computed_at.toISOString(),
        revenue: m(r.revenue_minor), refunds: m(r.refund_minor), productCost: m(r.cogs_minor), shipping: m(r.shipping_minor), codFee: m(r.cod_fee_minor),
        paymentFee: m(r.payment_fee_minor), channelFee: m(r.channel_fee_minor), ads: m(r.ads_minor), agent: m(r.agent_minor), packaging: m(r.packaging_minor),
        returns: m(r.rto_minor), chargebacks: m(r.chargeback_minor), net: m(r.net_minor), expectedRevenue: m(r.expected_revenue_minor), expectedNet: m(r.expected_net_minor),
      };
    });
  }

  async recalculate(auth: AuthContext, range: { from?: string; to?: string }) {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, (trx) => this.recomputeOpen(trx, tenantId, { ...(range.from ? { fromDay: range.from } : {}), ...(range.to ? { toDay: range.to } : {}) }));
  }

  private row(trx: Transaction<DB>, orderId: string) {
    return trx.selectFrom("order_pnl").selectAll().select(dayText("day").as("day")).where("order_id", "=", orderId).executeTakeFirst();
  }
}
