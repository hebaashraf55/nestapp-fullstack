import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const MOODBOARD_MAX_PRODUCTS = 50;
export const MOODBOARDS_PER_USER = 20;

@Schema({ collection: 'moodboards', timestamps: true })
export class Moodboard {
  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true, maxlength: 60 })
  name!: string;

  @Prop({ default: '', maxlength: 500 })
  note!: string;

  @Prop({ type: [String], default: [] })
  productIds!: string[];

  /** Random 128-bit token in hex; null when the board is private. Revoking replaces or clears it. */
  @Prop({ type: String, default: null })
  shareToken!: string | null;
}
export type MoodboardDocument = HydratedDocument<Moodboard>;
export const MoodboardSchema = SchemaFactory.createForClass(Moodboard);
MoodboardSchema.index(
  { shareToken: 1 },
  { unique: true, partialFilterExpression: { shareToken: { $type: 'string' } } },
);
