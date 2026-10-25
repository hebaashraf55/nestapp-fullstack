import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { EnvValidationError, loadEnv } from '../config/env';
import { UsersService } from '../users/users.service';
import { loadSeedConfig, SeedConfigError } from './seed-config';
import { seedUsers } from './seed-users';

/** `npm run seed`. Prints emails and roles only; passwords are never logged. */
async function run(): Promise<void> {
  const env = loadEnv();
  if (env.MONGODB_URI === undefined) {
    throw new SeedConfigError([
      'MONGODB_URI: is required to seed (start MongoDB with docker compose)',
    ]);
  }
  const config = loadSeedConfig();
  const app = await NestFactory.createApplicationContext(AppModule.register(env), {
    logger: ['error', 'warn'],
  });
  try {
    const results = await seedUsers(app.get(UsersService), config);
    for (const r of results) console.log(`${r.outcome.padEnd(14)} ${r.role.padEnd(12)} ${r.email}`);
  } finally {
    await app.close();
  }
}

run().catch((error: unknown) => {
  if (error instanceof EnvValidationError || error instanceof SeedConfigError) {
    console.error(error.message);
  } else if (error instanceof Error) {
    // Only the message: a driver error stack can include the connection string.
    console.error(
      `Seed failed: ${error.name}: ${error.message.replace(/mongodb(\+srv)?:\/\/\S+/gi, 'mongodb://<redacted>')}`,
    );
  } else {
    console.error('Seed failed');
  }
  process.exit(1);
});
