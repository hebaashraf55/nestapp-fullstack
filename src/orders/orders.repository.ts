import type { OrderStatus, PaymentStatus } from './order-status';

export interface OrderItemRecord {
  productId: string;
  /** Snapshot taken when the order was placed; later catalogue edits never change a placed order. */
  name: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}

export interface OrderRecord {
  id: string;
  userId: string;
  isDemo: boolean;
  items: OrderItemRecord[];
  subtotalCents: number;
  couponCode: string | null;
  couponPercent: number | null;
  discountCents: number;
  totalCents: number;
  currency: string;
  address: string;
  phone: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  expiresAt: Date;
  paidAt: Date | null;
  refundedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
}

export type NewOrder = Omit<OrderRecord, 'id' | 'createdAt'>;
export type OrderPatch = Partial<
  Pick<OrderRecord, 'status' | 'paymentStatus' | 'paidAt' | 'refundedAt' | 'cancelledAt'>
>;

export interface OrderPageFilter {
  status?: OrderStatus;
  /** True for the demo viewer: only synthetic orders. */
  demoOnly: boolean;
  page: number;
  limit: number;
}

export interface OrderSummary {
  countsByStatus: Partial<Record<OrderStatus, number>>;
  /** Sum of totals whose payment is SIMULATED_PAID. No money was ever taken. */
  paidCents: number;
  /** Sum of totals whose payment is SIMULATED_REFUNDED. */
  refundedCents: number;
}

export abstract class OrdersRepository {
  /** Newest first, for the admin order list. */
  abstract findPage(filter: OrderPageFilter): Promise<{ items: OrderRecord[]; total: number }>;
  abstract summarize(demoOnly: boolean): Promise<OrderSummary>;
  abstract create(order: NewOrder): Promise<OrderRecord>;
  abstract findById(id: string): Promise<OrderRecord | null>;
  /** Newest first. */
  abstract findByUser(userId: string, limit: number): Promise<OrderRecord[]>;
  abstract countPending(userId: string): Promise<number>;
  /** Unpaid orders whose hold has run out. */
  abstract findOverdue(now: Date, limit: number): Promise<OrderRecord[]>;
  /**
   * Compare-and-set: applies `patch` only if the order is still in one of `from`. Returns the updated
   * order, or null when another request already moved it (so only one caller wins a transition).
   */
  abstract transition(
    id: string,
    from: readonly OrderStatus[],
    patch: OrderPatch,
  ): Promise<OrderRecord | null>;
}
