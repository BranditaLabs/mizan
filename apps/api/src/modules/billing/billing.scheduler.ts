import type { ExpressionBuilder } from "kysely";
import type { DB } from "@mizan/db";
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { APP_CONFIG, runsWorkerInProcess, type AppConfig } from "../../platform/config.js";
import { Database } from "../../platform/db/database.js";
import { SubscriptionService } from "./subscription.service.js";
import { TrialService } from "./trial.service.js";
import type { TrialIdentity } from "./trial-keys.js";

/** How many due subscriptions one tick handles. */
export const SCHEDULER_BATCH = 100;

/**
 * billing.scheduler (E12-2a3, the minimal one; E12-2d adds reminders, dunning and renewals):
 * every 5 minutes, ends every trial whose trial_ends_at has passed, applying `end_of_trial`
 * (downgrade_free, D3), a trial with a checkout open included. Each store is handled in its own transaction, the row locked with SKIP
 * LOCKED and version-checked, so two workers never end one trial twice and a re-run changes
 * nothing. Nothing here touches orders, webhooks or courier sync: they never stop.
 *
 * First, once after launch: the D18 backfill (migration 0080) gave existing stores a trial or a
 * comped plan but could not fill trials_used (the pepper lives only here), so each such store's
 * owner (account, email, phone) and connected shop domains are claimed now, and a
 * `trial_keys_claimed` history line makes sure it never runs again for that subscription.
 */
@Injectable()
export class BillingScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("BillingScheduler");
  private timer?: NodeJS.Timeout;
  private running?: Promise<unknown>;

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(SubscriptionService) private readonly subscriptions: SubscriptionService,
    @Inject(TrialService) private readonly trials: TrialService,
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

  /** Claim backfilled stores' trial keys (once), then end the trials due at `now`. Returns how many trials ended. */
  async runOnce(now = new Date()): Promise<number> {
    try {
      await this.claimBackfilledKeys();
    } catch (err) {
      this.logger.error({ err }, "could not claim backfilled trial keys; next tick retries");
    }
    let ended = 0;
    for (;;) {
      const due = await this.db.worker((trx) => trx.selectFrom("subscriptions").select(["id", "tenant_id"])
        .where(trialDue).where("trial_ends_at", "<=", now).orderBy("trial_ends_at").limit(SCHEDULER_BATCH).execute());
      let done = 0;
      for (const d of due) {
        try {
          done += await this.db.tenant(d.tenant_id, async (trx) => {
            const sub = await trx.selectFrom("subscriptions").selectAll().where("id", "=", d.id).where(trialDue)
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

  /**
   * The backfilled paid or trial subscriptions (D18) whose trial keys are not claimed yet: claim the
   * owners' account, email and phone and every connected shop domain, one key at a time (two old
   * stores sharing an owner or a shop both keep what they have; the second's refusal is ignored),
   * then append `trial_keys_claimed`. Safe to repeat and to run on two workers. Returns how many.
   */
  async claimBackfilledKeys(): Promise<number> {
    // Cheap once done: a partial index holds only the backfill and trial_keys_claimed lines.
    let claimed = 0;
    for (;;) {
      const due = await this.db.worker((trx) => trx.selectFrom("subscription_events as e").select(["e.subscription_id", "e.tenant_id"])
        .where("e.event", "=", "backfill").where("e.to_plan", "<>", "free")
        .where(({ not, exists, selectFrom }) => not(exists(selectFrom("subscription_events as m").select("m.subscription_id")
          .whereRef("m.subscription_id", "=", "e.subscription_id").where("m.event", "=", "trial_keys_claimed"))))
        .limit(SCHEDULER_BATCH).execute());
      let done = 0;
      for (const d of due) {
        try {
          done += await this.db.tenant(d.tenant_id, async (trx) => {
            const sub = await trx.selectFrom("subscriptions").selectAll().where("id", "=", d.subscription_id).forUpdate().skipLocked().executeTakeFirst();
            if (!sub) return 0; // another worker has it
            const marked = await trx.selectFrom("subscription_events").select("id").where("subscription_id", "=", sub.id).where("event", "=", "trial_keys_claimed").executeTakeFirst();
            if (marked) return 0;
            const owners = await trx.selectFrom("memberships as m").innerJoin("users as u", "u.id", "m.user_id").select(["u.id", "u.email", "u.phone_e164"])
              .where("m.tenant_id", "=", d.tenant_id).where("m.role", "=", "owner").execute();
            const shops = await trx.selectFrom("connections").select("external_account").where("kind", "=", "store")
              .where("status", "<>", "disconnected").where("external_account", "is not", null).execute();
            const keys: TrialIdentity[] = [
              ...owners.flatMap((o) => [{ userId: o.id }, ...(o.email ? [{ email: o.email }] : []), ...(o.phone_e164 ? [{ phone: o.phone_e164 }] : [])]),
              ...shops.map((c) => ({ shopDomain: c.external_account })),
            ];
            let refused = 0;
            for (const who of keys) if (!(await this.trials.claim(trx, d.tenant_id, who))) refused++;
            await this.subscriptions.note(trx, sub, "trial_keys_claimed", {
              actor: { type: "system" }, reason: "trial keys of a store that existed before subscriptions (D18)", data: { keys: keys.length, refused },
            });
            return 1;
          });
        } catch (err) {
          this.logger.error({ err, subscriptionId: d.subscription_id }, "could not claim a backfilled store's trial keys; next tick retries");
        }
      }
      claimed += done;
      if (due.length < SCHEDULER_BATCH || done === 0) return claimed;
    }
  }
}

/** A running trial, or one with a checkout open since the trial (it still ends at trial_ends_at). */
const trialDue = (eb: ExpressionBuilder<DB, "subscriptions">) =>
  eb.or([eb("status", "=", "trialing"), eb.and([eb("status", "=", "incomplete"), eb("previous_status", "=", "trialing")])]);
