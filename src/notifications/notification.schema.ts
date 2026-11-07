import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const NOTIFICATION_TYPES = ['order', 'return', 'review'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

@Schema({ collection: 'notifications', timestamps: { createdAt: true, updatedAt: false } })
export class Notification {
  @Prop({ required: true })
  userId!: string;

  @Prop({ required: true, enum: NOTIFICATION_TYPES })
  type!: NotificationType;

  @Prop({ required: true, maxlength: 120 })
  title!: string;

  @Prop({ default: '', maxlength: 500 })
  body!: string;

  /** A site path such as /orders/<id>; never an external URL. */
  @Prop({ type: String, default: null, maxlength: 200 })
  link!: string | null;

  @Prop({ type: Date, default: null })
  readAt!: Date | null;
}
export type NotificationDocument = HydratedDocument<Notification>;
export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, readAt: 1 });
// Kept for 180 days, then removed by MongoDB.
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });
