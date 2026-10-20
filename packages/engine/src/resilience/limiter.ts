import type { Clock } from "../core/runtime.js";

/**
 * Adaptive token bucket.
 *
 * - Requests spend tokens (1 per REST call, or the query cost for Shopify).
 * - The bucket refills continuously at `refillPerSec`.
 * - When a provider reports its real budget (Shopify's throttleStatus), the
 *   bucket re-syncs to the server's numbers instead of guessing.
 * - When a provider returns 429 without telling us its budget (Bosta), the
 *   refill rate is halved (multiplicative decrease) and then recovers slowly
 *   on success (additive increase), so the engine finds the real limit by
 *   itself and stays just under it.
 */
export interface BucketOptions {
  capacity: number;
  refillPerSec: number;
  /** Lowest refill rate the bucket may back off to. */
  minRefillPerSec?: number;
}

export class AdaptiveBucket {
  private tokens: number;
  private capacity: number;
  private refill: number;
  private readonly baseRefill: number;
  private readonly minRefill: number;
  private last: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly clock: Clock, opts: BucketOptions) {
    this.capacity = opts.capacity;
    this.tokens = opts.capacity;
    this.refill = opts.refillPerSec;
    this.baseRefill = opts.refillPerSec;
    this.minRefill = opts.minRefillPerSec ?? Math.max(0.1, opts.refillPerSec / 16);
    this.last = clock.now();
  }

  get snapshot() {
    this.top();
    return { tokens: Math.floor(this.tokens), capacity: this.capacity, refillPerSec: this.refill };
  }

  private top() {
    const now = this.clock.now();
    const elapsed = Math.max(0, now - this.last) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refill);
    this.last = now;
  }

  /** Wait until `cost` tokens are available, then spend them. Calls are served in order. */
  acquire(cost = 1): Promise<void> {
    const want = Math.min(cost, this.capacity);
    const run = async () => {
      for (;;) {
        this.top();
        if (this.tokens >= want) {
          this.tokens -= want;
          return;
        }
        const waitMs = Math.ceil(((want - this.tokens) / this.refill) * 1000);
        await this.clock.sleep(waitMs);
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Give back tokens when the real cost was lower than reserved. */
  refund(tokens: number) {
    if (tokens <= 0) return;
    this.top();
    this.tokens = Math.min(this.capacity, this.tokens + tokens);
  }

  /** Re-sync with the provider's own accounting. */
  syncFromServer(s: { available: number; capacity?: number; refillPerSec?: number }) {
    this.top();
    if (s.capacity && s.capacity > 0) this.capacity = s.capacity;
    if (s.refillPerSec && s.refillPerSec > 0) this.refill = s.refillPerSec;
    this.tokens = Math.max(0, Math.min(this.capacity, s.available));
  }

  /** 429 without budget info: halve the pace and empty the bucket. */
  onThrottled() {
    this.top();
    this.refill = Math.max(this.minRefill, this.refill / 2);
    this.tokens = 0;
  }

  /** Success: creep the pace back up toward the configured rate. */
  onSuccess() {
    if (this.refill < this.baseRefill) this.refill = Math.min(this.baseRefill, this.refill + this.baseRefill * 0.05);
  }
}
