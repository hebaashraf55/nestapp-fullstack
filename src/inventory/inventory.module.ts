import { DynamicModule, Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Env } from '../config/env';
import { InventoryController } from './inventory.controller';
import { InventoryRepository } from './inventory.repository';
import { InventoryService } from './inventory.service';
import { MongoInventoryRepository } from './mongo-inventory.repository';
import { InventoryMovement, InventoryMovementSchema } from './movement.schema';
import { UnavailableInventoryRepository } from './unavailable-inventory.repository';

/** Global so the catalogue and orders can record stock movements. */
@Global()
@Module({})
export class InventoryModule {
  static register(env: Env): DynamicModule {
    const connected = env.MONGODB_URI !== undefined;
    return {
      module: InventoryModule,
      imports: connected
        ? [
            MongooseModule.forFeature([
              { name: InventoryMovement.name, schema: InventoryMovementSchema },
            ]),
          ]
        : [],
      controllers: [InventoryController],
      providers: [
        {
          provide: InventoryRepository,
          useClass: connected ? MongoInventoryRepository : UnavailableInventoryRepository,
        },
        InventoryService,
      ],
      exports: [InventoryService],
    };
  }
}
