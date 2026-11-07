import type {
  Carrier,
  OrderEventType,
  OrderStatus,
  PaymentStatus,
  ReturnStatus,
} from './order-status';

export interface OrderEvent {
  type: OrderEventType;
  at: Date;
  note: string | null;
}

export interface Shipment {
  carrier: Carrier;
  trackingNumber: string;
  shippedAt: Date;
  /** Always true: the carrier and label are simulated. */
  simulated: true;
}

export interface ReturnRequest {
  status: ReturnStatus;
  reason: string;
  requestedAt: Date;
  decidedAt: Date | null;
  /** The shop's note to the customer (why it was rejected, what happens next). */
  note: string | null;
}

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
  /** Bundle discounts at checkout (0 for orders placed before bundles existed). */
  bundleSavingsCents: number;
  /** The promotion whose use this order holds (given back if the order is cancelled or expires). */
  couponId: string | null;
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
  /** Newest last. Older orders have none; their timeline is rebuilt from the timestamps above. */
  events: OrderEvent[];
  returnRequest: ReturnRequest | null;
  shipment: Shipment | null;
  /** Guest checkout only: the address the confirmation was sent to. */
  guestEmail: string | null;
  /** SHA-256 of the guest's tracking code. The code itself is never stored. */
  guestTokenHash: string | null;
}

export type NewOrder = Omit<
  OrderRecord,
  | 'id'
  | 'createdAt'
  | 'bundleSavingsCents'
  | 'events'
  | 'returnRequest'
  | 'shipment'
  | 'couponId'
  | 'guestEmail'
  | 'guestTokenHash'
> & {
  bundleSavingsCents?: number;
  couponId?: string | null;
  guestEmail?: string | null;
  guestTokenHash?: string | null;
};
export type OrderPatch = Partial<
  Pick<
    OrderRecord,
    | 'status'
    | 'paymentStatus'
    | 'paidAt'
    | 'refundedAt'
    | 'cancelledAt'
    | 'returnRequest'
    | 'shipment'
  >
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
  /** How many orders that still hold reserved stock (see STOCK_HOLDING_STATUSES) contain this product. */
  abstract countStockHoldingWithProduct(productId: string): Promise<number>;
  /** Number of placed orders per coupon code (upper-case), for the admin coupon list. */
  abstract countByCouponCode(): Promise<Record<string, number>>;
  /** Units sold per product in paid, shipped or delivered orders, most first. */
  abstract bestSellers(
    limit: number,
    demoOnly: boolean,
  ): Promise<{ productId: string; units: number }[]>;
  /** Whether this user has a paid, shipped or delivered order containing the product. */
  abstract hasPurchased(userId: string, productId: string): Promise<boolean>;
  /** Unpaid orders whose hold has run out. */
  abstract findOverdue(now: Date, limit: number): Promise<OrderRecord[]>;
  /**
   * Compare-and-set: applies `patch` only if the order is still in one of `from`. Returns the updated
   * order, or null when another request already moved it (so only one caller wins a transition).
   */
  /**
   * Compare-and-set on the return request: applies only while the return is still in `fromReturn`
   * (null = no request yet) and the order is DELIVERED, appending `event` in the same update.
   */
  abstract updateReturn(
    id: string,
    fromReturn: ReturnStatus | null,
    patch: OrderPatch,
    event: OrderEvent,
  ): Promise<OrderRecord | null>;
  /** Orders placed, paid or refunded since `since` (for analytics), at most `limit`. */
  abstract findActivitySince(since: Date, demoOnly: boolean, limit: number): Promise<OrderRecord[]>;
  /** Orders with a return request, newest request first. */
  abstract findReturns(
    status: ReturnStatus | undefined,
    demoOnly: boolean,
    limit: number,
  ): Promise<OrderRecord[]>;
  /** `event`, when given, is appended to the timeline in the same atomic update. */
  abstract transition(
    id: string,
    from: readonly OrderStatus[],
    patch: OrderPatch,
    event?: OrderEvent,
  ): Promise<OrderRecord | null>;
}
