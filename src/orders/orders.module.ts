import { DynamicModule, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ENV, Env } from '../config/env';
import { MongoOrdersRepository } from './mongo-orders.repository';
import { OrderExpirySweeper } from './order-expiry.sweeper';
import { Order, OrderSchema } from './order.schema';
import { OrdersController } from './orders.controller';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';
import { UnavailableOrdersRepository } from './unavailable-orders.repository';

@Module({})
export class OrdersModule {
  static register(env: Env): DynamicModule {
    const connected = env.MONGODB_URI !== undefined;
    return {
      module: OrdersModule,
      imports: connected
        ? [MongooseModule.forFeature([{ name: Order.name, schema: OrderSchema }])]
        : [],
      controllers: [OrdersController],
      providers: [
        { provide: ENV, useValue: env },
        {
          provide: OrdersRepository,
          useClass: connected ? MongoOrdersRepository : UnavailableOrdersRepository,
        },
        OrdersService,
        OrderExpirySweeper,
      ],
    };
  }
}
