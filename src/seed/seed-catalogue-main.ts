import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import {
  BrandsRepository,
  CategoriesRepository,
  ProductsRepository,
} from '../catalogue/catalogue.repositories';
import { EnvValidationError, loadEnv } from '../config/env';
import { seedCatalogue } from './seed-catalogue';

/** `npm run seed:catalogue`: synthetic demo brands, categories and products (all flagged isDemo). */
async function run(): Promise<void> {
  const env = loadEnv();
  if (env.MONGODB_URI === undefined) {
    console.error('MONGODB_URI: is required to seed (start MongoDB with docker compose)');
    process.exit(1);
  }
  const app = await NestFactory.createApplicationContext(AppModule.register(env), {
    logger: ['error', 'warn'],
  });
  try {
    const result = await seedCatalogue(
      app.get(BrandsRepository),
      app.get(CategoriesRepository),
      app.get(ProductsRepository),
    );
    for (const [kind, r] of Object.entries(result)) {
      console.log(`${kind.padEnd(11)} created ${r.created}, already present ${r.existing}`);
    }
  } finally {
    await app.close();
  }
}

run().catch((error: unknown) => {
  if (error instanceof EnvValidationError) console.error(error.message);
  else if (error instanceof Error) {
    console.error(
      `Seed failed: ${error.name}: ${error.message.replace(/mongodb(\+srv)?:\/\/\S+/gi, 'mongodb://<redacted>')}`,
    );
  } else console.error('Seed failed');
  process.exit(1);
});
