import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ _id: false })
export class BundleItem {
  @Prop({ type: Types.ObjectId, required: true })
  productId!: Types.ObjectId;

  @Prop({ required: true, min: 1, max: 5 })
  quantity!: number;
}
export const BundleItemSchema = SchemaFactory.createForClass(BundleItem);

@Schema({ collection: 'bundles', timestamps: true })
export class Bundle {
  @Prop({ required: true, maxlength: 80 })
  name!: string;

  @Prop({ required: true, unique: true, maxlength: 100 })
  slug!: string;

  @Prop({ default: '', maxlength: 500 })
  description!: string;

  @Prop({ type: String, default: null })
  image!: string | null;

  @Prop({ type: [BundleItemSchema], required: true })
  items!: BundleItem[];

  /** Taken off the sale prices of the bundled items when the whole set is in the cart. */
  @Prop({ required: true, min: 1, max: 50 })
  discountPercent!: number;

  @Prop({ required: true, default: true, index: true })
  active!: boolean;

  @Prop({ required: true, default: false })
  isDemo!: boolean;

  @Prop({ required: true })
  createdBy!: string;
}
export type BundleDocument = HydratedDocument<Bundle>;
export const BundleSchema = SchemaFactory.createForClass(Bundle);
BundleSchema.index({ 'items.productId': 1, active: 1 });
