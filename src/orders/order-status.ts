/*
 * Order state machine. Every payment state carries the word SIMULATED on purpose: no money ever moves.
 *
 *   PENDING_PAYMENT --simulate-payment--> PAID --admin--> SHIPPED --admin--> DELIVERED
 *        |  \                              |
 *        |   expiry (automatic) -> EXPIRED |
 *        admin cancel -> CANCELLED         admin simulated refund -> CANCELLED (+ SIMULATED_REFUNDED)
 *
 * Stock is reserved when the order is placed and restored when it expires, is cancelled before payment
 * or is refunded before shipment.
 */
export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PAID',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = [
  'SIMULATED_UNPAID',
  'SIMULATED_PAID',
  'SIMULATED_REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** What an admin may set directly. Payment and refund have their own routes. */
export const ADMIN_STATUS_TARGETS = ['SHIPPED', 'DELIVERED', 'CANCELLED'] as const;

const ADMIN_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING_PAYMENT: ['CANCELLED'],
  PAID: ['SHIPPED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export const canAdminTransition = (from: OrderStatus, to: OrderStatus): boolean =>
  ADMIN_TRANSITIONS[from].includes(to);

/** How long an unpaid order holds its stock. */
export const ORDER_TTL_MS = 30 * 60 * 1000;
/** Cap on unpaid orders per user, so one account cannot lock up the stock. */
export const MAX_PENDING_ORDERS = 3;

export const SIMULATION_NOTICE = 'Simulated payment: no payment was taken and no card was charged.';
