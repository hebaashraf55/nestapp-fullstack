export const WISHLIST_MAX = 100;
export const RECENT_MAX = 20;

/**
 * Persistence port for per-user product lists. Every method is scoped by `userId`, which callers
 * always take from the authenticated request, so one customer can never touch another's list.
 */
export abstract class ShopperListsRepository {
  abstract wishlist(userId: string): Promise<string[]>;
  /** Adds unless present (no duplicates). Returns the list, or null if it is already full. */
  abstract addToWishlist(userId: string, productIds: string[]): Promise<string[] | null>;
  abstract removeFromWishlist(userId: string, productId: string): Promise<string[]>;
  abstract recentlyViewed(userId: string): Promise<string[]>;
  /** Moves the ids to the front in the given order (most recent first) and keeps RECENT_MAX. */
  abstract recordViews(userId: string, productIdsNewestFirst: string[]): Promise<string[]>;
}
