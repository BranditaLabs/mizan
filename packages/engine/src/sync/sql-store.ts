import { randomUUID } from "node:crypto";
import type { JobStatus, NewJob, OutboxJob, Store } from "./store.js";

/**
 * PostgreSQL store. Works with any client exposing `query(text, params)`
 * returning `{ rows }`: `pg.Pool` standalone, PGlite in tests, and inside the
 * platform a client that runs each query in the tenant's RLS context.
 *
 * Every row belongs to one tenant (`scope.tenantId`): webhook keys,
 * idempotency keys and record keys are unique per tenant, so two stores
 * syncing the same Shopify order id never collide. Jobs also carry the
 * platform connection they act on (`scope.connections[provider]`).
 *
 * Job claiming uses `FOR UPDATE SKIP LOCKED`, so any number of workers can
 * run against one database without taking the same job twice, and a job
 * whose worker crashed is re-claimed when its lease expires.
 */
export interface SqlClient {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export interface StoreScope {
  tenantId: string;
  /** Platform connection id per provider ("shopify" → uuid); stored on each job. */
  connections?: Record<string, string>;
}

/** Tenant used by the standalone engine (src/server.ts), which serves a single store. */
export const STANDALONE_TENANT = "00000000-0000-0000-0000-000000000000";

/** Standalone schema. Inside the platform the same tables come from packages/db/migrations (0001, 0008). */
export const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS mz_inbound_events (
  tenant_id   UUID NOT NULL,
  key         TEXT NOT NULL,
  received_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS mz_outbox (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  connection_id   UUID,
  kind            TEXT NOT NULL,
  connection      TEXT NOT NULL,
  payload         JSONB NOT NULL,
  idempotency_key TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pending','running','done','dead')),
  attempts        INT NOT NULL DEFAULT 0,
  next_attempt_at BIGINT NOT NULL,
  locked_until    BIGINT,
  last_error      TEXT,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL,
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS mz_outbox_due ON mz_outbox (next_attempt_at) WHERE status IN ('pending','running');
CREATE INDEX IF NOT EXISTS mz_outbox_dead ON mz_outbox (updated_at) WHERE status = 'dead';

CREATE TABLE IF NOT EXISTS mz_records (
  tenant_id  UUID NOT NULL,
  type       TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      JSONB NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, type, key)
);
`;

type JobRow = {
  id: string; tenant_id: string; connection_id: string | null; kind: string; connection: string; payload: unknown; idempotency_key: string; status: JobStatus;
  attempts: number; next_attempt_at: string | number; locked_until: string | number | null; last_error: string | null;
  created_at: string | number; updated_at: string | number;
};

const toJob = (r: JobRow): OutboxJob => ({
  id: r.id, kind: r.kind, connection: r.connection, tenantId: r.tenant_id, connectionId: r.connection_id,
  payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
  idempotencyKey: r.idempotency_key, status: r.status, attempts: Number(r.attempts),
  nextAttemptAt: Number(r.next_attempt_at), lockedUntil: r.locked_until === null ? null : Number(r.locked_until),
  lastError: r.last_error, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
});

export class SqlStore implements Store {
  private readonly tenant: string;

  constructor(private readonly db: SqlClient, private readonly scope: StoreScope = { tenantId: STANDALONE_TENANT }) {
    this.tenant = scope.tenantId;
  }

  async migrate() {
    for (const stmt of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) await this.db.query(stmt);
  }

  async markInbound(key: string, at: number) {
    const r = await this.db.query(
      `INSERT INTO mz_inbound_events (tenant_id, key, received_at) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, key) DO NOTHING RETURNING key`,
      [this.tenant, key, at],
    );
    return r.rows.length === 1;
  }

  async enqueue<P>(j: NewJob<P>, now: number) {
    const id = randomUUID();
    const ins = await this.db.query<JobRow>(
      `INSERT INTO mz_outbox (id, tenant_id, connection_id, kind, connection, payload, idempotency_key, status, attempts, next_attempt_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',0,$8,$9,$9)
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING *`,
      [id, this.tenant, this.scope.connections?.[j.connection] ?? null, j.kind, j.connection, JSON.stringify(j.payload), j.idempotencyKey, j.runAt ?? now, now],
    );
    if (ins.rows.length) return { job: toJob(ins.rows[0]) as OutboxJob<P>, created: true };
    const ex = await this.db.query<JobRow>(`SELECT * FROM mz_outbox WHERE tenant_id = $1 AND idempotency_key = $2`, [this.tenant, j.idempotencyKey]);
    return { job: toJob(ex.rows[0]) as OutboxJob<P>, created: false };
  }

  async claimDue(now: number, limit: number, leaseMs: number) {
    const r = await this.db.query<JobRow>(
      `UPDATE mz_outbox SET status = 'running', attempts = attempts + 1, locked_until = $2, updated_at = $1
       WHERE id IN (
         SELECT id FROM mz_outbox
         WHERE tenant_id = $4 AND next_attempt_at <= $1
           AND (status = 'pending' OR (status = 'running' AND locked_until < $1))
         ORDER BY next_attempt_at
         LIMIT $3
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [now, now + leaseMs, limit, this.tenant],
    );
    return r.rows.map(toJob).sort((a, b) => a.nextAttemptAt - b.nextAttemptAt);
  }

  async complete(id: string, now: number) {
    await this.db.query(`UPDATE mz_outbox SET status='done', locked_until=NULL, last_error=NULL, updated_at=$2 WHERE id=$1 AND tenant_id=$3`, [id, now, this.tenant]);
  }

  async retryLater(id: string, error: string, at: number, now: number) {
    await this.db.query(`UPDATE mz_outbox SET status='pending', locked_until=NULL, last_error=$2, next_attempt_at=$3, updated_at=$4 WHERE id=$1 AND tenant_id=$5`, [id, error, at, now, this.tenant]);
  }

  async bury(id: string, error: string, now: number) {
    await this.db.query(`UPDATE mz_outbox SET status='dead', locked_until=NULL, last_error=$2, updated_at=$3 WHERE id=$1 AND tenant_id=$4`, [id, error, now, this.tenant]);
  }

  async replay(id: string, now: number) {
    const r = await this.db.query(`UPDATE mz_outbox SET status='pending', attempts=0, next_attempt_at=$2, updated_at=$2 WHERE id=$1 AND tenant_id=$3 AND status='dead' RETURNING id`, [id, now, this.tenant]);
    return r.rows.length === 1;
  }

  async jobs(filter: { status?: JobStatus; kind?: string } = {}) {
    const r = await this.db.query<JobRow>(
      `SELECT * FROM mz_outbox WHERE tenant_id = $3 AND ($1::text IS NULL OR status = $1) AND ($2::text IS NULL OR kind = $2) ORDER BY created_at`,
      [filter.status ?? null, filter.kind ?? null, this.tenant],
    );
    return r.rows.map(toJob);
  }

  async get<T>(type: string, key: string) {
    const r = await this.db.query<{ value: unknown }>(`SELECT value FROM mz_records WHERE tenant_id=$3 AND type=$1 AND key=$2`, [type, key, this.tenant]);
    if (!r.rows.length) return undefined;
    const v = r.rows[0].value;
    return (typeof v === "string" ? JSON.parse(v) : v) as T;
  }

  async put<T>(type: string, key: string, value: T, now: number) {
    await this.db.query(
      `INSERT INTO mz_records (tenant_id, type, key, value, updated_at) VALUES ($5,$1,$2,$3,$4)
       ON CONFLICT (tenant_id, type, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [type, key, JSON.stringify(value), now, this.tenant],
    );
  }

  async list<T>(type: string) {
    const r = await this.db.query<{ key: string; value: unknown }>(`SELECT key, value FROM mz_records WHERE tenant_id=$2 AND type=$1 ORDER BY key`, [type, this.tenant]);
    return r.rows.map((row) => ({ key: row.key, value: (typeof row.value === "string" ? JSON.parse(row.value) : row.value) as T }));
  }
}
