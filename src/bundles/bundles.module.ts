import { DynamicModule, Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Env } from '../config/env';
import { Bundle, BundleSchema } from './bundle.schema';
import { BundlesController } from './bundles.controller';
import { BundlesRepository } from './bundles.repository';
import { BundlesService } from './bundles.service';
import { MongoBundlesRepository } from './mongo-bundles.repository';
import { UnavailableBundlesRepository } from './unavailable-bundles.repository';

/** Global so the cart can price bundles without re-importing the module. */
@Global()
@Module({})
export class BundlesModule {
  static register(env: Env): DynamicModule {
    const connected = env.MONGODB_URI !== undefined;
    return {
      module: BundlesModule,
      imports: connected
        ? [MongooseModule.forFeature([{ name: Bundle.name, schema: BundleSchema }])]
        : [],
      controllers: [BundlesController],
      providers: [
        {
          provide: BundlesRepository,
          useClass: connected ? MongoBundlesRepository : UnavailableBundlesRepository,
        },
        BundlesService,
      ],
      exports: [BundlesRepository, BundlesService],
    };
  }
}
