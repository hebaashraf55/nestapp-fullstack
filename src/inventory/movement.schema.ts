import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** Why stock changed. Admin reasons are chosen by a person; the others are written by the system. */
export const ADMIN_STOCK_REASONS = ['RECEIVED', 'CORRECTION', 'DAMAGED', 'LOST'] as const;
export const MOVEMENT_REASONS = [
  'INITIAL',
  ...ADMIN_STOCK_REASONS,
  'ORDER_RESERVED',
  'ORDER_RELEASED',
  'RETURN_RESTOCK',
] as const;
export type MovementReason = (typeof MOVEMENT_REASONS)[number];

@Schema({ collection: 'inventory_movements', timestamps: { createdAt: true, updatedAt: false } })
export class InventoryMovement {
  @Prop({ required: true })
  productId!: string;

  /** Snapshot, so history still reads well after a product is renamed or deleted. */
  @Prop({ required: true, maxlength: 100 })
  productName!: string;

  /** Positive adds stock, negative removes it. Never zero. */
  @Prop({ required: true })
  change!: number;

  @Prop({ required: true, enum: MOVEMENT_REASONS })
  reason!: MovementReason;

  @Prop({ type: String, default: null, maxlength: 300 })
  note!: string | null;

  @Prop({ type: String, default: null })
  orderId!: string | null;

  /** The admin who made a manual change; null for system movements. */
  @Prop({ type: String, default: null })
  actorId!: string | null;

  @Prop({ required: true, default: false })
  isDemo!: boolean;
}
export type InventoryMovementDocument = HydratedDocument<InventoryMovement>;
export const InventoryMovementSchema = SchemaFactory.createForClass(InventoryMovement);
InventoryMovementSchema.index({ productId: 1, createdAt: -1 });
InventoryMovementSchema.index({ createdAt: -1 });
InventoryMovementSchema.index({ reason: 1, createdAt: -1 });
