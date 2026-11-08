import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppLogger } from './common/app-logger';
import { RealtimeAdapter } from './realtime/realtime.adapter';
import { EnvValidationError, loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  let env;
  try {
    env = loadEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      logger.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  if (env.NODE_ENV === 'production' && env.CORS_ORIGINS.length === 0) {
    logger.warn('CORS_ORIGINS is empty: browsers on other origins will be blocked.');
  }

  const json = (env.LOG_FORMAT ?? (env.NODE_ENV === 'production' ? 'json' : 'text')) === 'json';
  const app = await NestFactory.create(AppModule.register(env), { logger: new AppLogger(json) });
  configureApp(app, env);
  app.useWebSocketAdapter(new RealtimeAdapter(app, env));
  await app.listen(env.PORT);
  logger.log(`API listening on port ${env.PORT} (payments mode: ${env.PAYMENTS_MODE})`);
}

void bootstrap();
