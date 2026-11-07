import { DynamicModule, Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Env } from '../config/env';
import { Address, AddressSchema } from './address.schema';
import { AddressesController } from './addresses.controller';
import { AddressesRepository } from './addresses.repository';
import { AddressesService } from './addresses.service';
import { MongoAddressesRepository } from './mongo-addresses.repository';
import { UnavailableAddressesRepository } from './unavailable-addresses.repository';

/** Global so checkout can resolve a saved address. */
@Global()
@Module({})
export class AddressesModule {
  static register(env: Env): DynamicModule {
    const connected = env.MONGODB_URI !== undefined;
    return {
      module: AddressesModule,
      imports: connected
        ? [MongooseModule.forFeature([{ name: Address.name, schema: AddressSchema }])]
        : [],
      controllers: [AddressesController],
      providers: [
        {
          provide: AddressesRepository,
          useClass: connected ? MongoAddressesRepository : UnavailableAddressesRepository,
        },
        AddressesService,
      ],
      exports: [AddressesService],
    };
  }
}
