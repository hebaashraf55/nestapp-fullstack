/**
 * `npm run docs:openapi`: writes docs/openapi.json from the real application modules. It needs no
 * database: without MONGODB_URI the repositories are the "unavailable" stubs, and the routes are identical.
 */
import 'reflect-metadata';
import { NestFactory, ModulesContainer } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AppModule } from '../app.module';
import { loadEnv } from '../config/env';
import { buildOpenApi } from './openapi';

async function main(): Promise<void> {
  const env = loadEnv({ NODE_ENV: 'test', OPENAPI_ENABLED: 'true' });
  const app = await NestFactory.create(AppModule.register(env), { logger: false });
  await app.init();
  const document = buildOpenApi(app.get(ModulesContainer));
  const target = join(process.cwd(), 'docs', 'openapi.json');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
  process.stdout.write(`wrote ${target}\n`);
}

void main();
