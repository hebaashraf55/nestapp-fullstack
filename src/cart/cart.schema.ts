import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ _id: false })
export class CartItem {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId!: Types.ObjectId;

  @Prop({ required: true, min: 1, max: 99 })
  quantity!: number;
}
export const CartItemSchema = SchemaFactory.createForClass(CartItem);

@Schema({ collection: 'carts', timestamps: { createdAt: true, updatedAt: true } })
export class Cart {
  @Prop({ required: true, unique: true })
  user!: string;

  @Prop({ type: [CartItemSchema], default: [] })
  items!: CartItem[];

  @Prop({ type: Types.ObjectId, ref: 'Coupon', default: null })
  couponId!: Types.ObjectId | null;

  @Prop({ required: true, default: 1 })
  version!: number;
}
export const CartSchema = SchemaFactory.createForClass(Cart);
