import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  let now: number;
  let limiter: RateLimiter;
  beforeEach(() => {
    now = 1_000_000;
    limiter = new RateLimiter();
    limiter.now = () => now;
  });

  it('allows up to the limit, then blocks with a Retry-After', () => {
    for (let i = 0; i < 3; i++) {
      expect(limiter.status('k', 3).blocked).toBe(false);
      limiter.record('k', 60_000);
    }
    expect(limiter.status('k', 3)).toEqual({ blocked: true, retryAfterSeconds: 60 });
    now += 20_000;
    expect(limiter.status('k', 3).retryAfterSeconds).toBe(40);
  });

  it('keys are independent', () => {
    for (let i = 0; i < 3; i++) limiter.record('a', 60_000);
    expect(limiter.status('a', 3).blocked).toBe(true);
    expect(limiter.status('b', 3).blocked).toBe(false);
  });

  it('opens a fresh window once the old one expires', () => {
    for (let i = 0; i < 3; i++) limiter.record('k', 60_000);
    now += 60_001;
    expect(limiter.status('k', 3).blocked).toBe(false);
    limiter.record('k', 60_000);
    expect(limiter.status('k', 3).blocked).toBe(false);
  });

  it('reset clears a key', () => {
    for (let i = 0; i < 3; i++) limiter.record('k', 60_000);
    limiter.reset('k');
    expect(limiter.status('k', 3).blocked).toBe(false);
  });

  it('stays bounded under a flood of distinct keys', () => {
    for (let i = 0; i < 50_100; i++) limiter.record(`flood:${i}`, 60_000);
    const size = (limiter as unknown as { buckets: Map<string, unknown> }).buckets.size;
    expect(size).toBeLessThanOrEqual(50_000);
  });
});
