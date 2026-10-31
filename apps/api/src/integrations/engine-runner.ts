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
 * Each cycle finds stores with due jobs (as mizan_worker, across tenants) and
 * starts one engine tick per store, without waiting for slow ones: a store
 * whose provider is throttling or hanging keeps its own tick in flight while
 * the others keep moving. Within a store, the engine's own worker claims
 * jobs (leases, retries, dead letters) through its RLS- and store-scoped store.
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

  /**
   * Stores with jobs due now (pending, or running with an expired lease), oldest first: one
   * engine per store (E2-7), keyed "tenant|store" ('' = rows written before stores were scoped).
   * Stores skipped for now (not connected) or already ticking are left out in SQL: otherwise
   * their old jobs would fill every slot of the LIMIT and starve active stores.
   */
  async dueStores(now = Date.now(), limit: number = ENGINE_RUN.tenantsPerCycle): Promise<Array<{ tenantId: string; store: string }>> {
    for (const [t, until] of this.skipUntil) if (until <= now) this.skipUntil.delete(t);
    const exclude = [...this.skipUntil.keys(), ...this.inFlight.keys()];
    const rows = await asWorker(this.db.kysely, (trx) => sql<{ tenant_id: string; scope: string }>`
      SELECT tenant_id, scope FROM mz_outbox
      WHERE next_attempt_at <= ${now} AND (status = 'pending' OR (status = 'running' AND locked_until < ${now}))
        AND NOT ((tenant_id::text || '|' || scope) = ANY(${exclude}::text[]))
      GROUP BY tenant_id, scope ORDER BY min(next_attempt_at) LIMIT ${limit}`.execute(trx));
    return rows.rows.map((r) => ({ tenantId: r.tenant_id, store: r.scope }));
  }

  /** Tenants with jobs due now (metrics and tests); see dueStores. */
  async dueTenants(now = Date.now(), limit: number = ENGINE_RUN.tenantsPerCycle): Promise<string[]> {
    return [...new Set((await this.dueStores(now, limit)).map((s) => s.tenantId))];
  }

  /** Start ticks for due stores that are not already ticking. Returns how many started. */
  async cycle(now = Date.now()): Promise<number> {
    let started = 0;
    for (const { tenantId, store } of await this.dueStores(now)) {
      const key = `${tenantId}|${store}`;
      if (this.inFlight.size >= ENGINE_RUN.concurrency) break;
      if (this.inFlight.has(key) || (this.skipUntil.get(key) ?? 0) > now) continue;
      const tick = this.tick(tenantId, store).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, tick);
      started++;
    }
    return started;
  }

  /** Wait for every tick in flight (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.inFlight.size) await Promise.allSettled([...this.inFlight.values()]);
  }

  isTicking(tenantId: string): boolean {
    return [...this.inFlight.keys()].some((k) => k.startsWith(`${tenantId}|`));
  }

  private async tick(tenantId: string, store: string): Promise<void> {
    try {
      const { engine } = await this.registry.get(tenantId, store || undefined);
      await engine.worker.tick();
    } catch (err) {
      if (err instanceof NotConnectedError) {
        this.skipUntil.set(`${tenantId}|${store}`, Date.now() + ENGINE_RUN.notConnectedBackoffMs);
        this.logger.warn({ tenantId, store, reason: err.detail }, "engine jobs waiting: store not connected");
      } else {
        this.logger.error({ err, tenantId, store }, "engine tick failed");
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
