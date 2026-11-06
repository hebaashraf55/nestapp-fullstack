import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export const REVIEW_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

@Schema({ collection: 'reviews', timestamps: true })
export class Review {
  @Prop({ type: Types.ObjectId, required: true })
  productId!: Types.ObjectId;

  @Prop({ required: true })
  userId!: string;

  /** Shown publicly: first name and last initial, captured when the review is written. */
  @Prop({ required: true, maxlength: 60 })
  authorName!: string;

  @Prop({ required: true, min: 1, max: 5 })
  rating!: number;

  @Prop({ required: true, maxlength: 120 })
  title!: string;

  @Prop({ required: true, maxlength: 2000 })
  body!: string;

  /** Computed by the server from the author's paid orders; never taken from the client. */
  @Prop({ required: true, default: false })
  verifiedPurchase!: boolean;

  @Prop({ required: true, enum: REVIEW_STATUSES, default: 'PENDING' })
  status!: ReviewStatus;

  @Prop({ type: String, default: null, maxlength: 300 })
  moderationNote!: string | null;

  @Prop({ type: String, default: null })
  moderatedBy!: string | null;

  @Prop({ type: Date, default: null })
  moderatedAt!: Date | null;

  /** Copied from the product, so the demo viewer only ever sees reviews of synthetic products. */
  @Prop({ required: true, default: false })
  isDemo!: boolean;
}

export type ReviewDocument = HydratedDocument<Review>;
export const ReviewSchema = SchemaFactory.createForClass(Review);
// One review per customer per product; also the race guard for two simultaneous submissions.
ReviewSchema.index({ productId: 1, userId: 1 }, { unique: true });
ReviewSchema.index({ productId: 1, status: 1, createdAt: -1 });
ReviewSchema.index({ status: 1, createdAt: -1 });
