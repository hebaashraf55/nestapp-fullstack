import { ConflictException, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { ProductsService, ProductView } from '../catalogue/catalogue.services';
import { RECENT_MAX, ShopperListsRepository, WISHLIST_MAX } from './shopper.repository';

export interface ProductList {
  productIds: string[];
  /** Only products that still exist and the caller may see; deleted ones are left out. */
  items: ProductView[];
}

@Injectable()
export class ShopperService {
  constructor(
    private readonly lists: ShopperListsRepository,
    private readonly products: ProductsService,
  ) {}

  async wishlist(user: AuthenticatedUser): Promise<ProductList> {
    return this.resolve(await this.lists.wishlist(user.id), user);
  }

  async addToWishlist(user: AuthenticatedUser, productId: string): Promise<ProductList> {
    await this.products.get(productId, user); // 404 for unknown or hidden products
    const ids = await this.lists.addToWishlist(user.id, [productId]);
    if (!ids) throw new ConflictException(`Your wishlist is full (${WISHLIST_MAX} items)`);
    return this.resolve(ids, user);
  }

  async removeFromWishlist(user: AuthenticatedUser, productId: string): Promise<ProductList> {
    return this.resolve(await this.lists.removeFromWishlist(user.id, productId), user);
  }

  /** Guest wishlist → account: unknown or hidden ids are ignored, the cap is respected. */
  async mergeWishlist(user: AuthenticatedUser, productIds: string[]): Promise<ProductList> {
    const known = (await this.products.findVisible(productIds, user)).map((p) => p.id);
    const current = await this.lists.wishlist(user.id);
    const room = Math.max(0, WISHLIST_MAX - current.length);
    const toAdd = known.filter((id) => !current.includes(id)).slice(0, room);
    const ids = toAdd.length
      ? ((await this.lists.addToWishlist(user.id, toAdd)) ?? current)
      : current;
    return this.resolve(ids, user);
  }

  async recentlyViewed(user: AuthenticatedUser): Promise<ProductList> {
    return this.resolve(await this.lists.recentlyViewed(user.id), user);
  }

  async recordView(user: AuthenticatedUser, productId: string): Promise<ProductList> {
    await this.products.get(productId, user);
    return this.resolve(await this.lists.recordViews(user.id, [productId]), user);
  }

  /** Guest history → account, newest first; unknown ids ignored. */
  async mergeRecentlyViewed(user: AuthenticatedUser, newestFirst: string[]): Promise<ProductList> {
    const visible = new Set((await this.products.findVisible(newestFirst, user)).map((p) => p.id));
    const ids = [...new Set(newestFirst)].filter((id) => visible.has(id)).slice(0, RECENT_MAX);
    const list = ids.length
      ? await this.lists.recordViews(user.id, ids)
      : await this.lists.recentlyViewed(user.id);
    return this.resolve(list, user);
  }

  private async resolve(productIds: string[], user: AuthenticatedUser): Promise<ProductList> {
    const views = await this.products.findVisible(productIds, user);
    const byId = new Map(views.map((v) => [v.id, v]));
    const items = productIds.map((id) => byId.get(id)).filter((v): v is ProductView => !!v);
    return { productIds: items.map((i) => i.id), items };
  }
}
