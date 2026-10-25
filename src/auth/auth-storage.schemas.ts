import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ collection: 'otps', timestamps: false })
export class Otp {
  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true, enum: ['verify-email', 'reset-password'] })
  purpose!: string;

  @Prop({ required: true })
  codeHash!: string;

  /** MongoDB removes the document shortly after this moment (TTL index). */
  @Prop({ required: true, index: { expireAfterSeconds: 0 } })
  expiresAt!: Date;

  @Prop({ required: true, default: 0 })
  attempts!: number;

  @Prop({ required: true })
  sentAt!: Date;
}
export const OtpSchema = SchemaFactory.createForClass(Otp);
OtpSchema.index({ userId: 1, purpose: 1 }, { unique: true });

@Schema({ collection: 'refreshtokens', timestamps: { createdAt: true, updatedAt: false } })
export class RefreshToken {
  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true, index: true })
  familyId!: string;

  @Prop({ required: true, unique: true })
  tokenHash!: string;

  @Prop({ required: true, index: { expireAfterSeconds: 0 } })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;
}
export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);
