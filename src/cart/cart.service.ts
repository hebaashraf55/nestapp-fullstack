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
import { applyBundles, AppliedBundle } from '../bundles/bundle-pricing';
import { BundlesRepository } from '../bundles/bundles.repository';
import { CouponRecord, CouponsRepository, isCouponUsable } from '../coupons/coupons.repository';
import { evaluatePromotion } from '../coupons/promotion-pricing';
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

export interface AppliedPromotion {
  id: string;
  code: string;
  type: 'PERCENT' | 'FIXED';
  /** 0 for a fixed-amount promotion. */
  discountPercent: number;
  amountOffCents: number | null;
  automatic: boolean;
}

export interface CartView {
  items: CartLineView[];
  itemCount: number;
  subtotalCents: number;
  /** Bundle discounts found by the server: complete sets in the cart. */
  bundles: AppliedBundle[];
  bundleSavingsCents: number;
  /** The one promotion applied: the customer's code or an automatic promotion, whichever saves more. */
  coupon: AppliedPromotion | null;
  /** Coupon discount, taken after bundle savings. */
  discountCents: number;
  totalCents: number;
  currency: string;
  /** True when a line is sold out, short on stock or no longer in the catalogue. */
  hasIssues: boolean;
  /** The code the customer applied, when it cannot be used right now (with the reason). */
  rejectedCoupon: { code: string; reason: string } | null;
  warnings: string[];
}

@Injectable()
export class CartService {
  constructor(
    private readonly carts: CartsRepository,
    private readonly products: ProductsRepository,
    private readonly coupons: CouponsRepository,
    private readonly limiter: CouponAttemptLimiter,
    private readonly bundles: BundlesRepository,
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

  /**
   * Adds several products in one cart write (a bundle or a look). All or nothing: if any product is
   * missing or short on stock, nothing is added.
   */
  async addMany(
    userId: string,
    lines: { productId: string; quantity: number }[],
  ): Promise<CartView> {
    const ids = [...new Set(lines.map((l) => l.productId.toLowerCase()))];
    if (ids.length !== lines.length)
      throw new BadRequestException('Each product may appear only once');
    const found = new Map((await this.products.findByIds(ids)).map((p) => [p.id, p]));
    if (found.size !== ids.length) throw new NotFoundException('Product not found');
    return this.mutate(userId, (cart) => {
      let items = cart.items;
      for (const line of lines) {
        const id = line.productId.toLowerCase();
        const existing = items.find((l) => l.productId === id);
        const next = (existing?.quantity ?? 0) + line.quantity;
        this.assertQuantity(found.get(id) as ProductRecord, next);
        items = existing
          ? items.map((l) => (l.productId === id ? { ...l, quantity: next } : l))
          : [...items, { productId: id, quantity: next }];
      }
      if (items.length > MAX_LINES)
        throw new BadRequestException(`A cart can hold at most ${MAX_LINES} different items`);
      return { items, couponId: cart.couponId };
    });
  }

  /**
   * Prices a cart that is not stored (a guest's browser cart). Same rules as a stored cart, coupons
   * excluded. Duplicate lines are combined.
   */
  async quote(lines: { productId: string; quantity: number }[]): Promise<CartView> {
    const merged = new Map<string, number>();
    for (const l of lines) {
      const id = l.productId.toLowerCase();
      merged.set(id, Math.min(MAX_QUANTITY, (merged.get(id) ?? 0) + l.quantity));
    }
    return this.render({
      userId: '',
      items: [...merged].map(([productId, quantity]) => ({ productId, quantity })),
      couponId: null,
      version: 0,
    });
  }

  /**
   * Adds what can be added (reorder, or a guest cart merged at sign-in): each line is capped by the
   * stock left after what is already in the cart; missing or sold-out products are reported, not added.
   */
  async addAvailable(
    userId: string,
    lines: { productId: string; quantity: number }[],
  ): Promise<{
    cart: CartView;
    added: number;
    skipped: { productId: string; name: string | null; reason: string }[];
  }> {
    const ids = [...new Set(lines.map((l) => l.productId.toLowerCase()))];
    const found = new Map((await this.products.findByIds(ids)).map((p) => [p.id, p]));
    let skipped: { productId: string; name: string | null; reason: string }[] = [];
    let added = 0;
    const cart = await this.mutate(userId, (current) => {
      skipped = [];
      added = 0;
      let items = current.items;
      for (const line of lines) {
        const id = line.productId.toLowerCase();
        const product = found.get(id);
        if (!product) {
          skipped.push({ productId: id, name: null, reason: 'no longer available' });
          continue;
        }
        const existing = items.find((l) => l.productId === id)?.quantity ?? 0;
        const room = Math.min(product.stock, MAX_QUANTITY) - existing;
        const take = Math.min(line.quantity, room);
        if (take <= 0) {
          skipped.push({
            productId: id,
            name: product.name,
            reason: product.stock === 0 ? 'sold out' : 'no more in stock',
          });
          continue;
        }
        if (take < line.quantity)
          skipped.push({
            productId: id,
            name: product.name,
            reason: `only ${take} more could be added`,
          });
        if (existing === 0 && items.length >= MAX_LINES) {
          skipped.push({ productId: id, name: product.name, reason: 'your cart is full' });
          continue;
        }
        added += take;
        items = existing
          ? items.map((l) => (l.productId === id ? { ...l, quantity: existing + take } : l))
          : [...items, { productId: id, quantity: take }];
      }
      return { items, couponId: current.couponId };
    });
    return { cart, added, skipped };
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

  /** Takes the customer's code off the cart (automatic promotions still apply when eligible). */
  async removeCoupon(userId: string): Promise<CartView> {
    return this.mutate(userId, (cart) => ({ items: cart.items, couponId: null }));
  }

  async applyCoupon(userId: string, code: string): Promise<CartView> {
    const key = `coupon:${userId}`;
    const status = this.limiter.status(key, MAX_COUPON_FAILURES);
    if (status.blocked) throw new TooManyAttemptsException(status.retryAfterSeconds);

    const coupon = await this.coupons.findByCode(code);
    if (!coupon || !isCouponUsable(coupon) || coupon.automatic) {
      // One generic answer for unknown, paused, scheduled and expired codes; failures are counted per user.
      this.limiter.record(key, COUPON_WINDOW_MS);
      throw new BadRequestException('Invalid or expired coupon');
    }
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses)
      throw new BadRequestException('This coupon has been fully used');
    if (
      coupon.maxUsesPerCustomer !== null &&
      (await this.coupons.usesBy(coupon.id, userId)) >= coupon.maxUsesPerCustomer
    )
      throw new BadRequestException(
        'You have already used this coupon the maximum number of times',
      );
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
    const okLines = items.filter((i) => i.status === 'ok');
    const appliedBundles = okLines.length
      ? applyBundles(
          okLines,
          await this.bundles.findActiveContaining(okLines.map((i) => i.productId)),
        )
      : [];
    const bundleSavingsCents = appliedBundles.reduce((sum, b) => sum + b.savingsCents, 0);
    const afterBundles = subtotalCents - bundleSavingsCents;
    const warnings: string[] = [];
    let coupon: CartView['coupon'] = null;
    let discountCents = 0;
    let rejectedCoupon: CartView['rejectedCoupon'] = null;
    const owner = cart?.userId ?? '';
    const promoLines = okLines.map((i) => ({
      productId: i.productId,
      categoryId: byId.get(i.productId)?.categoryId ?? null,
      lineTotalCents: i.lineTotalCents,
    }));
    const candidates: { record: CouponRecord; chosen: boolean }[] = [];
    if (cart?.couponId) {
      const record = await this.coupons.findById(cart.couponId);
      if (record) candidates.push({ record, chosen: true });
      else warnings.push('Your coupon is no longer valid and was not applied.');
    }
    if (okLines.length)
      for (const record of await this.coupons.findAutomatic())
        candidates.push({ record, chosen: false });
    let best: { record: CouponRecord; discountCents: number } | null = null;
    for (const { record, chosen } of candidates) {
      const uses =
        owner && record.maxUsesPerCustomer !== null
          ? await this.coupons.usesBy(record.id, owner)
          : 0;
      const result = evaluatePromotion(record, promoLines, afterBundles, uses);
      if (!result.eligible) {
        if (chosen) rejectedCoupon = { code: record.code, reason: result.reason };
        if (chosen)
          warnings.push(
            isCouponUsable(record)
              ? `Coupon ${record.code} ${result.reason}, so it was not applied.`
              : 'Your coupon is no longer valid and was not applied.',
          );
        continue;
      }
      if (!best || result.discountCents > best.discountCents)
        best = { record, discountCents: result.discountCents };
    }
    if (best) {
      coupon = {
        id: best.record.id,
        code: best.record.code,
        type: best.record.type,
        discountPercent: best.record.type === 'PERCENT' ? best.record.discountPercent : 0,
        amountOffCents: best.record.type === 'FIXED' ? best.record.amountOffCents : null,
        automatic: best.record.automatic,
      };
      discountCents = best.discountCents;
      if (cart?.couponId && best.record.id !== cart.couponId)
        warnings.push(
          `The automatic offer ${best.record.code} saves you more, so it was used instead of your code.`,
        );
    }
    if (items.some((i) => i.status !== 'ok')) {
      warnings.push('Some items are unavailable or exceed the stock on hand.');
    }
    return {
      items,
      itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
      subtotalCents,
      bundles: appliedBundles,
      bundleSavingsCents,
      coupon,
      discountCents,
      totalCents: afterBundles - discountCents,
      currency: CURRENCY,
      hasIssues: items.some((i) => i.status !== 'ok'),
      rejectedCoupon,
      warnings,
    };
  }
}
