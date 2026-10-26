import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ collection: 'audit_log', timestamps: { createdAt: true, updatedAt: false } })
export class AuditLog {
  @Prop({ required: true, maxlength: 64 })
  actorId!: string;

  @Prop({ required: true, maxlength: 32 })
  actorRole!: string;

  @Prop({ required: true, maxlength: 64, index: true })
  action!: string;

  @Prop({ type: String, default: null, maxlength: 64 })
  targetId!: string | null;

  @Prop({ type: String, default: null, maxlength: 60 })
  detail!: string | null;
}
export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ createdAt: -1 });
