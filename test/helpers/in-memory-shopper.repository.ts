import {
  RECENT_MAX,
  ShopperListsRepository,
  WISHLIST_MAX,
} from '../../src/shopper/shopper.repository';

/** Test-only fake of the wishlist / recently-viewed store. */
export class InMemoryShopperListsRepository extends ShopperListsRepository {
  readonly wishlists = new Map<string, string[]>();
  readonly recents = new Map<string, string[]>();

  async wishlist(userId: string) {
    return [...(this.wishlists.get(userId) ?? [])];
  }
  async addToWishlist(userId: string, productIds: string[]) {
    const current = this.wishlists.get(userId) ?? [];
    const fresh = productIds.filter(
      (id, i) => !current.includes(id) && productIds.indexOf(id) === i,
    );
    if (current.length + fresh.length > WISHLIST_MAX) return null;
    const next = [...current, ...fresh];
    this.wishlists.set(userId, next);
    return [...next];
  }
  async removeFromWishlist(userId: string, productId: string) {
    const next = (this.wishlists.get(userId) ?? []).filter((id) => id !== productId);
    this.wishlists.set(userId, next);
    return [...next];
  }
  async recentlyViewed(userId: string) {
    return [...(this.recents.get(userId) ?? [])];
  }
  async recordViews(userId: string, newestFirst: string[]) {
    const rest = (this.recents.get(userId) ?? []).filter((id) => !newestFirst.includes(id));
    const next = [...newestFirst, ...rest].slice(0, RECENT_MAX);
    this.recents.set(userId, next);
    return [...next];
  }
}
