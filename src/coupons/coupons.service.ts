import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DuplicateKeyError } from '../catalogue/catalogue.repositories';
import { CouponRecord, CouponsRepository } from './coupons.repository';
import type { CouponCreateDto, CouponUpdateDto } from './dto';

export interface CouponView {
  id: string;
  code: string;
  discountPercent: number;
  expiresAt: Date;
  expired: boolean;
  isDemo: boolean;
  createdAt: Date;
}
const view = (c: CouponRecord): CouponView => ({
  id: c.id,
  code: c.code,
  discountPercent: c.discountPercent,
  expiresAt: c.expiresAt,
  expired: c.expiresAt.getTime() <= Date.now(),
  isDemo: c.isDemo,
  createdAt: c.createdAt,
});

@Injectable()
export class CouponsService {
  constructor(private readonly coupons: CouponsRepository) {}

  async list(): Promise<CouponView[]> {
    return (await this.coupons.findAll()).map(view);
  }

  async get(id: string): Promise<CouponView> {
    return view(await this.find(id));
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
