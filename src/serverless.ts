import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppLogger } from './common/app-logger';
import { loadEnv } from './config/env';
import { RealtimeAdapter } from './realtime/realtime.adapter';

type RequestListener = (req: IncomingMessage, res: ServerResponse) => void;

/*
 * Serverless entry (Vercel): the same application as main.ts, created once per warm function instance
 * and reused for every request. There is no long-running process, so the background worker and the order
 * expiry timer stay off (see JobsService / OrderExpirySweeper): queued mail is sent inline, and unpaid
 * orders expire when they are next read. Live (Socket.io) updates need a persistent server, so clients
 * simply do not receive them here.
 */
let listener: Promise<RequestListener> | null = null;

async function boot(): Promise<RequestListener> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule.register(env), new ExpressAdapter(), {
    logger: new AppLogger(true),
  });
  configureApp(app, env);
  app.useWebSocketAdapter(new RealtimeAdapter(app, env));
  await app.init();
  return app.getHttpAdapter().getInstance() as RequestListener;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    listener ??= boot();
    (await listener)(req, res);
  } catch (error) {
    listener = null; // try a fresh start on the next request
    // Never put the cause in the response: it can name settings. It is in the function log instead.
    new Logger('Serverless').error(error instanceof Error ? error.message : String(error));
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        success: false,
        error: {
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'Internal server error',
        },
        timestamp: new Date().toISOString(),
      }),
    );
  }
}
