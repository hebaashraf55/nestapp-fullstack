import { DynamicModule, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Env } from '../config/env';
import { MongoShopperListsRepository } from './mongo-shopper.repository';
import { RecentlyViewedController, WishlistController } from './shopper.controller';
import { ShopperListsRepository } from './shopper.repository';
import { RecentViews, RecentViewsSchema, Wishlist, WishlistSchema } from './shopper.schemas';
import { ShopperService } from './shopper.service';
import { UnavailableShopperListsRepository } from './unavailable-shopper.repository';

/** Wishlist and recently viewed products for signed-in customers. */
@Module({})
export class ShopperModule {
  static register(env: Env): DynamicModule {
    const connected = env.MONGODB_URI !== undefined;
    return {
      module: ShopperModule,
      imports: connected
        ? [
            MongooseModule.forFeature([
              { name: Wishlist.name, schema: WishlistSchema },
              { name: RecentViews.name, schema: RecentViewsSchema },
            ]),
          ]
        : [],
      controllers: [WishlistController, RecentlyViewedController],
      providers: [
        {
          provide: ShopperListsRepository,
          useClass: connected ? MongoShopperListsRepository : UnavailableShopperListsRepository,
        },
        ShopperService,
      ],
    };
  }
}
