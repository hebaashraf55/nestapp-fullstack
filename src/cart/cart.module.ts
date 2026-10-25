import { DynamicModule, Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Env } from '../config/env';
import { Cart, CartSchema } from './cart.schema';
import { CartController } from './cart.controller';
import { CartsRepository } from './cart.repository';
import { CartService, CouponAttemptLimiter } from './cart.service';
import { MongoCartsRepository } from './mongo-cart.repository';
import { UnavailableCartsRepository } from './unavailable-cart.repository';

/** Global so orders can price and clear the cart through CartService. */
@Global()
@Module({})
export class CartModule {
  static register(env: Env): DynamicModule {
    const connected = env.MONGODB_URI !== undefined;
    return {
      module: CartModule,
      imports: connected
        ? [MongooseModule.forFeature([{ name: Cart.name, schema: CartSchema }])]
        : [],
      controllers: [CartController],
      providers: [
        {
          provide: CartsRepository,
          useClass: connected ? MongoCartsRepository : UnavailableCartsRepository,
        },
        CouponAttemptLimiter,
        CartService,
      ],
      exports: [CartService],
    };
  }
}
