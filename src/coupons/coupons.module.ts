import { DynamicModule, Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Env } from '../config/env';
import { Coupon, CouponSchema } from './coupon.schema';
import { CouponsController } from './coupons.controller';
import { CouponsRepository } from './coupons.repository';
import { CouponsService } from './coupons.service';
import { MongoCouponsRepository } from './mongo-coupons.repository';
import { UnavailableCouponsRepository } from './unavailable-coupons.repository';

@Global()
@Module({})
export class CouponsModule {
  static register(env: Env): DynamicModule {
    const connected = env.MONGODB_URI !== undefined;
    return {
      module: CouponsModule,
      imports: connected
        ? [MongooseModule.forFeature([{ name: Coupon.name, schema: CouponSchema }])]
        : [],
      controllers: [CouponsController],
      providers: [
        {
          provide: CouponsRepository,
          useClass: connected ? MongoCouponsRepository : UnavailableCouponsRepository,
        },
        CouponsService,
      ],
      exports: [CouponsRepository],
    };
  }
}
