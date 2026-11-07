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

/**
 * `dropped`: the connection ended while the job waited (FX-3a). Kept, never deleted, so the
 * Event Center can show it; the same idempotency key enqueued again (after a reconnect) revives it.
 */
export type JobStatus = "pending" | "running" | "done" | "dead" | "dropped";

export interface OutboxJob<P = unknown> {
  id: string;
  kind: string;
  /** Provider the job talks to ("shopify", "bosta"). */
  connection: string;
  /** Platform scope (SqlStore); undefined in MemoryStore. */
  tenantId?: string;
  connectionId?: string | null;
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

/** What `markAndEnqueue` did: `marked` false means the key was seen before (a duplicate) and nothing was queued. */
export interface IntakeResult {
  marked: boolean;
  jobs: Array<{ job: OutboxJob; created: boolean }>;
}

export interface Store {
  /** Returns true the first time a key is seen. */
  markInbound(key: string, at: number): Promise<boolean>;

  /**
   * FX-3a W1, atomic intake: mark the inbound key and enqueue its jobs as one unit. Either both
   * are saved or neither is, so a crash between the two never turns the provider's retry into a
   * "duplicate" whose work was never queued. A key seen before queues nothing.
   */
  markAndEnqueue(key: string, at: number, jobs: NewJob[], now: number): Promise<IntakeResult>;

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

  async markAndEnqueue(key: string, at: number, jobs: NewJob[], now: number): Promise<IntakeResult> {
    // Marked before the first await, so a concurrent delivery of the same key sees it (one is a
    // duplicate); unmarked again if an enqueue fails, so the provider's retry is processed.
    if (this.inbound.has(key)) return { marked: false, jobs: [] };
    this.inbound.set(key, at);
    const out: IntakeResult["jobs"] = [];
    try {
      for (const j of jobs) out.push(await this.enqueue(j, now));
    } catch (e) {
      this.inbound.delete(key);
      throw e;
    }
    return { marked: true, jobs: out };
  }

  async enqueue<P>(j: NewJob<P>, now: number) {
    const existingId = this.byKey.get(j.idempotencyKey);
    const existing = existingId ? this.outbox.get(existingId) : undefined;
    if (existing && existing.status === "dropped") {
      // A job dropped with its connection, asked for again (reconnected): it runs again, once the
      // lease of a run still in progress when it was dropped is over.
      Object.assign(existing, { status: "pending", attempts: 0, nextAttemptAt: Math.max(j.runAt ?? now, existing.lockedUntil ?? 0), lockedUntil: null, lastError: null, payload: structuredClone(j.payload), updatedAt: now });
      return { job: structuredClone(existing) as OutboxJob<P>, created: true };
    }
    if (existing) return { job: structuredClone(existing) as OutboxJob<P>, created: false };
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

  // The end of a run changes only a job still running: dropped stays dropped, revived is not the old run's (FX-3a).
  async complete(id: string, now: number) {
    const j = this.outbox.get(id);
    if (j?.status === "running") Object.assign(j, { status: "done", lockedUntil: null, lastError: null, updatedAt: now });
  }

  async retryLater(id: string, error: string, at: number, now: number) {
    const j = this.outbox.get(id);
    if (j?.status === "running") Object.assign(j, { status: "pending", lockedUntil: null, lastError: error, nextAttemptAt: at, updatedAt: now });
  }

  async bury(id: string, error: string, now: number) {
    const j = this.outbox.get(id);
    if (j?.status === "running") Object.assign(j, { status: "dead", lockedUntil: null, lastError: error, updatedAt: now });
  }

  async replay(id: string, now: number) {
    const j = this.outbox.get(id);
    if (!j || j.status !== "dead") return false;
    Object.assign(j, { status: "pending", attempts: 0, nextAttemptAt: now, updatedAt: now });
    return true;
  }

  /** Drop a provider's waiting jobs, as a disconnect does (tests; the platform does it in ConnectionLifecycle). */
  async dropWaiting(connection: string, reason: string, now: number) {
    let n = 0;
    for (const j of this.outbox.values()) {
      if (j.connection === connection && (j.status === "pending" || j.status === "running")) {
        Object.assign(j, { status: "dropped", lastError: reason, updatedAt: now }); // the lease kept, as in ConnectionLifecycle
        n++;
      }
    }
    return n;
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
