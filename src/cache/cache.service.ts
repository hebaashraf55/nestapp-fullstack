import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, Env } from '../config/env';

/** Bounded in-process store with per-entry expiry; the oldest entries go first when it is full. */
export class MemoryStore {
  private readonly map = new Map<string, { value: string; expires: number }>();
  constructor(private readonly max = 2000) {}
  now: () => number = Date.now;

  get(key: string): string | null {
    const hit = this.map.get(key);
    if (!hit) return null;
    if (hit.expires <= this.now()) {
      this.map.delete(key);
      return null;
    }
    return hit.value;
  }
  set(key: string, value: string, ttlSeconds: number) {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as string);
    this.map.set(key, { value, expires: this.now() + ttlSeconds * 1000 });
  }
  delPrefix(prefix: string) {
    for (const k of [...this.map.keys()]) if (k.startsWith(prefix)) this.map.delete(k);
  }
  get size() {
    return this.map.size;
  }
}

const PREFIX = 'noma:';

/**
 * A small read-through cache for public, slow-changing reads (homepage feed, category and brand lists).
 * Redis is used when REDIS_URL is set; otherwise, or while Redis is unreachable, an in-memory store per
 * process. A cache problem never fails a request: the value is simply computed again. Invalidation is
 * by key prefix, called on every write that changes what is cached, and entries also expire on their own.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly memory = new MemoryStore();
  private redis: Redis | null = null;
  private redisUp = false;
  hits = 0;
  misses = 0;

  constructor(@Inject(ENV) env: Env) {
    if (env.REDIS_URL) {
      this.redis = new Redis(env.REDIS_URL, {
        lazyConnect: false,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 3000,
        retryStrategy: (times) => Math.min(times * 500, 10_000),
      });
      this.redis.on('ready', () => {
        if (!this.redisUp) this.logger.log('Cache: using Redis');
        this.redisUp = true;
      });
      this.redis.on('error', () => {
        if (this.redisUp)
          this.logger.warn('Cache: Redis unreachable, using the in-memory cache meanwhile');
        this.redisUp = false;
      });
    }
  }

  /** "redis" while Redis is reachable, otherwise "memory". */
  get backend(): 'redis' | 'memory' {
    return this.redis && this.redisUp ? 'redis' : 'memory';
  }

  async get<T>(key: string): Promise<T | null> {
    let raw: string | null = null;
    try {
      raw = this.backend === 'redis' ? await this.redis!.get(PREFIX + key) : this.memory.get(key);
    } catch {
      raw = this.memory.get(key);
    }
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const raw = JSON.stringify(value);
    this.memory.set(key, raw, ttlSeconds);
    if (this.backend !== 'redis') return;
    try {
      await this.redis!.set(PREFIX + key, raw, 'EX', ttlSeconds);
    } catch {
      // the in-memory copy above still serves this process
    }
  }

  /** Drops every entry whose key starts with `prefix`, in Redis and in this process. */
  async invalidate(prefix: string): Promise<void> {
    this.memory.delPrefix(prefix);
    if (this.backend !== 'redis') return;
    try {
      let cursor = '0';
      do {
        const [next, keys] = await this.redis!.scan(
          cursor,
          'MATCH',
          `${PREFIX}${prefix}*`,
          'COUNT',
          200,
        );
        if (keys.length) await this.redis!.del(...keys);
        cursor = next;
      } while (cursor !== '0');
    } catch (error) {
      this.logger.warn(`Cache: could not invalidate "${prefix}" in Redis: ${String(error)}`);
    }
  }

  /** Returns the cached value, or computes, stores and returns it. */
  async wrap<T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      this.hits++;
      return cached;
    }
    this.misses++;
    const value = await compute();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  /** For readiness: true when no Redis is configured, or when it answers. */
  async healthy(): Promise<boolean> {
    if (!this.redis) return true;
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy() {
    this.redis?.disconnect();
  }
}
