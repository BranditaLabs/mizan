import { Inject, Injectable } from "@nestjs/common";
import type { Response } from "express";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { ProblemError } from "./problem.js";

interface Bucket {
  tokens: number;
  at: number;
}

export interface LimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until a token is available (when refused) or the bucket is full. */
  resetS: number;
}

/**
 * Token buckets in a bounded LRU map. Per instance: with N instances the
 * effective limit is up to N× — fine for abuse protection; plan quotas for
 * API keys are counted in the database (E12).
 */
export class TokenBuckets {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly perMinute: number,
    private readonly burst = perMinute,
    private readonly maxKeys = 100_000,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string): LimitResult {
    const rate = this.perMinute / 60_000; // tokens per ms
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.burst, at: t };
    b.tokens = Math.min(this.burst, b.tokens + (t - b.at) * rate);
    b.at = t;
    const allowed = b.tokens >= 1;
    if (allowed) b.tokens -= 1;
    // LRU: re-insert at the end; evict the oldest when full.
    this.buckets.delete(key);
    this.buckets.set(key, b);
    if (this.buckets.size > this.maxKeys) this.buckets.delete(this.buckets.keys().next().value!);
    const resetS = allowed ? Math.ceil((this.burst - b.tokens) / rate / 1000) : Math.ceil((1 - b.tokens) / rate / 1000);
    return { allowed, limit: this.burst, remaining: Math.max(0, Math.floor(b.tokens)), resetS };
  }

  get size(): number {
    return this.buckets.size;
  }
}

/** Per-IP (before sign-in is checked) and per-user limits (docs/05: RateLimit-Policy, RateLimit, Retry-After). */
@Injectable()
export class RateLimiter {
  private readonly ip?: TokenBuckets;
  private readonly user?: TokenBuckets;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    if (config.RATE_LIMIT_IP_PER_MIN > 0) this.ip = new TokenBuckets(config.RATE_LIMIT_IP_PER_MIN);
    if (config.RATE_LIMIT_USER_PER_MIN > 0) this.user = new TokenBuckets(config.RATE_LIMIT_USER_PER_MIN);
  }

  checkIp(ip: string | undefined, res: Response): void {
    if (this.ip) this.apply(this.ip.take(`ip:${ip ?? "unknown"}`), res, "ip");
  }

  checkUser(userId: string, res: Response): void {
    if (this.user) this.apply(this.user.take(`user:${userId}`), res, "user");
  }

  private apply(r: LimitResult, res: Response, policy: string): void {
    // The user policy is the one a client can act on; the IP check only speaks when it refuses.
    if (policy === "user" || !r.allowed) {
      res.setHeader("RateLimit-Policy", `${r.limit};w=60;policy="${policy}"`);
      res.setHeader("RateLimit", `limit=${r.limit}, remaining=${r.remaining}, reset=${r.resetS}`);
    }
    if (!r.allowed) {
      res.setHeader("Retry-After", String(Math.max(1, r.resetS)));
      throw new ProblemError(429, "rate_limited", `too many requests; retry in ${Math.max(1, r.resetS)} s`);
    }
  }
}
