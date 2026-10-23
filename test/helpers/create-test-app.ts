import { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { configureApp } from '../../src/app.setup';
import { ENV, Env, loadEnv } from '../../src/config/env';
import { HealthController } from '../../src/health/health.controller';

/**
 * Builds the real application setup (same `configureApp` as production) without needing a
 * database. Extra controllers can be supplied to simulate failures.
 */
export async function createTestApp(
  envOverrides: NodeJS.ProcessEnv = {},
  extraControllers: Type<unknown>[] = [],
): Promise<INestApplication> {
  const env: Env = loadEnv({ NODE_ENV: 'test', ...envOverrides });
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController, ...extraControllers],
    providers: [{ provide: ENV, useValue: env }],
  }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, env);
  await app.init();
  return app;
}
