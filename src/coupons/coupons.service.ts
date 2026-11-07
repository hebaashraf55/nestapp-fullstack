import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CategoriesRepository,
  DuplicateKeyError,
  ProductsRepository,
} from '../catalogue/catalogue.repositories';
import { OrdersRepository } from '../orders/orders.repository';
import {
  CouponPatch,
  CouponRecord,
  CouponsRepository,
  DiscountType,
  PromotionScope,
} from './coupons.repository';
import type { CouponCreateDto, CouponUpdateDto } from './dto';

/** `active` is the admin's switch; `status` combines it with the dates and the usage limit. */
export type CouponStatus = 'ACTIVE' | 'INACTIVE' | 'EXPIRED' | 'SCHEDULED' | 'USED_UP';

export interface CouponView {
  id: string;
  code: string;
  discountType: DiscountType;
  discountPercent: number;
  amountOffCents: number | null;
  minSubtotalCents: number;
  startsAt: Date | null;
  expiresAt: Date;
  expired: boolean;
  maxUses: number | null;
  /** Uses currently held by placed orders (given back when an order is cancelled or expires). */
  usedCount: number;
  maxUsesPerCustomer: number | null;
  scope: PromotionScope;
  productIds: string[];
  categoryIds: string[];
  automatic: boolean;
  active: boolean;
  status: CouponStatus;
  /** Orders placed with this code, whatever happened to them afterwards. */
  ordersPlaced: number;
  isDemo: boolean;
  createdAt: Date;
}
const view = (c: CouponRecord, ordersPlaced = 0): CouponView => {
  const now = Date.now();
  const expired = c.expiresAt.getTime() <= now;
  const scheduled = c.startsAt !== null && c.startsAt.getTime() > now;
  const usedUp = c.maxUses !== null && c.usedCount >= c.maxUses;
  return {
    id: c.id,
    code: c.code,
    discountType: c.type,
    discountPercent: c.discountPercent,
    amountOffCents: c.amountOffCents,
    minSubtotalCents: c.minSubtotalCents,
    startsAt: c.startsAt,
    expiresAt: c.expiresAt,
    expired,
    maxUses: c.maxUses,
    usedCount: c.usedCount,
    maxUsesPerCustomer: c.maxUsesPerCustomer,
    scope: c.scope,
    productIds: c.productIds,
    categoryIds: c.categoryIds,
    automatic: c.automatic,
    active: c.active,
    status: expired
      ? 'EXPIRED'
      : !c.active
        ? 'INACTIVE'
        : usedUp
          ? 'USED_UP'
          : scheduled
            ? 'SCHEDULED'
            : 'ACTIVE',
    ordersPlaced,
    isDemo: c.isDemo,
    createdAt: c.createdAt,
  };
};

@Injectable()
export class CouponsService {
  constructor(
    private readonly coupons: CouponsRepository,
    private readonly orders: OrdersRepository,
    private readonly products: ProductsRepository,
    private readonly categories: CategoriesRepository,
  ) {}

  async list(): Promise<CouponView[]> {
    const [all, usage] = await Promise.all([
      this.coupons.findAll(),
      this.orders.countByCouponCode(),
    ]);
    return all.map((c) => view(c, usage[c.code] ?? 0));
  }

  async get(id: string): Promise<CouponView> {
    const coupon = await this.find(id);
    const usage = await this.orders.countByCouponCode();
    return view(coupon, usage[coupon.code] ?? 0);
  }

  async create(dto: CouponCreateDto, adminId: string): Promise<CouponView> {
    await this.assertScope(dto.scope, dto.productIds, dto.categoryIds);
    try {
      return view(
        await this.coupons.create({
          ...dto,
          discountPercent: dto.type === 'PERCENT' ? (dto.discountPercent as number) : 0,
          amountOffCents: dto.type === 'FIXED' ? (dto.amountOffCents as number) : null,
          isDemo: false,
          createdBy: adminId,
        }),
      );
    } catch (error) {
      if (error instanceof DuplicateKeyError) throw new ConflictException('Coupon already exists');
      throw error;
    }
  }

  async update(id: string, dto: CouponUpdateDto): Promise<CouponView> {
    const current = await this.find(id);
    if (current.type === 'PERCENT' && dto.amountOffCents !== undefined)
      throw new BadRequestException('amountOffCents: only for fixed-amount coupons');
    if (current.type === 'FIXED' && dto.discountPercent !== undefined)
      throw new BadRequestException('discountPercent: only for percentage coupons');
    const next = { ...current, ...dto } as CouponRecord;
    if (next.startsAt && next.startsAt.getTime() >= next.expiresAt.getTime())
      throw new BadRequestException('startsAt: must be before the expiry date');
    if (
      next.maxUses !== null &&
      next.maxUsesPerCustomer !== null &&
      next.maxUsesPerCustomer > next.maxUses
    )
      throw new BadRequestException('maxUsesPerCustomer: cannot exceed the total limit');
    await this.assertScope(next.scope, next.productIds, next.categoryIds);
    const updated = await this.coupons.update(id, dto as CouponPatch);
    if (!updated) throw new NotFoundException('Coupon not found');
    return view(updated);
  }

  /** Orders keep their own copy of the code and discount, so deleting a coupon never changes history. */
  async remove(id: string): Promise<{ deleted: true }> {
    if (!(await this.coupons.delete(id))) throw new NotFoundException('Coupon not found');
    return { deleted: true };
  }

  private async assertScope(scope: PromotionScope, productIds: string[], categoryIds: string[]) {
    if (scope === 'PRODUCTS') {
      if (productIds.length === 0)
        throw new BadRequestException('productIds: choose at least one product');
      const found = await this.products.findByIds(productIds);
      if (found.length !== new Set(productIds).size)
        throw new BadRequestException('productIds: every product must exist');
    }
    if (scope === 'CATEGORIES') {
      if (categoryIds.length === 0)
        throw new BadRequestException('categoryIds: choose at least one category');
      const found = await this.categories.findByIds(categoryIds);
      if (found.length !== new Set(categoryIds).size)
        throw new BadRequestException('categoryIds: every category must exist');
    }
  }

  private async find(id: string): Promise<CouponRecord> {
    const coupon = await this.coupons.findById(id);
    if (!coupon) throw new NotFoundException('Coupon not found');
    return coupon;
  }
}
