import { DynamicModule, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Env } from '../config/env';
import { Look, LookSchema } from './look.schema';
import { LooksController } from './looks.controller';
import { LooksRepository } from './looks.repository';
import { LooksService } from './looks.service';
import { MongoLooksRepository } from './mongo-looks.repository';
import { UnavailableLooksRepository } from './unavailable-looks.repository';

@Module({})
export class LooksModule {
  static register(env: Env): DynamicModule {
    const connected = env.MONGODB_URI !== undefined;
    return {
      module: LooksModule,
      imports: connected
        ? [MongooseModule.forFeature([{ name: Look.name, schema: LookSchema }])]
        : [],
      controllers: [LooksController],
      providers: [
        {
          provide: LooksRepository,
          useClass: connected ? MongoLooksRepository : UnavailableLooksRepository,
        },
        LooksService,
      ],
    };
  }
}
