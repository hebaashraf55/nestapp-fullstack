import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ collection: 'coupons', timestamps: { createdAt: true, updatedAt: true } })
export class Coupon {
  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  code!: string;

  @Prop({ required: true, min: 1, max: 90 })
  discountPercent!: number;

  @Prop({ required: true, type: Date, index: true })
  expiresAt!: Date;

  @Prop({ required: true, default: false })
  isDemo!: boolean;

  @Prop({ required: true })
  createdBy!: string;
}
export const CouponSchema = SchemaFactory.createForClass(Coupon);
