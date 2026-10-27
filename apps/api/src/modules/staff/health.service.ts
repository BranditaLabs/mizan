import { Inject, Injectable } from "@nestjs/common";
import { sql } from "kysely";
import { poolStats } from "@mizan/db";
import type { z } from "zod";
import { AuditService } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { ProblemError } from "../../platform/http/problem.js";
import { scrubText } from "../../platform/logging/redact.js";
import { MetricsService } from "../../platform/metrics/metrics.service.js";
import { EngineRegistry } from "../../integrations/engine-registry.js";
import type { DeadLettersQuerySchema, SystemHealthSchema } from "./health.dto.js";

/**
 * System health for the back office (A-4). The queue, event, circuit and pool numbers come from
 * the same code that feeds /metrics (MetricsService), so the two never disagree; the per-store
 * breakdown, dead letters and drift add what a person needs to act. Payloads and drift samples
 * stay out: they can carry customer data.
 */
@Injectable()
export class HealthService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(MetricsService) private readonly metrics: MetricsService,
    @Inject(EngineRegistry) private readonly engines: EngineRegistry,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async overview(): Promise<z.output<typeof SystemHealthSchema>> {
    const now = Date.now();
    const [q, staff] = await Promise.all([this.metrics.snapshot(), this.db.staff(async (trx) => {
      const stores = await sql<{ tenant_id: string; name: string; pending: string; running: string; dead: string; due: string | null }>`
        SELECT o.tenant_id, t.name,
               count(*) FILTER (WHERE o.status = 'pending')::text AS pending,
               count(*) FILTER (WHERE o.status = 'running')::text AS running,
               count(*) FILTER (WHERE o.status = 'dead')::text AS dead,
               min(o.next_attempt_at) FILTER (WHERE o.status IN ('pending','running') AND o.next_attempt_at <= ${now})::text AS due
        FROM mz_outbox o JOIN tenants t ON t.id = o.tenant_id
        WHERE o.status IN ('pending','running','dead')
        GROUP BY o.tenant_id, t.name
        ORDER BY count(*) FILTER (WHERE o.status = 'dead') DESC, count(*) DESC
        LIMIT 20`.execute(trx);
      const deadEvents = await trx.selectFrom("domain_events").select(["type", (eb) => eb.fn.countAll<string>().as("n")])
        .where("dispatched_at", "is", null).where("dead_at", "is not", null).groupBy("type").orderBy(sql`count(*)`, "desc").limit(50).execute();
      let size: number | null = null;
      let connections: number | null = null;
      try {
        const [r] = (await sql<{ size: string; conns: string }>`SELECT pg_database_size(current_database())::text AS size, (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::text AS conns`.execute(trx)).rows;
        size = r ? Number(r.size) : null;
        connections = r ? Number(r.conns) : null;
      } catch { /* not every Postgres (PGlite) exposes these */ }
      return { stores: stores.rows, deadEvents, size, connections };
    })]);
    const jobs = new Map(q.jobs);
    const pool = poolStats(this.db.kysely);
    const mem = process.memoryUsage();
    return {
      at: new Date(now).toISOString(),
      outbox: { pending: jobs.get("pending") ?? 0, running: jobs.get("running") ?? 0, dead: jobs.get("dead") ?? 0, oldestDueSeconds: q.oldestDueS },
      events: { pending: q.events.pending, dead: q.events.dead, oldestPendingSeconds: q.events.oldestS },
      deadEvents: staff.deadEvents.map((e) => ({ type: e.type, count: Number(e.n) })),
      circuits: this.metrics.circuits(),
      stores: staff.stores.map((s) => ({
        storeId: s.tenant_id, storeName: s.name, pending: Number(s.pending), running: Number(s.running), dead: Number(s.dead),
        oldestDueSeconds: s.due ? Math.max(0, (now - Number(s.due)) / 1000) : 0,
      })),
      drift: this.drift(),
      db: { pool: pool ? { total: pool.total, idle: pool.idle, waiting: pool.waiting } : null, sizeBytes: staff.size, connections: staff.connections },
      process: { uptimeSeconds: process.uptime(), rssBytes: mem.rss, heapUsedBytes: mem.heapUsed },
    };
  }

  async deadLetters(q: z.output<typeof DeadLettersQuerySchema>) {
    return this.db.staff(async (trx) => {
      let query = trx.selectFrom("mz_outbox as o").innerJoin("tenants as t", "t.id", "o.tenant_id")
        .select(["o.id", "o.tenant_id", "t.name", "o.kind", "o.connection", "o.attempts", "o.last_error", "o.updated_at"])
        .where("o.status", "=", "dead").orderBy("o.updated_at", "desc").limit(q.limit);
      if (q.storeId) query = query.where("o.tenant_id", "=", q.storeId);
      if (q.kind) query = query.where("o.kind", "=", q.kind);
      const rows = await query.execute();
      return {
        data: rows.map((j) => ({
          id: j.id, storeId: j.tenant_id, storeName: j.name, kind: j.kind, provider: j.connection, attempts: Number(j.attempts),
          error: j.last_error ? scrubText(j.last_error).slice(0, 300) : null, failedAt: new Date(Number(j.updated_at)).toISOString(),
        })),
      };
    });
  }

  /** Queue a dead-lettered job again, in its store's own context; the store sees it in its audit log. */
  async replay(auth: AuthContext, id: string) {
    const job = await this.db.staff((trx) => trx.selectFrom("mz_outbox").select(["tenant_id", "status"]).where("id", "=", id).executeTakeFirst());
    if (!job || job.status !== "dead") throw new ProblemError(404, "job_not_found", "no dead-lettered job with this id");
    const storeId = job.tenant_id;
    const replayed = await this.db.tenant(storeId, async (trx) => {
      const now = Date.now();
      const r = await trx.updateTable("mz_outbox").set({ status: "pending", attempts: 0, next_attempt_at: now, updated_at: now })
        .where("id", "=", id).where("status", "=", "dead").returning("id").executeTakeFirst();
      if (r) await this.audit.record(trx, { action: "integration.job_replayed", tenantId: storeId, actor: { type: "mizan_staff", id: auth.staff!.id }, entity: { type: "engine_job", id } });
      return Boolean(r);
    });
    if (!replayed) throw new ProblemError(404, "job_not_found", "no dead-lettered job with this id");
    return { replayed: true as const, storeId };
  }

  /** Drift across this instance's store engines: one row per issue, with how many stores see it. */
  private drift() {
    const merged = new Map<string, { connector: string; entity: string; kind: string; field: string | null; detail: string; count: number; stores: number; lastAt: number }>();
    for (const e of this.engines.all()) {
      for (const d of e.engine.drift.report()) {
        const key = `${d.connector}|${d.entity}|${d.kind}|${d.field ?? ""}|${d.kind === "unknown_status" ? d.detail : ""}`;
        const cur = merged.get(key);
        if (cur) { cur.count += d.count; cur.stores += 1; cur.lastAt = Math.max(cur.lastAt, d.lastAt); }
        else merged.set(key, { connector: d.connector, entity: d.entity, kind: d.kind, field: d.field ?? null, detail: scrubText(d.detail).slice(0, 300), count: d.count, stores: 1, lastAt: d.lastAt });
      }
    }
    return [...merged.values()].sort((a, b) => b.count - a.count).slice(0, 50).map((d) => ({ ...d, lastAt: new Date(d.lastAt).toISOString() }));
  }
}
