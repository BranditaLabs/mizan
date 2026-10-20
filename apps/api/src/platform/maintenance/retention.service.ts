import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { sql } from "kysely";
import { asWorker } from "@mizan/db";
import { APP_CONFIG, runsWorkerInProcess, type AppConfig } from "../config.js";
import { Database } from "../db/database.js";

export interface RetentionResult {
  doneJobs: number;
  webhookKeys: number;
  dispatchedEvents: number;
  idempotencyKeys: number;
  shopifyInstalls: number;
}

const DAY = 86_400_000;

/**
 * Keeps the high-churn tables bounded (H-7). Deletes in batches by primary key,
 * a bounded number of batches per run, so pruning never holds long locks or
 * starves the request path. Never touches pending, running or dead work.
 *
 *   mz_outbox          done jobs older than RETENTION_JOBS_DAYS (7)
 *   mz_inbound_events  webhook dedupe keys older than RETENTION_WEBHOOK_KEYS_DAYS (14; providers retry ≤ 48 h)
 *   domain_events      dispatched events older than RETENTION_EVENTS_DAYS (30; delivery marks cascade)
 *   idempotency_keys   expired keys
 *   shopify_installs   claimed or expired pending installs (their sealed token is useless after that)
 */
@Injectable()
export class RetentionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("Retention");
  private timer?: NodeJS.Timeout;
  private running?: Promise<unknown>;

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (runsWorkerInProcess(this.config)) this.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  start(intervalMs = 10 * 60_000): void {
    if (this.timer) return;
    const tick = () => {
      this.running = this.runOnce().catch((err) => this.logger.error({ err }, "retention run failed"));
    };
    this.timer = setInterval(tick, intervalMs);
    this.timer.unref();
    setTimeout(tick, 30_000).unref(); // first pass shortly after start
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  async runOnce(now = Date.now(), batch = 5_000, maxBatches = 20): Promise<RetentionResult> {
    const c = this.config;
    const prune = async (statement: (limit: number) => ReturnType<typeof sql>) => {
      let total = 0;
      for (let i = 0; i < maxBatches; i++) {
        const r = await asWorker(this.db.kysely, (trx) => statement(batch).execute(trx));
        const n = Number(r.numAffectedRows ?? 0n);
        total += n;
        if (n < batch) break;
      }
      return total;
    };
    const result: RetentionResult = {
      doneJobs: await prune((n) => sql`DELETE FROM mz_outbox WHERE id IN (
        SELECT id FROM mz_outbox WHERE status = 'done' AND updated_at < ${now - c.RETENTION_JOBS_DAYS * DAY} LIMIT ${n})`),
      webhookKeys: await prune((n) => sql`DELETE FROM mz_inbound_events WHERE (tenant_id, key) IN (
        SELECT tenant_id, key FROM mz_inbound_events WHERE received_at < ${now - c.RETENTION_WEBHOOK_KEYS_DAYS * DAY} LIMIT ${n})`),
      dispatchedEvents: await prune((n) => sql`DELETE FROM domain_events WHERE id IN (
        SELECT id FROM domain_events WHERE dispatched_at < ${new Date(now - c.RETENTION_EVENTS_DAYS * DAY)} LIMIT ${n})`),
      idempotencyKeys: await prune((n) => sql`DELETE FROM idempotency_keys WHERE (actor_id, key) IN (
        SELECT actor_id, key FROM idempotency_keys WHERE expires_at < ${new Date(now)} LIMIT ${n})`),
      shopifyInstalls: await prune((n) => sql`DELETE FROM shopify_installs WHERE id IN (
        SELECT id FROM shopify_installs WHERE claimed_at IS NOT NULL OR expires_at < ${new Date(now)} LIMIT ${n})`),
    };
    if (Object.values(result).some((v) => v > 0)) this.logger.log(result, "retention pruned rows");
    return result;
  }
}
