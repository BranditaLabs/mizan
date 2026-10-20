import { randomUUID } from "node:crypto";

/**
 * Durable state the engine needs to never lose or double-apply work:
 *
 * - inbound event keys  → each webhook processed once, however often it arrives
 * - outbox jobs         → every outbound write is a job: retried with backoff,
 *                         leased so a crashed worker's job is picked up again,
 *                         deduplicated by idempotency key, and parked in a
 *                         dead-letter state (replayable) when it cannot succeed
 * - records             → canonical orders, shipments, sync snapshots, cursors
 *
 * Two implementations share this contract: MemoryStore (tests, demo) and
 * SqlStore (PostgreSQL in production; PGlite in tests).
 */

export type JobStatus = "pending" | "running" | "done" | "dead";

export interface OutboxJob<P = unknown> {
  id: string;
  kind: string;
  connection: string;
  payload: P;
  idempotencyKey: string;
  status: JobStatus;
  attempts: number;
  nextAttemptAt: number;
  lockedUntil: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface NewJob<P = unknown> {
  kind: string;
  connection: string;
  payload: P;
  idempotencyKey: string;
  runAt?: number;
}

export interface Store {
  /** Returns true the first time a key is seen. */
  markInbound(key: string, at: number): Promise<boolean>;

  /** Enqueue unless a job with the same idempotency key exists; returns the existing job then. */
  enqueue<P>(job: NewJob<P>, now: number): Promise<{ job: OutboxJob<P>; created: boolean }>;
  claimDue(now: number, limit: number, leaseMs: number): Promise<OutboxJob[]>;
  complete(id: string, now: number): Promise<void>;
  retryLater(id: string, error: string, at: number, now: number): Promise<void>;
  bury(id: string, error: string, now: number): Promise<void>;
  replay(id: string, now: number): Promise<boolean>;
  jobs(filter?: { status?: JobStatus; kind?: string }): Promise<OutboxJob[]>;

  get<T>(type: string, key: string): Promise<T | undefined>;
  put<T>(type: string, key: string, value: T, now: number): Promise<void>;
  list<T>(type: string): Promise<Array<{ key: string; value: T }>>;
}

export class MemoryStore implements Store {
  private inbound = new Map<string, number>();
  private outbox = new Map<string, OutboxJob>();
  private byKey = new Map<string, string>();
  private records = new Map<string, Map<string, unknown>>();

  async markInbound(key: string, at: number) {
    if (this.inbound.has(key)) return false;
    this.inbound.set(key, at);
    return true;
  }

  async enqueue<P>(j: NewJob<P>, now: number) {
    const existingId = this.byKey.get(j.idempotencyKey);
    if (existingId) return { job: structuredClone(this.outbox.get(existingId)!) as OutboxJob<P>, created: false };
    const job: OutboxJob<P> = {
      id: randomUUID(), kind: j.kind, connection: j.connection, payload: structuredClone(j.payload), idempotencyKey: j.idempotencyKey,
      status: "pending", attempts: 0, nextAttemptAt: j.runAt ?? now, lockedUntil: null, lastError: null, createdAt: now, updatedAt: now,
    };
    this.outbox.set(job.id, job as OutboxJob);
    this.byKey.set(j.idempotencyKey, job.id);
    return { job: structuredClone(job), created: true };
  }

  async claimDue(now: number, limit: number, leaseMs: number) {
    const due = [...this.outbox.values()]
      .filter((j) => (j.status === "pending" || (j.status === "running" && (j.lockedUntil ?? 0) < now)) && j.nextAttemptAt <= now)
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
      .slice(0, limit);
    for (const j of due) {
      j.status = "running";
      j.attempts += 1;
      j.lockedUntil = now + leaseMs;
      j.updatedAt = now;
    }
    return due.map((j) => structuredClone(j));
  }

  async complete(id: string, now: number) {
    const j = this.outbox.get(id);
    if (j) Object.assign(j, { status: "done", lockedUntil: null, lastError: null, updatedAt: now });
  }

  async retryLater(id: string, error: string, at: number, now: number) {
    const j = this.outbox.get(id);
    if (j) Object.assign(j, { status: "pending", lockedUntil: null, lastError: error, nextAttemptAt: at, updatedAt: now });
  }

  async bury(id: string, error: string, now: number) {
    const j = this.outbox.get(id);
    if (j) Object.assign(j, { status: "dead", lockedUntil: null, lastError: error, updatedAt: now });
  }

  async replay(id: string, now: number) {
    const j = this.outbox.get(id);
    if (!j || j.status !== "dead") return false;
    Object.assign(j, { status: "pending", attempts: 0, nextAttemptAt: now, updatedAt: now });
    return true;
  }

  async jobs(filter: { status?: JobStatus; kind?: string } = {}) {
    return [...this.outbox.values()]
      .filter((j) => (!filter.status || j.status === filter.status) && (!filter.kind || j.kind === filter.kind))
      .map((j) => structuredClone(j));
  }

  async get<T>(type: string, key: string) {
    const v = this.records.get(type)?.get(key);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }

  async put<T>(type: string, key: string, value: T) {
    if (!this.records.has(type)) this.records.set(type, new Map());
    this.records.get(type)!.set(key, structuredClone(value));
  }

  async list<T>(type: string) {
    return [...(this.records.get(type)?.entries() ?? [])].map(([key, value]) => ({ key, value: structuredClone(value) as T }));
  }
}
