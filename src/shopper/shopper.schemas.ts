import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** One wishlist per user. Product ids are unique within it ($addToSet). */
@Schema({ collection: 'wishlists', timestamps: { createdAt: false, updatedAt: true } })
export class Wishlist {
  @Prop({ required: true, unique: true })
  userId!: string;

  @Prop({ type: [String], default: [] })
  productIds!: string[];
}
export const WishlistSchema = SchemaFactory.createForClass(Wishlist);

/** One recently-viewed list per user, most recent first, capped. */
@Schema({ collection: 'recent_views', timestamps: { createdAt: false, updatedAt: true } })
export class RecentViews {
  @Prop({ required: true, unique: true })
  userId!: string;

  @Prop({ type: [String], default: [] })
  productIds!: string[];
}
export const RecentViewsSchema = SchemaFactory.createForClass(RecentViews);
