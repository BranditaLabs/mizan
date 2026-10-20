import { IntegrationError } from "../core/errors.js";
import type { Clock } from "../core/runtime.js";

/**
 * Circuit breaker, one per provider connection.
 *
 * closed    – requests flow; consecutive failures are counted
 * open      – the provider is failing: fail fast for `openMs` instead of
 *             piling more load on it and tying up workers
 * half_open – let one trial request through; success closes, failure re-opens
 */
export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitOptions {
  failureThreshold: number;
  openMs: number;
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private openedAt = 0;
  private trialInFlight = false;

  constructor(
    private readonly name: string,
    private readonly clock: Clock,
    private readonly opts: CircuitOptions = { failureThreshold: 5, openMs: 30_000 },
  ) {}

  get status(): { state: CircuitState; failures: number; retryInMs: number } {
    this.refresh();
    const retryInMs = this.state === "open" ? Math.max(0, this.openedAt + this.opts.openMs - this.clock.now()) : 0;
    return { state: this.state, failures: this.failures, retryInMs };
  }

  private refresh() {
    if (this.state === "open" && this.clock.now() - this.openedAt >= this.opts.openMs) {
      this.state = "half_open";
      this.trialInFlight = false;
    }
  }

  /** Throws `circuit_open` if the call must not go out. */
  beforeRequest(): void {
    this.refresh();
    if (this.state === "open") {
      throw new IntegrationError({
        kind: "circuit_open",
        connector: this.name,
        message: `${this.name} is failing; requests paused`,
        retryAfterMs: this.status.retryInMs,
      });
    }
    if (this.state === "half_open") {
      if (this.trialInFlight) {
        throw new IntegrationError({ kind: "circuit_open", connector: this.name, message: `${this.name} trial request in progress`, retryAfterMs: 1_000 });
      }
      this.trialInFlight = true;
    }
  }

  onSuccess(): void {
    this.state = "closed";
    this.failures = 0;
    this.trialInFlight = false;
  }

  onFailure(): void {
    this.failures += 1;
    if (this.state === "half_open" || this.failures >= this.opts.failureThreshold) {
      this.state = "open";
      this.openedAt = this.clock.now();
      this.trialInFlight = false;
    }
  }

  /** Requests that ended for reasons that say nothing about provider health (e.g. validation). */
  onNeutral(): void {
    if (this.state === "half_open") this.onSuccess();
  }
}
