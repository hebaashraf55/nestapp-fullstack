import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RECENT_MAX, ShopperListsRepository, WISHLIST_MAX } from './shopper.repository';
import { RecentViews, Wishlist } from './shopper.schemas';

const ids = (doc: { productIds?: string[] } | null) => doc?.productIds ?? [];
/** User ids come from the signed-in token; anything else can never match a list. */
const bad = (userId: unknown) => typeof userId !== 'string' || userId === '';

@Injectable()
export class MongoShopperListsRepository extends ShopperListsRepository {
  constructor(
    @InjectModel(Wishlist.name) private readonly wishlists: Model<Wishlist>,
    @InjectModel(RecentViews.name) private readonly recents: Model<RecentViews>,
  ) {
    super();
  }

  async wishlist(userId: string) {
    if (bad(userId)) return [];
    return ids(
      await this.wishlists
        .findOne({ userId: { $eq: userId } })
        .lean()
        .exec(),
    );
  }

  async addToWishlist(userId: string, productIds: string[]) {
    if (bad(userId)) return [];
    const current = await this.wishlist(userId);
    const fresh = productIds.filter((id) => !current.includes(id));
    if (fresh.length === 0) return current;
    if (current.length + fresh.length > WISHLIST_MAX) return null;
    // $addToSet keeps the list duplicate-free even if two requests race.
    const doc = await this.wishlists
      .findOneAndUpdate(
        { userId: { $eq: userId } },
        { $addToSet: { productIds: { $each: fresh } } },
        { upsert: true, new: true },
      )
      .lean()
      .exec();
    return ids(doc);
  }

  async removeFromWishlist(userId: string, productId: string) {
    if (bad(userId)) return [];
    const doc = await this.wishlists
      .findOneAndUpdate(
        { userId: { $eq: userId } },
        { $pull: { productIds: productId } },
        { new: true },
      )
      .lean()
      .exec();
    return ids(doc);
  }

  async recentlyViewed(userId: string) {
    if (bad(userId)) return [];
    return ids(
      await this.recents
        .findOne({ userId: { $eq: userId } })
        .lean()
        .exec(),
    );
  }

  async recordViews(userId: string, newestFirst: string[]) {
    if (bad(userId)) return [];
    // One atomic pipeline update: put the ids first, drop their older copies, keep the newest RECENT_MAX.
    const doc = await this.recents
      .findOneAndUpdate(
        { userId: { $eq: userId } },
        [
          {
            $set: {
              userId,
              productIds: {
                $slice: [
                  {
                    $concatArrays: [
                      newestFirst,
                      {
                        $filter: {
                          input: { $ifNull: ['$productIds', []] },
                          cond: { $not: [{ $in: ['$$this', newestFirst] }] },
                        },
                      },
                    ],
                  },
                  RECENT_MAX,
                ],
              },
            },
          },
        ],
        { upsert: true, new: true, updatePipeline: true },
      )
      .lean()
      .exec();
    return ids(doc);
  }
}
