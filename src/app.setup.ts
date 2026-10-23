import { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { HttpErrorFilter } from './common/http-error.filter';
import { jsonBody } from './common/json-body.middleware';
import { ResponseEnvelopeInterceptor } from './common/response-envelope.interceptor';
import { Env } from './config/env';

/**
 * Applies the cross-cutting HTTP configuration. Used by both `main.ts` and the tests so that tests
 * exercise the same setup as production.
 */
export function configureApp(app: INestApplication, env: Env): void {
  app.use(helmet());
  app.use(jsonBody());
  app.setGlobalPrefix('api');
  // An empty allow-list disables CORS entirely (the safe default). Matching is exact, never `*`.
  app.enableCors({ origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false });
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new HttpErrorFilter());
}
