import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ORDER_STATUSES, PAYMENT_STATUSES } from './order-status';

@Schema({ _id: false })
export class OrderItem {
  @Prop({ type: Types.ObjectId, required: true })
  productId!: Types.ObjectId;
  @Prop({ required: true })
  name!: string;
  @Prop({ required: true, min: 0 })
  unitPriceCents!: number;
  @Prop({ required: true, min: 1 })
  quantity!: number;
  @Prop({ required: true, min: 0 })
  lineTotalCents!: number;
}
export const OrderItemSchema = SchemaFactory.createForClass(OrderItem);

@Schema({ collection: 'orders', timestamps: { createdAt: true, updatedAt: true } })
export class Order {
  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true, default: false, index: true })
  isDemo!: boolean;

  @Prop({ type: [OrderItemSchema], required: true })
  items!: OrderItem[];

  @Prop({ required: true, min: 0 })
  subtotalCents!: number;

  @Prop({ type: String, default: null })
  couponCode!: string | null;

  @Prop({ type: Number, default: null })
  couponPercent!: number | null;

  @Prop({ required: true, min: 0 })
  discountCents!: number;

  @Prop({ required: true, min: 0 })
  totalCents!: number;

  @Prop({ required: true })
  currency!: string;

  @Prop({ required: true })
  address!: string;

  @Prop({ required: true })
  phone!: string;

  @Prop({ required: true, enum: ORDER_STATUSES, index: true })
  status!: string;

  @Prop({ required: true, enum: PAYMENT_STATUSES })
  paymentStatus!: string;

  @Prop({ required: true, type: Date })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  paidAt!: Date | null;

  @Prop({ type: Date, default: null })
  refundedAt!: Date | null;

  @Prop({ type: Date, default: null })
  cancelledAt!: Date | null;
}
export const OrderSchema = SchemaFactory.createForClass(Order);
OrderSchema.index({ userId: 1, createdAt: -1 });
OrderSchema.index({ status: 1, expiresAt: 1 });
OrderSchema.index({ isDemo: 1, status: 1, createdAt: -1 });
