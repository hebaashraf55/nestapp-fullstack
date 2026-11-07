import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ collection: 'coupons', timestamps: { createdAt: true, updatedAt: true } })
export class Coupon {
  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  code!: string;

  @Prop({ required: true, enum: ['PERCENT', 'FIXED'], default: 'PERCENT' })
  type!: string;

  /** PERCENT coupons: 1–90. Fixed-amount coupons store 0. */
  @Prop({ required: true, min: 0, max: 90 })
  discountPercent!: number;

  @Prop({ type: Number, default: null, min: 1, max: 10_000_000 })
  amountOffCents!: number | null;

  @Prop({ required: true, default: 0, min: 0 })
  minSubtotalCents!: number;

  @Prop({ type: Date, default: null })
  startsAt!: Date | null;

  @Prop({ required: true, type: Date, index: true })
  expiresAt!: Date;

  @Prop({ type: Number, default: null, min: 1 })
  maxUses!: number | null;

  /** Never below zero, never above maxUses: changed only by conditional $inc. */
  @Prop({ required: true, default: 0, min: 0 })
  usedCount!: number;

  @Prop({ type: Number, default: null, min: 1 })
  maxUsesPerCustomer!: number | null;

  @Prop({ required: true, enum: ['ALL', 'PRODUCTS', 'CATEGORIES'], default: 'ALL' })
  scope!: string;

  @Prop({ type: [String], default: [] })
  productIds!: string[];

  @Prop({ type: [String], default: [] })
  categoryIds!: string[];

  @Prop({ required: true, default: false, index: true })
  automatic!: boolean;

  /** An admin can pause a coupon without deleting it. Older documents without the field count as active. */
  @Prop({ required: true, default: true })
  active!: boolean;

  @Prop({ required: true, default: false })
  isDemo!: boolean;

  @Prop({ required: true })
  createdBy!: string;
}
export const CouponSchema = SchemaFactory.createForClass(Coupon);

/** Per-customer use counters: one document per coupon and customer. */
@Schema({ collection: 'coupon_uses' })
export class CouponUse {
  @Prop({ required: true })
  couponId!: string;
  @Prop({ required: true })
  ownerId!: string;
  @Prop({ required: true, default: 0, min: 0 })
  count!: number;
}
export const CouponUseSchema = SchemaFactory.createForClass(CouponUse);
CouponUseSchema.index({ couponId: 1, ownerId: 1 }, { unique: true });
