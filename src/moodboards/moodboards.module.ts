import { DynamicModule, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Env } from '../config/env';
import { Moodboard, MoodboardSchema } from './moodboard.schema';
import { MoodboardsController } from './moodboards.controller';
import { MoodboardsRepository } from './moodboards.repository';
import { MoodboardsService } from './moodboards.service';
import { MongoMoodboardsRepository } from './mongo-moodboards.repository';
import { UnavailableMoodboardsRepository } from './unavailable-moodboards.repository';

@Module({})
export class MoodboardsModule {
  static register(env: Env): DynamicModule {
    const connected = env.MONGODB_URI !== undefined;
    return {
      module: MoodboardsModule,
      imports: connected
        ? [MongooseModule.forFeature([{ name: Moodboard.name, schema: MoodboardSchema }])]
        : [],
      controllers: [MoodboardsController],
      providers: [
        {
          provide: MoodboardsRepository,
          useClass: connected ? MongoMoodboardsRepository : UnavailableMoodboardsRepository,
        },
        MoodboardsService,
      ],
    };
  }
}
