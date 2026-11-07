import { DynamicModule, Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Env } from '../config/env';
import { MongoNotificationsRepository } from './mongo-notifications.repository';
import { Notification, NotificationSchema } from './notification.schema';
import { NotificationsController } from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { UnavailableNotificationsRepository } from './unavailable-notifications.repository';

/** Global so orders and reviews can notify customers without importing this module. */
@Global()
@Module({})
export class NotificationsModule {
  static register(env: Env): DynamicModule {
    const connected = env.MONGODB_URI !== undefined;
    return {
      module: NotificationsModule,
      imports: connected
        ? [MongooseModule.forFeature([{ name: Notification.name, schema: NotificationSchema }])]
        : [],
      controllers: [NotificationsController],
      providers: [
        {
          provide: NotificationsRepository,
          useClass: connected ? MongoNotificationsRepository : UnavailableNotificationsRepository,
        },
        NotificationsService,
      ],
      exports: [NotificationsService],
    };
  }
}
