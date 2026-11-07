import { OrderRecord } from '../orders/orders.repository';

export interface AnalyticsDay {
  /** UTC date, YYYY-MM-DD. */
  date: string;
  ordersPlaced: number;
  ordersPaid: number;
  /** Simulated: totals of orders paid that day. */
  paidCents: number;
  /** Simulated: totals of orders refunded that day. */
  refundedCents: number;
}

export interface Analytics {
  days: number;
  from: string;
  to: string;
  currency: string;
  /** True if the period held more orders than the report reads; the figures are then incomplete. */
  truncated: boolean;
  totals: {
    ordersPlaced: number;
    ordersPaid: number;
    paidCents: number;
    refundedCents: number;
    netCents: number;
    averageOrderCents: number | null;
    /** Paid ÷ placed, for orders placed in the period. Null when none were placed. */
    paymentRate: number | null;
    bundleSavingsCents: number;
    discountCents: number;
  };
  daily: AnalyticsDay[];
  topProducts: { productId: string; name: string; units: number; revenueCents: number }[];
  statusOfPlaced: Record<string, number>;
  customers: { buyers: number; returning: number; guestOrders: number };
  coupons: { code: string; orders: number; discountCents: number }[];
  returns: { requested: number; received: number; rate: number | null };
}

const DAY = 24 * 60 * 60 * 1000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const within = (d: Date | null | undefined, from: number, to: number) =>
  d instanceof Date && d.getTime() >= from && d.getTime() < to;

/**
 * Every figure is derived from stored orders; nothing is estimated or filled in. A "paid" order is one
 * whose simulated payment happened in the period; it still counts as paid if it was refunded later
 * (the refund is reported on the day it happened).
 */
export function computeAnalytics(
  orders: OrderRecord[],
  days: number,
  now: number,
  truncated: boolean,
): Analytics {
  const end =
    Date.UTC(
      new Date(now).getUTCFullYear(),
      new Date(now).getUTCMonth(),
      new Date(now).getUTCDate(),
    ) + DAY;
  const start = end - days * DAY;
  const daily = new Map<string, AnalyticsDay>();
  for (let t = start; t < end; t += DAY) {
    const date = iso(new Date(t));
    daily.set(date, { date, ordersPlaced: 0, ordersPaid: 0, paidCents: 0, refundedCents: 0 });
  }
  const statusOfPlaced: Record<string, number> = {};
  const products = new Map<
    string,
    { productId: string; name: string; units: number; revenueCents: number }
  >();
  const paidByOwner = new Map<string, number>();
  const coupons = new Map<string, { code: string; orders: number; discountCents: number }>();
  let placed = 0;
  let placedThenPaid = 0;
  let paid = 0;
  let paidCents = 0;
  let refundedCents = 0;
  let bundleSavingsCents = 0;
  let discountCents = 0;
  let guestOrders = 0;
  let returnsRequested = 0;
  let returnsReceived = 0;
  let delivered = 0;

  for (const o of orders) {
    if (within(o.createdAt, start, end)) {
      placed++;
      daily.get(iso(o.createdAt))!.ordersPlaced++;
      statusOfPlaced[o.status] = (statusOfPlaced[o.status] ?? 0) + 1;
      if (o.paidAt) placedThenPaid++;
      if (o.userId.startsWith('guest:')) guestOrders++;
    }
    if (within(o.paidAt, start, end)) {
      paid++;
      paidCents += o.totalCents;
      bundleSavingsCents += o.bundleSavingsCents;
      discountCents += o.discountCents;
      const day = daily.get(iso(o.paidAt!))!;
      day.ordersPaid++;
      day.paidCents += o.totalCents;
      paidByOwner.set(o.userId, (paidByOwner.get(o.userId) ?? 0) + 1);
      if (o.couponCode) {
        const c = coupons.get(o.couponCode) ?? { code: o.couponCode, orders: 0, discountCents: 0 };
        c.orders++;
        c.discountCents += o.discountCents;
        coupons.set(o.couponCode, c);
      }
      // Products sold: only orders that were not refunded count as sales.
      if (o.paymentStatus === 'SIMULATED_PAID')
        for (const i of o.items) {
          const p = products.get(i.productId) ?? {
            productId: i.productId,
            name: i.name,
            units: 0,
            revenueCents: 0,
          };
          p.units += i.quantity;
          p.revenueCents += i.lineTotalCents;
          products.set(i.productId, p);
        }
    }
    if (within(o.refundedAt, start, end)) {
      refundedCents += o.totalCents;
      daily.get(iso(o.refundedAt!))!.refundedCents += o.totalCents;
    }
    if (o.returnRequest && within(o.returnRequest.requestedAt, start, end)) returnsRequested++;
    if (o.returnRequest?.status === 'RECEIVED' && within(o.returnRequest.decidedAt, start, end))
      returnsReceived++;
    if (o.events.some((e) => e.type === 'DELIVERED' && within(e.at, start, end))) delivered++;
  }

  return {
    days,
    from: iso(new Date(start)),
    to: iso(new Date(end - DAY)),
    currency: 'USD',
    truncated,
    totals: {
      ordersPlaced: placed,
      ordersPaid: paid,
      paidCents,
      refundedCents,
      netCents: paidCents - refundedCents,
      averageOrderCents: paid ? Math.round(paidCents / paid) : null,
      paymentRate: placed ? placedThenPaid / placed : null,
      bundleSavingsCents,
      discountCents,
    },
    daily: [...daily.values()],
    topProducts: [...products.values()]
      .sort((a, b) => b.units - a.units || b.revenueCents - a.revenueCents)
      .slice(0, 10),
    statusOfPlaced,
    customers: {
      buyers: [...paidByOwner.keys()].filter((k) => !k.startsWith('guest:')).length,
      returning: [...paidByOwner.entries()].filter(([k, n]) => !k.startsWith('guest:') && n > 1)
        .length,
      guestOrders,
    },
    coupons: [...coupons.values()].sort((a, b) => b.orders - a.orders),
    returns: {
      requested: returnsRequested,
      received: returnsReceived,
      rate: delivered ? returnsRequested / delivered : null,
    },
  };
}
