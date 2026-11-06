import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { APP_CONFIG, runsWorkerInProcess, type AppConfig } from "../../platform/config.js";
import { Database } from "../../platform/db/database.js";
import { SubscriptionService } from "./subscription.service.js";

/** How many due subscriptions one tick handles. */
export const SCHEDULER_BATCH = 100;

/**
 * billing.scheduler (E12-2a3, the minimal one; E12-2d adds reminders, dunning and renewals):
 * every 5 minutes, ends every trial whose trial_ends_at has passed, applying `end_of_trial`
 * (downgrade_free, D3). Each store is handled in its own transaction, the row locked with SKIP
 * LOCKED and version-checked, so two workers never end one trial twice and a re-run changes
 * nothing. Nothing here touches orders, webhooks or courier sync: they never stop.
 */
@Injectable()
export class BillingScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("BillingScheduler");
  private timer?: NodeJS.Timeout;
  private running?: Promise<unknown>;

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(SubscriptionService) private readonly subscriptions: SubscriptionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (runsWorkerInProcess(this.config)) this.start();
  }

  start(): void {
    if (this.timer) return;
    const tick = () => { this.running = this.runOnce().catch((err) => this.logger.error({ err }, "billing scheduler failed")); };
    this.timer = setInterval(tick, 5 * 60_000);
    this.timer.unref();
    setTimeout(tick, 30_000).unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  /** End the trials due at `now`. Returns how many ended. */
  async runOnce(now = new Date()): Promise<number> {
    let ended = 0;
    for (;;) {
      const due = await this.db.worker((trx) => trx.selectFrom("subscriptions").select(["id", "tenant_id"])
        .where("status", "=", "trialing").where("trial_ends_at", "<=", now).orderBy("trial_ends_at").limit(SCHEDULER_BATCH).execute());
      let done = 0;
      for (const d of due) {
        try {
          done += await this.db.tenant(d.tenant_id, async (trx) => {
            const sub = await trx.selectFrom("subscriptions").selectAll().where("id", "=", d.id).where("status", "=", "trialing")
              .where("trial_ends_at", "<=", now).forUpdate().skipLocked().executeTakeFirst();
            if (!sub) return 0; // another worker has it, or it changed (paid, extended)
            await this.subscriptions.endTrial(trx, d.tenant_id, sub);
            return 1;
          });
        } catch (err) {
          this.logger.error({ err, subscriptionId: d.id }, "could not end a trial; next tick retries");
        }
      }
      ended += done;
      if (due.length < SCHEDULER_BATCH || done === 0) return ended;
    }
  }
}
