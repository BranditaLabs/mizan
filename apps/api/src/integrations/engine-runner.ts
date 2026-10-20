import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { sql } from "kysely";
import { asWorker } from "@mizan/db";
import { APP_CONFIG, runsWorkerInProcess, type AppConfig } from "../platform/config.js";
import { Database } from "../platform/db/database.js";
import { NotConnectedError } from "./connection-resolver.js";
import { EngineRegistry } from "./engine-registry.js";

export const ENGINE_RUN = {
  /** Tenants ticking at the same time. */
  concurrency: 8,
  /** Tenants looked at per cycle. */
  tenantsPerCycle: 100,
  pollMs: 500,
  /** A tenant whose engine cannot be built (no store connected) is skipped this long. */
  notConnectedBackoffMs: 60_000,
} as const;

/**
 * Runs engine outbox jobs for every tenant.
 *
 * Each cycle finds tenants with due jobs (as mizan_worker, across tenants) and
 * starts one engine tick per tenant, without waiting for slow ones: a tenant
 * whose provider is throttling or hanging keeps its own tick in flight while
 * other tenants keep moving. Within a tenant, the engine's own worker claims
 * jobs (leases, retries, dead letters) through its RLS-scoped store.
 */
@Injectable()
export class EngineJobRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("EngineJobRunner");
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly skipUntil = new Map<string, number>();
  private running = false;
  private loop?: Promise<void>;
  private wake?: () => void;

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(EngineRegistry) private readonly registry: EngineRegistry,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (runsWorkerInProcess(this.config)) this.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  /** Tenants with jobs due now (pending, or running with an expired lease). */
  async dueTenants(now = Date.now(), limit: number = ENGINE_RUN.tenantsPerCycle): Promise<string[]> {
    const rows = await asWorker(this.db.kysely, (trx) => sql<{ tenant_id: string }>`
      SELECT tenant_id FROM mz_outbox
      WHERE next_attempt_at <= ${now} AND (status = 'pending' OR (status = 'running' AND locked_until < ${now}))
      GROUP BY tenant_id ORDER BY min(next_attempt_at) LIMIT ${limit}`.execute(trx));
    return rows.rows.map((r) => r.tenant_id);
  }

  /** Start ticks for due tenants that are not already ticking. Returns how many started. */
  async cycle(now = Date.now()): Promise<number> {
    let started = 0;
    for (const tenantId of await this.dueTenants(now)) {
      if (this.inFlight.size >= ENGINE_RUN.concurrency) break;
      if (this.inFlight.has(tenantId) || (this.skipUntil.get(tenantId) ?? 0) > now) continue;
      const tick = this.tick(tenantId).finally(() => this.inFlight.delete(tenantId));
      this.inFlight.set(tenantId, tick);
      started++;
    }
    return started;
  }

  /** Wait for every tick in flight (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.inFlight.size) await Promise.allSettled([...this.inFlight.values()]);
  }

  isTicking(tenantId: string): boolean {
    return this.inFlight.has(tenantId);
  }

  private async tick(tenantId: string): Promise<void> {
    try {
      const { engine } = await this.registry.get(tenantId);
      await engine.worker.tick();
    } catch (err) {
      if (err instanceof NotConnectedError) {
        this.skipUntil.set(tenantId, Date.now() + ENGINE_RUN.notConnectedBackoffMs);
        this.logger.warn({ tenantId, reason: err.detail }, "engine jobs waiting: store not connected");
      } else {
        this.logger.error({ err, tenantId }, "engine tick failed");
      }
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.logger.log("running engine jobs");
    this.loop = (async () => {
      while (this.running) {
        try {
          await this.cycle();
        } catch (err) {
          this.logger.error({ err }, "engine cycle failed");
        }
        if (this.running) {
          await new Promise<void>((resolve) => {
            this.wake = resolve;
            setTimeout(resolve, ENGINE_RUN.pollMs);
          });
        }
      }
    })();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.wake?.();
    await this.loop;
    await this.idle();
    this.logger.log("engine job runner stopped");
  }
}
