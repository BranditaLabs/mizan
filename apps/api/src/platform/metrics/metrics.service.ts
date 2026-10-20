import { Inject, Injectable } from "@nestjs/common";
import { sql } from "kysely";
import { asWorker, poolStats } from "@mizan/db";
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";
import { Database } from "../db/database.js";
import { EngineRegistry } from "../../integrations/engine-registry.js";

/**
 * Prometheus metrics (H-9). Labels are bounded: routes are templates
 * (/v1/members/:userId), never raw paths; nothing is labelled per tenant.
 * Queue gauges are computed at scrape time (one cheap indexed query each).
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpDuration = new Histogram({
    name: "mizan_http_request_duration_seconds",
    help: "HTTP request duration by route template and status class",
    labelNames: ["method", "route", "status"] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5, 10],
    registers: [this.registry],
  });

  readonly webhooks = new Counter({
    name: "mizan_webhooks_total", help: "Provider webhooks by provider and HTTP status",
    labelNames: ["provider", "status"] as const, registers: [this.registry],
  });

  readonly rateLimited = new Counter({
    name: "mizan_rate_limited_total", help: "Requests refused by a rate limit", labelNames: ["policy"] as const, registers: [this.registry],
  });

  readonly idempotentReplays = new Counter({
    name: "mizan_idempotent_replays_total", help: "Responses replayed for a repeated Idempotency-Key", registers: [this.registry],
  });

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(EngineRegistry) private readonly engines: EngineRegistry,
  ) {
    collectDefaultMetrics({ register: this.registry, prefix: "mizan_" });
    const self = this;
    new Gauge({
      name: "mizan_outbox_jobs", help: "Engine outbox jobs by status (pending, running, dead)", labelNames: ["status"] as const, registers: [this.registry],
      async collect() {
        const rows = await self.worker(sql<{ status: string; n: string }>`
          SELECT status, count(*)::text AS n FROM mz_outbox WHERE status <> 'done' GROUP BY status`);
        this.reset();
        for (const r of rows) this.set({ status: r.status }, Number(r.n));
      },
    });
    new Gauge({
      name: "mizan_outbox_oldest_due_seconds", help: "Age of the oldest due engine job (0 when none)", registers: [this.registry],
      async collect() {
        const [r] = await self.worker(sql<{ due: string | null }>`
          SELECT min(next_attempt_at)::text AS due FROM mz_outbox WHERE status IN ('pending','running') AND next_attempt_at <= ${Date.now()}`);
        this.set(r?.due ? Math.max(0, (Date.now() - Number(r.due)) / 1000) : 0);
      },
    });
    new Gauge({
      name: "mizan_domain_events", help: "Domain events not yet dispatched, and dead", labelNames: ["state"] as const, registers: [this.registry],
      async collect() {
        const [r] = await self.worker(sql<{ pending: string; dead: string; oldest: Date | null }>`
          SELECT count(*) FILTER (WHERE dispatched_at IS NULL AND dead_at IS NULL)::text AS pending,
                 count(*) FILTER (WHERE dead_at IS NOT NULL)::text AS dead,
                 min(occurred_at) FILTER (WHERE dispatched_at IS NULL AND dead_at IS NULL) AS oldest
          FROM domain_events WHERE dispatched_at IS NULL`);
        this.set({ state: "pending" }, Number(r?.pending ?? 0));
        this.set({ state: "dead" }, Number(r?.dead ?? 0));
        this.set({ state: "oldest_pending_seconds" }, r?.oldest ? (Date.now() - new Date(r.oldest).getTime()) / 1000 : 0);
      },
    });
    new Gauge({
      name: "mizan_db_pool_connections", help: "Database pool connections", labelNames: ["state"] as const, registers: [this.registry],
      collect() {
        const s = poolStats(self.db.kysely);
        if (!s) return;
        this.set({ state: "total" }, s.total);
        this.set({ state: "idle" }, s.idle);
        this.set({ state: "waiting" }, s.waiting);
      },
    });
    new Gauge({
      name: "mizan_engine_circuits_open", help: "Open provider circuits across this instance's tenant engines", labelNames: ["provider"] as const, registers: [this.registry],
      collect() {
        const open = { shopify: 0, bosta: 0 };
        for (const e of self.engines.all()) {
          if (e.engine.shopify.health().circuit.state === "open") open.shopify++;
          if (e.engine.bosta.health().circuit.state === "open") open.bosta++;
        }
        this.set({ provider: "shopify" }, open.shopify);
        this.set({ provider: "bosta" }, open.bosta);
      },
    });
  }

  private async worker<R>(q: ReturnType<typeof sql<R>>): Promise<R[]> {
    return (await asWorker(this.db.kysely, (trx) => q.execute(trx))).rows;
  }
}
