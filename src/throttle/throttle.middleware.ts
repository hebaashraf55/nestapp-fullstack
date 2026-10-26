import type { NextFunction, Request, Response } from 'express';
import { RateLimiter } from '../auth/rate-limiter';
import type { Env } from '../config/env';

/**
 * Cheap, first-in-line request throttle: one fixed window per client address across the whole API,
 * including unknown routes and malformed bodies (it runs before body parsing and the guards).
 *
 * The client address is `req.ip`, which honours X-Forwarded-For only for the number of proxy hops set in
 * TRUST_PROXY. Counters live in this process: they reset on restart and are not shared between instances.
 * `/api/health` is exempt so a load balancer's probes cannot lock the service out.
 */
export function createThrottle(
  limiter: RateLimiter,
  env: Pick<Env, 'THROTTLE_LIMIT' | 'THROTTLE_WINDOW_SECONDS'>,
) {
  const windowMs = env.THROTTLE_WINDOW_SECONDS * 1000;
  return (request: Request, response: Response, next: NextFunction): void => {
    if (request.method === 'GET' && request.path === '/api/health') return next();
    const key = `ip:${request.ip ?? 'unknown'}`;
    const status = limiter.status(key, env.THROTTLE_LIMIT);
    if (status.blocked) {
      response
        .status(429)
        .setHeader('Retry-After', String(status.retryAfterSeconds))
        .json({
          success: false,
          error: {
            statusCode: 429,
            error: 'Too Many Requests',
            message: 'Too many requests. Please slow down and try again shortly.',
          },
          timestamp: new Date().toISOString(),
        });
      return;
    }
    limiter.record(key, windowMs);
    next();
  };
}
