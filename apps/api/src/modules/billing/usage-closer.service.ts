import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { APP_CONFIG, runsWorkerInProcess, type AppConfig } from "../../platform/config.js";
import { Database } from "../../platform/db/database.js";
import { monthOf, previousMonth } from "./plans.js";
import { UsageService } from "./usage.service.js";

/**
 * Freezes each store's last month once it is over in the store's time zone (E12-3): counted
 * once, written once (the row is the proof), so invoices (E12-2) read numbers that never move.
 * Runs hourly in the worker; a missed hour is caught up by the next.
 */
@Injectable()
export class UsageCloser implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("UsageCloser");
  private timer?: NodeJS.Timeout;
  private running?: Promise<unknown>;

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(UsageService) private readonly usage: UsageService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (!runsWorkerInProcess(this.config)) return;
    const tick = () => { this.running = this.runOnce().catch((err) => this.logger.error({ err }, "usage close failed")); };
    this.timer = setInterval(tick, 60 * 60_000);
    this.timer.unref();
    setTimeout(tick, 60_000).unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  /** Close last month for every store that has not been closed yet. Returns how many were closed. */
  async runOnce(now = new Date()): Promise<number> {
    const tenants = await this.db.platform((trx) => trx.selectFrom("tenants").select(["id", "timezone", "plan"]).where("status", "in", ["trial", "active", "suspended"]).execute());
    let closed = 0;
    for (const t of tenants) {
      const month = previousMonth(monthOf(now, t.timezone));
      closed += await this.db.tenant(t.id, async (trx) => {
        const done = await trx.selectFrom("usage_months").select("month").where("month", "=", new Date(`${month}T00:00:00Z`)).executeTakeFirst();
        if (done) return 0;
        const u = await this.usage.count(trx, month, t.timezone);
        const r = await trx.insertInto("usage_months").values({
          tenant_id: t.id, month: new Date(`${month}T00:00:00Z`), orders: u.orders, whatsapp_messages: u.whatsappMessages, ai_offers: u.aiOffers, stores: u.stores, users: u.users, plan: t.plan,
        }).onConflict((oc) => oc.doNothing()).returning("month").executeTakeFirst();
        return r ? 1 : 0;
      });
    }
    return closed;
  }
}
