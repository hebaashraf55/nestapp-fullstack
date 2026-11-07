import { MovementReason } from './movement.schema';

export interface MovementRecord {
  id: string;
  productId: string;
  productName: string;
  change: number;
  reason: MovementReason;
  note: string | null;
  orderId: string | null;
  actorId: string | null;
  isDemo: boolean;
  createdAt: Date;
}
export type NewMovement = Omit<MovementRecord, 'id' | 'createdAt'>;

export interface MovementFilter {
  productId?: string;
  reason?: MovementReason;
  demoOnly: boolean;
  page: number;
  limit: number;
}

/** Append-only: movements are never edited or deleted. */
export abstract class InventoryRepository {
  abstract append(entries: NewMovement[]): Promise<void>;
  abstract findPage(filter: MovementFilter): Promise<{ items: MovementRecord[]; total: number }>;
}
