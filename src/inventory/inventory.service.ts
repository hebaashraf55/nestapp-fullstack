import { Injectable, Logger } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { demoScope } from '../auth/demo-scope';
import { InventoryRepository, MovementRecord } from './inventory.repository';
import { MovementReason } from './movement.schema';

export interface MovementInput {
  productId: string;
  productName: string;
  change: number;
  reason: MovementReason;
  note?: string | null;
  orderId?: string | null;
  actorId?: string | null;
  isDemo?: boolean;
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(private readonly repo: InventoryRepository) {}

  /**
   * Written after the stock update succeeds. The stock change itself is atomic and authoritative; if
   * the history entry cannot be saved, the failure is logged (with the details needed to repair it)
   * rather than undoing a correct stock change or failing the customer's order.
   */
  async record(entries: MovementInput[]): Promise<void> {
    const rows = entries
      .filter((e) => e.change !== 0)
      .map((e) => ({
        productId: e.productId,
        productName: e.productName.slice(0, 100),
        change: e.change,
        reason: e.reason,
        note: e.note ?? null,
        orderId: e.orderId ?? null,
        actorId: e.actorId ?? null,
        isDemo: e.isDemo ?? false,
      }));
    if (rows.length === 0) return;
    try {
      await this.repo.append(rows);
    } catch (error) {
      this.logger.error(`Inventory history not saved: ${JSON.stringify(rows)} (${String(error)})`);
    }
  }

  async list(
    query: { productId?: string; reason?: MovementReason; page: number; limit: number },
    viewer: AuthenticatedUser,
  ): Promise<{
    items: MovementRecord[];
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  }> {
    const { items, total } = await this.repo.findPage({
      ...query,
      demoOnly: demoScope(viewer).isDemo === true,
    });
    return {
      items,
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }
}
