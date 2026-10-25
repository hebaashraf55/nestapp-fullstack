import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProductRecord, ProductsRepository } from '../catalogue/catalogue.repositories';
import { CURRENCY } from '../catalogue/catalogue.services';
import { RateLimiter } from '../auth/rate-limiter';
import { TooManyAttemptsException } from '../auth/too-many-attempts.exception';
import { CouponsRepository } from '../coupons/coupons.repository';
import { CartData, CartRecord, CartsRepository, VersionConflictError } from './cart.repository';
import { MAX_LINES, MAX_QUANTITY } from './dto';

/** Separate instance from the auth limiter so cart traffic never shares counters with logins. */
@Injectable()
export class CouponAttemptLimiter extends RateLimiter {}

const MAX_COUPON_FAILURES = 10;
const COUPON_WINDOW_MS = 15 * 60 * 1000;
const MAX_RETRIES = 3;

export type LineStatus = 'ok' | 'out-of-stock' | 'insufficient-stock' | 'unavailable';

export interface CartLineView {
  productId: string;
  name: string | null;
  slug: string | null;
  image: string | null;
  quantity: number;
  /** Current sale price from the catalogue, recomputed on every read. 0 for an unavailable product. */
  unitPriceCents: number;
  lineTotalCents: number;
  availableStock: number;
  status: LineStatus;
}

export interface CartView {
  items: CartLineView[];
  itemCount: number;
  subtotalCents: number;
  coupon: { code: string; discountPercent: number } | null;
  discountCents: number;
  totalCents: number;
  currency: string;
  /** True when a line is sold out, short on stock or no longer in the catalogue. */
  hasIssues: boolean;
  warnings: string[];
}

@Injectable()
export class CartService {
  constructor(
    private readonly carts: CartsRepository,
    private readonly products: ProductsRepository,
    private readonly coupons: CouponsRepository,
    private readonly limiter: CouponAttemptLimiter,
  ) {}

  async get(userId: string): Promise<CartView> {
    return this.render(await this.carts.findByUser(userId));
  }

  /** Empties the cart (and drops its coupon). Used after an order has been placed. */
  async clear(userId: string): Promise<void> {
    await this.mutate(userId, () => ({ items: [], couponId: null }));
  }

  async add(userId: string, productId: string, quantity: number): Promise<CartView> {
    const id = productId.toLowerCase();
    const product = await this.products.findById(id);
    if (!product) throw new NotFoundException('Product not found');
    return this.mutate(userId, (cart) => {
      const existing = cart.items.find((l) => l.productId === id);
      const next = (existing?.quantity ?? 0) + quantity;
      this.assertQuantity(product, next);
      if (!existing && cart.items.length >= MAX_LINES) {
        throw new BadRequestException(`A cart can hold at most ${MAX_LINES} different items`);
      }
      const items = existing
        ? cart.items.map((l) => (l.productId === id ? { ...l, quantity: next } : l))
        : [...cart.items, { productId: id, quantity: next }];
      return { items, couponId: cart.couponId };
    });
  }

  async update(userId: string, productId: string, quantity: number): Promise<CartView> {
    const id = productId.toLowerCase();
    const product = quantity > 0 ? await this.products.findById(id) : null;
    if (quantity > 0 && !product) throw new NotFoundException('Product not found');
    return this.mutate(userId, (cart) => {
      if (!cart.items.some((l) => l.productId === id)) {
        throw new NotFoundException('Item not in cart');
      }
      if (quantity === 0) {
        return { items: cart.items.filter((l) => l.productId !== id), couponId: cart.couponId };
      }
      this.assertQuantity(product as ProductRecord, quantity);
      return {
        items: cart.items.map((l) => (l.productId === id ? { ...l, quantity } : l)),
        couponId: cart.couponId,
      };
    });
  }

  async remove(userId: string, productId: string): Promise<CartView> {
    const id = productId.toLowerCase();
    return this.mutate(userId, (cart) => {
      if (!cart.items.some((l) => l.productId === id))
        throw new NotFoundException('Item not in cart');
      return { items: cart.items.filter((l) => l.productId !== id), couponId: cart.couponId };
    });
  }

  async applyCoupon(userId: string, code: string): Promise<CartView> {
    const key = `coupon:${userId}`;
    const status = this.limiter.status(key, MAX_COUPON_FAILURES);
    if (status.blocked) throw new TooManyAttemptsException(status.retryAfterSeconds);

    const coupon = await this.coupons.findByCode(code);
    if (!coupon || coupon.expiresAt.getTime() <= Date.now()) {
      // One generic answer for unknown and expired codes, and failures are counted per user.
      this.limiter.record(key, COUPON_WINDOW_MS);
      throw new BadRequestException('Invalid or expired coupon');
    }
    return this.mutate(userId, (cart) => {
      if (cart.items.length === 0) throw new BadRequestException('Your cart is empty');
      return { items: cart.items, couponId: coupon.id };
    });
  }

  /** Read-modify-write with optimistic concurrency; a lost race is retried, never silently overwritten. */
  private async mutate(userId: string, change: (cart: CartRecord) => CartData): Promise<CartView> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const stored = await this.carts.findByUser(userId);
      const cart: CartRecord = stored ?? { userId, items: [], couponId: null, version: 0 };
      const next = change(cart);
      try {
        await this.carts.save(userId, cart.version, next);
        return this.render({ ...cart, ...next, version: cart.version + 1 });
      } catch (error) {
        if (!(error instanceof VersionConflictError)) throw error;
      }
    }
    throw new ConflictException('Your cart changed in another request. Please try again.');
  }

  private assertQuantity(product: ProductRecord, quantity: number): void {
    if (quantity > MAX_QUANTITY) {
      throw new BadRequestException(`At most ${MAX_QUANTITY} of one item per cart`);
    }
    if (product.stock === 0) throw new ConflictException('This product is out of stock');
    if (quantity > product.stock) {
      throw new ConflictException(`Only ${product.stock} available`);
    }
  }

  /** Builds the response from live catalogue and coupon data. Nothing price-related is trusted from storage. */
  private async render(cart: CartRecord | null): Promise<CartView> {
    const lines = cart?.items ?? [];
    const found = lines.length ? await this.products.findByIds(lines.map((l) => l.productId)) : [];
    const byId = new Map(found.map((p) => [p.id, p]));

    const items: CartLineView[] = lines.map((line) => {
      const product = byId.get(line.productId);
      if (!product) {
        return {
          productId: line.productId,
          name: null,
          slug: null,
          image: null,
          quantity: line.quantity,
          unitPriceCents: 0,
          lineTotalCents: 0,
          availableStock: 0,
          status: 'unavailable',
        };
      }
      const status: LineStatus =
        product.stock === 0
          ? 'out-of-stock'
          : line.quantity > product.stock
            ? 'insufficient-stock'
            : 'ok';
      return {
        productId: product.id,
        name: product.name,
        slug: product.slug,
        image: product.images[0] ?? null,
        quantity: line.quantity,
        unitPriceCents: product.salePriceCents,
        lineTotalCents: product.salePriceCents * line.quantity,
        availableStock: product.stock,
        status,
      };
    });

    const subtotalCents = items.reduce((sum, i) => sum + i.lineTotalCents, 0);
    const warnings: string[] = [];
    let coupon: CartView['coupon'] = null;
    let discountCents = 0;
    if (cart?.couponId) {
      const record = await this.coupons.findById(cart.couponId);
      if (record && record.expiresAt.getTime() > Date.now()) {
        coupon = { code: record.code, discountPercent: record.discountPercent };
        discountCents = Math.round((subtotalCents * record.discountPercent) / 100);
      } else {
        warnings.push('Your coupon is no longer valid and was not applied.');
      }
    }
    if (items.some((i) => i.status !== 'ok')) {
      warnings.push('Some items are unavailable or exceed the stock on hand.');
    }
    return {
      items,
      itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
      subtotalCents,
      coupon,
      discountCents,
      totalCents: subtotalCents - discountCents,
      currency: CURRENCY,
      hasIssues: items.some((i) => i.status !== 'ok'),
      warnings,
    };
  }
}
