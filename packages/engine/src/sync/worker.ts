import { IntegrationError, isIntegrationError } from "../core/errors.js";
import type { Runtime } from "../core/runtime.js";
import { SchemaDriftError } from "../adapt/resolve.js";
import { backoffDelay, JOB_BACKOFF, type BackoffPolicy } from "../resilience/backoff.js";
import type { OutboxJob, Store } from "./store.js";

export type JobHandler = (job: OutboxJob<any>) => Promise<void>;

export interface WorkerOptions {
  batchSize: number;
  leaseMs: number;
  maxAttempts: number;
  backoff: BackoffPolicy;
}

export const DEFAULT_WORKER: WorkerOptions = { batchSize: 20, leaseMs: 120_000, maxAttempts: 12, backoff: JOB_BACKOFF };

export type JobOutcome =
  | { type: "done"; job: OutboxJob }
  | { type: "retry"; job: OutboxJob; at: number; error: IntegrationError }
  | { type: "dead"; job: OutboxJob; error: IntegrationError | Error };

/**
 * Runs outbox jobs. Every failure is classified:
 *   retryable (rate limit, 5xx, timeout, conflict, provider down)
 *       → rescheduled with jittered backoff, honouring Retry-After
 *   not retryable (validation, auth, missing permission, schema drift)
 *       → dead-letter immediately with the reason, ready for replay after a fix
 *   too many attempts → dead-letter
 * A handler never needs its own retry loop.
 */
export class OutboxWorker {
  private readonly listeners: Array<(o: JobOutcome) => void> = [];

  constructor(
    private readonly store: Store,
    private readonly rt: Runtime,
    private readonly handlers: Record<string, JobHandler>,
    private readonly opts: WorkerOptions = DEFAULT_WORKER,
  ) {}

  onOutcome(l: (o: JobOutcome) => void) {
    this.listeners.push(l);
  }

  /** Process one batch of due jobs. Returns how many ran. */
  async tick(): Promise<number> {
    const now = this.rt.clock.now();
    const jobs = await this.store.claimDue(now, this.opts.batchSize, this.opts.leaseMs);
    for (const job of jobs) await this.run(job);
    return jobs.length;
  }

  private async run(job: OutboxJob) {
    const handler = this.handlers[job.kind];
    const now = () => this.rt.clock.now();
    if (!handler) {
      const err = new Error(`no handler for job kind "${job.kind}"`);
      await this.store.bury(job.id, err.message, now());
      return this.emit({ type: "dead", job, error: err });
    }
    try {
      await handler(job);
      await this.store.complete(job.id, now());
      this.emit({ type: "done", job });
    } catch (raw) {
      const err = classify(raw);
      const exhausted = job.attempts >= this.opts.maxAttempts;
      if (err.retryable && !exhausted) {
        const at = now() + Math.max(err.retryAfterMs ?? 0, backoffDelay(job.attempts - 1, this.rt.random, this.opts.backoff));
        await this.store.retryLater(job.id, `${err.kind}: ${err.message}`, at, now());
        this.rt.logger.log("warn", "job will retry", { kind: job.kind, attempts: job.attempts, errorKind: err.kind, inMs: at - now() });
        return this.emit({ type: "retry", job, at, error: err });
      }
      const reason = exhausted ? `gave up after ${job.attempts} attempts — ${err.kind}: ${err.message}` : `${err.kind}: ${err.message}`;
      await this.store.bury(job.id, reason, now());
      this.rt.logger.log("error", "job dead-lettered", { kind: job.kind, reason });
      this.emit({ type: "dead", job, error: err });
    }
  }

  private emit(o: JobOutcome) {
    for (const l of this.listeners) l(o);
  }
}

function classify(e: unknown): IntegrationError {
  if (isIntegrationError(e)) return e;
  if (e instanceof SchemaDriftError) {
    return new IntegrationError({ kind: "schema_drift", connector: e.connector, message: e.message, details: { field: e.field, tried: e.tried } });
  }
  const msg = e instanceof Error ? e.message : String(e);
  return new IntegrationError({ kind: "permanent", connector: "engine", message: msg, cause: e });
}
