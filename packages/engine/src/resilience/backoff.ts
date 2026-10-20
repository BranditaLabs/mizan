/**
 * Exponential backoff with "full jitter": wait a random time between 0 and
 * base * 2^attempt (capped). Jitter stops many failing jobs from retrying in
 * lockstep and hammering a provider that is trying to recover.
 */
export interface BackoffPolicy {
  baseMs: number;
  maxMs: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = { baseMs: 250, maxMs: 30_000 };

export function backoffDelay(attempt: number, random: () => number, policy: BackoffPolicy = DEFAULT_BACKOFF): number {
  const ceiling = Math.min(policy.maxMs, policy.baseMs * 2 ** Math.max(0, attempt));
  return Math.round(random() * ceiling);
}

/** Longer schedule for background jobs (outbox): 30 s, 1 m, 2 m ... capped at 1 h. */
export const JOB_BACKOFF: BackoffPolicy = { baseMs: 30_000, maxMs: 3_600_000 };
