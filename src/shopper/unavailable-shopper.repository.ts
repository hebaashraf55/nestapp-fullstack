import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ShopperListsRepository } from './shopper.repository';

const fail = (): never => {
  throw new ServiceUnavailableException();
};

/** Bound when MONGODB_URI is not set. */
@Injectable()
export class UnavailableShopperListsRepository extends ShopperListsRepository {
  wishlist = fail;
  addToWishlist = fail;
  removeFromWishlist = fail;
  recentlyViewed = fail;
  recordViews = fail;
}
