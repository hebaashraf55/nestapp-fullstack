import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/** A product placed on the look's photo; x and y are percentages from the top-left, or null for list-only. */
@Schema({ _id: false })
export class LookSpot {
  @Prop({ type: Types.ObjectId, required: true })
  productId!: Types.ObjectId;

  @Prop({ type: Number, default: null, min: 0, max: 100 })
  x!: number | null;

  @Prop({ type: Number, default: null, min: 0, max: 100 })
  y!: number | null;
}
export const LookSpotSchema = SchemaFactory.createForClass(LookSpot);

@Schema({ collection: 'looks', timestamps: true })
export class Look {
  @Prop({ required: true, maxlength: 80 })
  title!: string;

  @Prop({ required: true, unique: true, maxlength: 100 })
  slug!: string;

  @Prop({ default: '', maxlength: 500 })
  description!: string;

  @Prop({ required: true })
  image!: string;

  @Prop({ type: [LookSpotSchema], required: true })
  spots!: LookSpot[];

  @Prop({ required: true, default: true, index: true })
  active!: boolean;

  @Prop({ required: true, default: false })
  isDemo!: boolean;

  @Prop({ required: true })
  createdBy!: string;
}
export type LookDocument = HydratedDocument<Look>;
export const LookSchema = SchemaFactory.createForClass(Look);
LookSchema.index({ 'spots.productId': 1 });
