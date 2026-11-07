import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ collection: 'brands', timestamps: { createdAt: true, updatedAt: true } })
export class Brand {
  @Prop({ required: true, trim: true, minlength: 2, maxlength: 60 })
  name!: string;

  @Prop({ required: true, unique: true })
  slug!: string;

  @Prop({ type: String, default: null })
  image!: string | null;

  @Prop({ required: true, default: false, index: true })
  isDemo!: boolean;

  @Prop({ required: true })
  createdBy!: string;
}
export const BrandSchema = SchemaFactory.createForClass(Brand);

@Schema({ collection: 'categories', timestamps: { createdAt: true, updatedAt: true } })
export class Category {
  @Prop({ required: true, trim: true, minlength: 2, maxlength: 60 })
  name!: string;

  @Prop({ required: true, unique: true })
  slug!: string;

  @Prop({ type: String, default: null })
  image!: string | null;

  @Prop({ required: true, default: false, index: true })
  isDemo!: boolean;

  @Prop({ required: true })
  createdBy!: string;
}
export const CategorySchema = SchemaFactory.createForClass(Category);

@Schema({ collection: 'products', timestamps: { createdAt: true, updatedAt: true } })
export class Product {
  @Prop({ required: true, trim: true, minlength: 3, maxlength: 100 })
  name!: string;

  @Prop({ required: true, unique: true })
  slug!: string;

  @Prop({ default: '', maxlength: 2000 })
  description!: string;

  @Prop({ type: [String], required: true })
  images!: string[];

  @Prop({ required: true, min: 1 })
  priceCents!: number;

  @Prop({ required: true, min: 0, max: 90, default: 0 })
  discountPercent!: number;

  @Prop({ required: true, min: 0, index: true })
  salePriceCents!: number;

  @Prop({ required: true, min: 0 })
  stock!: number;

  @Prop({ type: Types.ObjectId, ref: 'Category', required: true, index: true })
  categoryId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Brand', required: true, index: true })
  brandId!: Types.ObjectId;

  @Prop({
    type: {
      material: { type: String, maxlength: 120 },
      color: { type: String, maxlength: 120 },
      dimensions: { type: String, maxlength: 120 },
      care: { type: String, maxlength: 200 },
    },
    _id: false,
    default: {},
  })
  specs!: { material?: string; color?: string; dimensions?: string; care?: string };

  @Prop({ required: true, default: false, index: true })
  featured!: boolean;

  @Prop({ type: String, default: null, maxlength: 60, index: true })
  variantGroup!: string | null;

  @Prop({ type: String, default: null, maxlength: 40 })
  variantLabel!: string | null;

  @Prop({ required: true, default: false, index: true })
  isDemo!: boolean;

  @Prop({ required: true })
  createdBy!: string;
}
export const ProductSchema = SchemaFactory.createForClass(Product);
ProductSchema.index({ createdAt: -1 });
ProductSchema.index({ categoryId: 1, createdAt: -1 });
ProductSchema.index({ discountPercent: -1 });
