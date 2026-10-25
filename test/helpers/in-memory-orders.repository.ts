import { randomBytes } from 'node:crypto';
import type { OrderStatus } from '../../src/orders/order-status';
import {
  NewOrder,
  OrderPatch,
  OrderRecord,
  OrdersRepository,
} from '../../src/orders/orders.repository';

/** Test-only fake of the persistence port. Never wired into the real application. */
export class InMemoryOrdersRepository extends OrdersRepository {
  readonly records = new Map<string, OrderRecord>();
  failWith: Error | null = null;
  private tick = 0;
  private check() {
    if (this.failWith) throw this.failWith;
  }
  async create(order: NewOrder) {
    this.check();
    const created: OrderRecord = {
      ...order,
      id: randomBytes(12).toString('hex'),
      createdAt: new Date(Date.now() + this.tick++),
    };
    this.records.set(created.id, created);
    return { ...created };
  }
  async findById(id: string) {
    this.check();
    const found = this.records.get(id);
    return found ? { ...found } : null;
  }
  async findByUser(userId: string, limit: number) {
    this.check();
    return [...this.records.values()]
      .filter((o) => o.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((o) => ({ ...o }));
  }
  async countPending(userId: string) {
    this.check();
    return [...this.records.values()].filter(
      (o) => o.userId === userId && o.status === 'PENDING_PAYMENT',
    ).length;
  }
  async findOverdue(now: Date, limit: number) {
    this.check();
    return [...this.records.values()]
      .filter((o) => o.status === 'PENDING_PAYMENT' && o.expiresAt.getTime() <= now.getTime())
      .slice(0, limit)
      .map((o) => ({ ...o }));
  }
  async transition(id: string, from: readonly OrderStatus[], patch: OrderPatch) {
    this.check();
    const current = this.records.get(id);
    if (!current || !from.includes(current.status)) return null;
    const next = { ...current, ...patch };
    this.records.set(id, next);
    return { ...next };
  }
}
