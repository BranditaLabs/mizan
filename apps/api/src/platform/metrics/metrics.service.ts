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
export interface QueueSnapshot {
  jobs: (readonly [string, number])[];
  oldestDueS: number;
  events: { pending: number; dead: number; oldestS: number };
}

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

  /** Signup → first order synced (E4-5): the onboarding's one number. Observed once per store. */
  readonly timeToFirstValue = new Histogram({
    name: "mizan_time_to_first_value_seconds", help: "Time from store signup to its first synced order",
    buckets: [300, 900, 3600, 4 * 3600, 86_400, 3 * 86_400, 7 * 86_400, 30 * 86_400], registers: [this.registry],
  });

  readonly fxRefresh = new Counter({
    name: "mizan_fx_refresh_total", help: "Daily FX feed refreshes by result (stored, failed)", labelNames: ["result"] as const, registers: [this.registry],
  });

  readonly confirmationSteps = new Counter({
    name: "mizan_confirmation_steps_total", help: "Automated confirmation steps by channel and result (sent, skipped, retry, failed)",
    labelNames: ["channel", "result"] as const, registers: [this.registry],
  });

  readonly aiOffers = new Counter({
    name: "mizan_ai_offer_total", help: "Claude offer picks by result (picked, worded, refusal, invalid, unsafe, error, late)", labelNames: ["result"] as const, registers: [this.registry],
  });

  readonly aiTokens = new Counter({
    name: "mizan_ai_tokens_total", help: "Claude tokens used for offers, input and output", labelNames: ["kind"] as const, registers: [this.registry],
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
    // Sampled first: prom-client runs every collect() at once, and the queue queries below
    // would otherwise show up as clients waiting for a connection.
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
      name: "mizan_outbox_jobs", help: "Engine outbox jobs by status (pending, running, dead)", labelNames: ["status"] as const, registers: [this.registry],
      async collect() {
        const q = await self.queues();
        // Always all three, so an alert never sits on an absent series.
        const counts = new Map(q.jobs);
        for (const status of ["pending", "running", "dead"]) this.set({ status }, counts.get(status) ?? 0);
      },
    });
    new Gauge({
      name: "mizan_outbox_oldest_due_seconds", help: "Age of the oldest due engine job (0 when none)", registers: [this.registry],
      async collect() {
        this.set((await self.queues()).oldestDueS);
      },
    });
    new Gauge({
      name: "mizan_domain_events", help: "Domain events not yet dispatched, and dead", labelNames: ["state"] as const, registers: [this.registry],
      async collect() {
        const q = await self.queues();
        this.set({ state: "pending" }, q.events.pending);
        this.set({ state: "dead" }, q.events.dead);
        this.set({ state: "oldest_pending_seconds" }, q.events.oldestS);
      },
    });
    new Gauge({
      name: "mizan_engine_circuits_open", help: "Open provider circuits across this instance's tenant engines", labelNames: ["provider"] as const, registers: [this.registry],
      collect() {
        for (const c of self.circuits()) this.set({ provider: c.provider }, c.open);
      },
    });
  }

  /** Circuit states per provider across this instance's store engines (the back office's health view reads the same). */
  circuits(): { provider: "shopify" | "bosta"; open: number; halfOpen: number; closed: number }[] {
    const out = { shopify: { open: 0, halfOpen: 0, closed: 0 }, bosta: { open: 0, halfOpen: 0, closed: 0 } };
    const bump = (c: { open: number; halfOpen: number; closed: number }, state: string) => {
      if (state === "open") c.open++; else if (state === "half_open") c.halfOpen++; else c.closed++;
    };
    for (const e of this.engines.all()) {
      bump(out.shopify, e.engine.shopify.health().circuit.state);
      bump(out.bosta, e.engine.bosta.health().circuit.state);
    }
    return [{ provider: "shopify", ...out.shopify }, { provider: "bosta", ...out.bosta }];
  }

  /** The queue numbers behind the outbox and domain-event gauges (A-4 shows exactly these). */
  snapshot(): Promise<QueueSnapshot> {
    return this.queues();
  }

  private inFlight?: Promise<QueueSnapshot>;

  /** One worker transaction (one connection) per scrape: the queue gauges collect together and share it. */
  private queues(): Promise<QueueSnapshot> {
    if (this.inFlight) return this.inFlight;
    const now = Date.now();
    const value = asWorker(this.db.kysely, async (trx) => {
      const jobs = await sql<{ status: string; n: string }>`
        SELECT status, count(*)::text AS n FROM mz_outbox WHERE status <> 'done' GROUP BY status`.execute(trx);
      const [due] = (await sql<{ due: string | null }>`
        SELECT min(next_attempt_at)::text AS due FROM mz_outbox WHERE status IN ('pending','running') AND next_attempt_at <= ${now}`.execute(trx)).rows;
      const [ev] = (await sql<{ pending: string; dead: string; oldest: Date | null }>`
        SELECT count(*) FILTER (WHERE dead_at IS NULL)::text AS pending,
               count(*) FILTER (WHERE dead_at IS NOT NULL)::text AS dead,
               min(occurred_at) FILTER (WHERE dead_at IS NULL) AS oldest
        FROM domain_events WHERE dispatched_at IS NULL`.execute(trx)).rows;
      return {
        jobs: jobs.rows.map((r) => [r.status, Number(r.n)] as const),
        oldestDueS: due?.due ? Math.max(0, (now - Number(due.due)) / 1000) : 0,
        events: { pending: Number(ev?.pending ?? 0), dead: Number(ev?.dead ?? 0), oldestS: ev?.oldest ? (now - new Date(ev.oldest).getTime()) / 1000 : 0 },
      };
    });
    this.inFlight = value;
    const clear = () => { this.inFlight = undefined; };
    value.then(clear, clear);
    return value;
  }

}
