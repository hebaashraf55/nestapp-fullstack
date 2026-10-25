import type { OrderStatus, PaymentStatus } from '../api/client';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Awaiting simulated payment',
  PAID: 'Paid (simulated)',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

export const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  SIMULATED_UNPAID: 'Simulated payment: not yet paid',
  SIMULATED_PAID: 'Simulated payment: paid',
  SIMULATED_REFUNDED: 'Simulated payment: refunded',
};

export const formatDate = (iso: string): string =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

/** "12:34" style countdown; empty string once the time has passed. */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return '';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
