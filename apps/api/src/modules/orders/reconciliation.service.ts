import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { sql } from "kysely";
import { trxQueryClient } from "@mizan/db";
import { MizanEngine, SqlStore, type ReconcileResult } from "@mizan/engine";
import { APP_CONFIG, runsWorkerInProcess, type AppConfig } from "../../platform/config.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";

/** The store day is reconciled once this hour (store time) has passed: late webhooks have arrived by then. */
export const RECONCILE_AFTER_HOUR = 3;
const TICK_MS = 60 * 60_000;

/** A calendar day's bounds in a time zone, as UTC instants: [start, end). */
export function storeDayBounds(day: string, timeZone: string): { from: string; to: string } {
  const at = (d: string) => {
    // The offset at local midnight: format the UTC guess in the zone and correct by the difference.
    const guess = new Date(`${d}T00:00:00.000Z`);
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(guess).map((p) => [p.type, p.value]));
    const local = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
    return new Date(guess.getTime() - (local - guess.getTime())).toISOString();
  };
  const next = new Date(`${day}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { from: at(day), to: at(next.toISOString().slice(0, 10)) };
}

/**
 * Nightly reconciliation (M1, E5-8). Once a store day is over (03:00 store time), each connected
 * Shopify store gets one engine job for that day (keyed by day, so the hourly tick never doubles
 * it): the engine reads every order the store created that day and ingests the ones a lost webhook
 * never brought. Its result comes back here: Mizan counts its own orders for that store day and
 * records both; a gap left over emits `orders.reconciliation_gap` for ops.
 */
@Injectable()
export class ReconciliationService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("Reconciliation");
  private timer?: NodeJS.Timeout;
  private running?: Promise<unknown>;

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (runsWorkerInProcess(this.config)) this.start();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  start(): void {
    if (this.timer) return;
    const tick = () => { this.running = this.schedule().catch((err) => this.logger.error({ err }, "reconciliation scheduling failed")); };
    this.timer = setInterval(tick, TICK_MS);
    this.timer.unref();
    setTimeout(tick, 60_000).unref();
  }

  /** Queue yesterday's reconciliation for every active Shopify store whose day is over. */
  async schedule(now = new Date()): Promise<number> {
    const stores = await this.db.worker((trx) => trx.selectFrom("connections").select(["id", "tenant_id"])
      .where("provider", "=", "shopify").where("kind", "=", "store").where("status", "=", "active").execute());
    let queued = 0;
    for (const s of stores) {
      const created = await this.db.tenant(s.tenant_id, async (trx) => {
        const { timezone } = await trx.selectFrom("tenants").select("timezone").where("id", "=", s.tenant_id).executeTakeFirstOrThrow();
        const local = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" }).formatToParts(now);
        const part = (t: string) => local.find((p) => p.type === t)!.value;
        if (Number(part("hour")) < RECONCILE_AFTER_HOUR) return false;
        const today = new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00.000Z`);
        today.setUTCDate(today.getUTCDate() - 1);
        const day = today.toISOString().slice(0, 10);
        const store = new SqlStore(trxQueryClient(trx), { tenantId: s.tenant_id, connections: { shopify: s.id } });
        const r = await store.enqueue(MizanEngine.shopifyReconcileJob({ day, ...storeDayBounds(day, timezone) }), now.getTime());
        return r.created;
      });
      if (created) queued++;
    }
    return queued;
  }

  /** The engine's answer for a store day (hook onReconciled): count Mizan's own orders, record, alert on a gap. */
  async record(tenantId: string, connectionId: string, r: ReconcileResult, now = new Date()): Promise<{ gap: number }> {
    return this.db.tenant(tenantId, async (trx) => {
      const mine = await trx.selectFrom("orders").select(sql<string>`count(*)`.as("n"))
        .where("connection_id", "=", connectionId).where("placed_at", ">=", new Date(r.from)).where("placed_at", "<", new Date(r.to)).executeTakeFirstOrThrow();
      const row = { store_orders: r.seen, recovered: r.recovered, mizan_orders: Number(mine.n), checked_at: now };
      await trx.insertInto("order_reconciliations").values({ tenant_id: tenantId, connection_id: connectionId, day: sql<Date>`${r.day}::date`, ...row })
        .onConflict((oc) => oc.columns(["connection_id", "day"]).doUpdateSet(row)).execute();
      const gap = r.seen - row.mizan_orders;
      if (gap !== 0 || r.recovered > 0) {
        await this.events.emit(trx, {
          type: gap !== 0 ? "orders.reconciliation_gap" : "orders.reconciled", tenantId, entity: { type: "connection", id: connectionId }, actor: { type: "system" },
          data: { day: r.day, storeOrders: r.seen, mizanOrders: row.mizan_orders, recovered: r.recovered, gap },
        });
      }
      return { gap };
    });
  }
}
