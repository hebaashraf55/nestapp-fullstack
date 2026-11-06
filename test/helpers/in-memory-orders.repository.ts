import { randomBytes } from 'node:crypto';
import { STOCK_HOLDING_STATUSES, type OrderStatus } from '../../src/orders/order-status';
import {
  NewOrder,
  OrderPageFilter,
  OrderPatch,
  OrderRecord,
  OrdersRepository,
  OrderSummary,
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
  async findPage(filter: OrderPageFilter) {
    this.check();
    const all = [...this.records.values()]
      .filter(
        (o) => (!filter.demoOnly || o.isDemo) && (!filter.status || o.status === filter.status),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (filter.page - 1) * filter.limit;
    return {
      items: all.slice(start, start + filter.limit).map((o) => ({ ...o })),
      total: all.length,
    };
  }
  async summarize(demoOnly: boolean): Promise<OrderSummary> {
    this.check();
    const summary: OrderSummary = { countsByStatus: {}, paidCents: 0, refundedCents: 0 };
    for (const o of this.records.values()) {
      if (demoOnly && !o.isDemo) continue;
      summary.countsByStatus[o.status] = (summary.countsByStatus[o.status] ?? 0) + 1;
      if (o.paymentStatus === 'SIMULATED_PAID') summary.paidCents += o.totalCents;
      if (o.paymentStatus === 'SIMULATED_REFUNDED') summary.refundedCents += o.totalCents;
    }
    return summary;
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
  async countStockHoldingWithProduct(productId: string) {
    this.check();
    const holding: readonly OrderStatus[] = STOCK_HOLDING_STATUSES;
    return [...this.records.values()].filter(
      (o) => holding.includes(o.status) && o.items.some((i) => i.productId === productId),
    ).length;
  }
  async bestSellers(limit: number, demoOnly: boolean) {
    this.check();
    const units = new Map<string, number>();
    for (const o of this.records.values()) {
      if (!['PAID', 'SHIPPED', 'DELIVERED'].includes(o.status) || (demoOnly && !o.isDemo)) continue;
      for (const i of o.items) units.set(i.productId, (units.get(i.productId) ?? 0) + i.quantity);
    }
    return [...units.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([productId, u]) => ({ productId, units: u }));
  }

  async countByCouponCode() {
    this.check();
    const counts: Record<string, number> = {};
    for (const o of this.records.values()) {
      if (o.couponCode) counts[o.couponCode] = (counts[o.couponCode] ?? 0) + 1;
    }
    return counts;
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
