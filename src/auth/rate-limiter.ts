import { Injectable } from '@nestjs/common';

interface Bucket {
  count: number;
  resetAt: number;
}

export interface LimitStatus {
  blocked: boolean;
  retryAfterSeconds: number;
}

/**
 * Fixed-window counters kept in this process's memory.
 *
 * Known limits (deferred to Step 8, "hardening"): counters reset when the process restarts and are
 * not shared between several server instances; behind a reverse proxy every client shares the
 * proxy's address until `trust proxy` is configured. Memory is bounded: expired buckets are pruned
 * and the table is capped, so an attacker cannot grow it without limit.
 */
@Injectable()
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private static readonly MAX_BUCKETS = 50_000;

  /** Replaceable clock so tests can move time without waiting. */
  now: () => number = Date.now;

  status(key: string, max: number): LimitStatus {
    const bucket = this.live(key);
    if (bucket && bucket.count >= max) {
      return {
        blocked: true,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - this.now()) / 1000)),
      };
    }
    return { blocked: false, retryAfterSeconds: 0 };
  }

  /** Records one event in the window that starts now (or continues the current one). */
  record(key: string, windowMs: number): void {
    const bucket = this.live(key);
    if (bucket) {
      bucket.count += 1;
      return;
    }
    if (this.buckets.size >= RateLimiter.MAX_BUCKETS) this.prune();
    if (this.buckets.size >= RateLimiter.MAX_BUCKETS) {
      // Still full of live buckets: drop the oldest rather than grow.
      const oldest = this.buckets.keys().next().value;
      if (oldest !== undefined) this.buckets.delete(oldest);
    }
    this.buckets.set(key, { count: 1, resetAt: this.now() + windowMs });
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  private live(key: string): Bucket | undefined {
    const bucket = this.buckets.get(key);
    if (bucket && bucket.resetAt <= this.now()) {
      this.buckets.delete(key);
      return undefined;
    }
    return bucket;
  }

  private prune(): void {
    const now = this.now();
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
  }
}
