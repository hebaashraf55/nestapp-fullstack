import { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { HttpErrorFilter } from './common/http-error.filter';
import { jsonBody } from './common/json-body.middleware';
import { ResponseEnvelopeInterceptor } from './common/response-envelope.interceptor';
import { RateLimiter } from './auth/rate-limiter';
import { Env } from './config/env';
import { createThrottle } from './throttle/throttle.middleware';

/**
 * Applies the cross-cutting HTTP configuration. Used by both `main.ts` and the tests so that tests
 * exercise the same setup as production.
 */
export function configureApp(
  app: INestApplication,
  env: Env,
  throttler: RateLimiter = new RateLimiter(),
): void {
  // Must come first: it decides what req.ip means for the throttle, the auth limiters and the logs.
  (app.getHttpAdapter().getInstance() as { set(name: string, value: unknown): void }).set(
    'trust proxy',
    env.TRUST_PROXY > 0 ? env.TRUST_PROXY : false,
  );
  app.use(helmet());
  app.use(createThrottle(throttler, env));
  app.use(jsonBody());
  app.setGlobalPrefix('api');
  // An empty allow-list disables CORS entirely (the safe default). Matching is exact, never `*`.
  app.enableCors({ origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false });
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new HttpErrorFilter());
}
