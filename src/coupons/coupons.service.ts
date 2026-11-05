import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DuplicateKeyError } from '../catalogue/catalogue.repositories';
import { OrdersRepository } from '../orders/orders.repository';
import { CouponRecord, CouponsRepository } from './coupons.repository';
import type { CouponCreateDto, CouponUpdateDto } from './dto';

/** `active` is the admin's switch; `status` combines it with the expiry date. */
export type CouponStatus = 'ACTIVE' | 'INACTIVE' | 'EXPIRED';

export interface CouponView {
  id: string;
  code: string;
  /** Percentage is the only discount type the API supports. */
  discountType: 'PERCENT';
  discountPercent: number;
  expiresAt: Date;
  expired: boolean;
  active: boolean;
  status: CouponStatus;
  /** Orders placed with this code, whatever happened to them afterwards. */
  ordersPlaced: number;
  isDemo: boolean;
  createdAt: Date;
}
const view = (c: CouponRecord, ordersPlaced = 0): CouponView => {
  const expired = c.expiresAt.getTime() <= Date.now();
  return {
    id: c.id,
    code: c.code,
    discountType: 'PERCENT',
    discountPercent: c.discountPercent,
    expiresAt: c.expiresAt,
    expired,
    active: c.active,
    status: expired ? 'EXPIRED' : c.active ? 'ACTIVE' : 'INACTIVE',
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
    try {
      return view(await this.coupons.create({ ...dto, isDemo: false, createdBy: adminId }));
    } catch (error) {
      if (error instanceof DuplicateKeyError) throw new ConflictException('Coupon already exists');
      throw error;
    }
  }

  async update(id: string, dto: CouponUpdateDto): Promise<CouponView> {
    await this.find(id);
    const updated = await this.coupons.update(id, dto);
    if (!updated) throw new NotFoundException('Coupon not found');
    return view(updated);
  }

  /** Orders keep their own copy of the code and percentage, so deleting a coupon never changes history. */
  async remove(id: string): Promise<{ deleted: true }> {
    if (!(await this.coupons.delete(id))) throw new NotFoundException('Coupon not found');
    return { deleted: true };
  }

  private async find(id: string): Promise<CouponRecord> {
    const coupon = await this.coupons.findById(id);
    if (!coupon) throw new NotFoundException('Coupon not found');
    return coupon;
  }
}
