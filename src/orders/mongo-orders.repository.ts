import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { Order } from './order.schema';
import {
  STOCK_HOLDING_STATUSES,
  type OrderStatus,
  type PaymentStatus,
  type ReturnStatus,
} from './order-status';
import {
  NewOrder,
  OrderEvent,
  OrderPageFilter,
  OrderPatch,
  OrderRecord,
  OrdersRepository,
  OrderSummary,
} from './orders.repository';

interface OrderDoc {
  id: string;
  userId: string;
  isDemo: boolean;
  items: {
    productId: unknown;
    name: string;
    unitPriceCents: number;
    quantity: number;
    lineTotalCents: number;
  }[];
  subtotalCents: number;
  bundleSavingsCents?: number;
  couponCode?: string | null;
  couponPercent?: number | null;
  discountCents: number;
  totalCents: number;
  currency: string;
  address: string;
  phone: string;
  status: string;
  paymentStatus: string;
  expiresAt: Date;
  paidAt?: Date | null;
  refundedAt?: Date | null;
  cancelledAt?: Date | null;
  createdAt: Date;
  events?: { type: string; at: Date; note?: string | null }[];
  returnRequest?: {
    status: string;
    reason: string;
    requestedAt: Date;
    decidedAt?: Date | null;
    note?: string | null;
  } | null;
  guestEmail?: string | null;
  guestTokenHash?: string | null;
}

const toRecord = (d: OrderDoc): OrderRecord => ({
  id: d.id,
  userId: d.userId,
  isDemo: d.isDemo,
  items: d.items.map((i) => ({
    productId: String(i.productId),
    name: i.name,
    unitPriceCents: i.unitPriceCents,
    quantity: i.quantity,
    lineTotalCents: i.lineTotalCents,
  })),
  subtotalCents: d.subtotalCents,
  bundleSavingsCents: d.bundleSavingsCents ?? 0,
  couponCode: d.couponCode ?? null,
  couponPercent: d.couponPercent ?? null,
  discountCents: d.discountCents,
  totalCents: d.totalCents,
  currency: d.currency,
  address: d.address,
  phone: d.phone,
  status: d.status as OrderStatus,
  paymentStatus: d.paymentStatus as PaymentStatus,
  expiresAt: d.expiresAt,
  paidAt: d.paidAt ?? null,
  refundedAt: d.refundedAt ?? null,
  cancelledAt: d.cancelledAt ?? null,
  createdAt: d.createdAt,
  events: (d.events ?? []).map((e) => ({
    type: e.type as OrderEvent['type'],
    at: e.at,
    note: e.note ?? null,
  })),
  returnRequest: d.returnRequest
    ? {
        status: d.returnRequest.status as ReturnStatus,
        reason: d.returnRequest.reason,
        requestedAt: d.returnRequest.requestedAt,
        decidedAt: d.returnRequest.decidedAt ?? null,
        note: d.returnRequest.note ?? null,
      }
    : null,
  guestEmail: d.guestEmail ?? null,
  guestTokenHash: d.guestTokenHash ?? null,
});

@Injectable()
export class MongoOrdersRepository extends OrdersRepository {
  constructor(@InjectModel(Order.name) private readonly model: Model<Order>) {
    super();
  }

  async create(order: NewOrder) {
    const doc = await this.model.create({
      ...order,
      events: [{ type: 'PLACED', at: new Date(), note: null }],
      returnRequest: null,
    });
    return toRecord(doc as unknown as OrderDoc);
  }

  async findById(id: string) {
    if (!isValidObjectId(id)) return null;
    const doc = await this.model.findById(id).exec();
    return doc ? toRecord(doc as unknown as OrderDoc) : null;
  }

  async findPage(filter: OrderPageFilter) {
    const query: Record<string, unknown> = {};
    if (filter.demoOnly) query.isDemo = true;
    if (filter.status) query.status = { $eq: filter.status };
    const [docs, total] = await Promise.all([
      this.model
        .find(query)
        .sort({ createdAt: -1 })
        .skip((filter.page - 1) * filter.limit)
        .limit(filter.limit)
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { items: docs.map((d) => toRecord(d as unknown as OrderDoc)), total };
  }

  async summarize(demoOnly: boolean): Promise<OrderSummary> {
    const rows = await this.model
      .aggregate<{ _id: OrderStatus; count: number; paid: number; refunded: number }>([
        { $match: demoOnly ? { isDemo: true } : {} },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            paid: {
              $sum: { $cond: [{ $eq: ['$paymentStatus', 'SIMULATED_PAID'] }, '$totalCents', 0] },
            },
            refunded: {
              $sum: {
                $cond: [{ $eq: ['$paymentStatus', 'SIMULATED_REFUNDED'] }, '$totalCents', 0],
              },
            },
          },
        },
      ])
      .exec();
    const summary: OrderSummary = { countsByStatus: {}, paidCents: 0, refundedCents: 0 };
    for (const row of rows) {
      summary.countsByStatus[row._id] = row.count;
      summary.paidCents += row.paid;
      summary.refundedCents += row.refunded;
    }
    return summary;
  }

  async findByUser(userId: string, limit: number) {
    const docs = await this.model
      .find({ userId: { $eq: userId } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
    return docs.map((d) => toRecord(d as unknown as OrderDoc));
  }

  countPending(userId: string) {
    return this.model.countDocuments({ userId: { $eq: userId }, status: 'PENDING_PAYMENT' }).exec();
  }

  countStockHoldingWithProduct(productId: string) {
    return this.model
      .countDocuments({
        status: { $in: [...STOCK_HOLDING_STATUSES] },
        'items.productId': { $eq: productId },
      })
      .exec();
  }

  async bestSellers(limit: number, demoOnly: boolean) {
    const rows = await this.model
      .aggregate<{ _id: string; units: number }>([
        {
          $match: {
            status: { $in: ['PAID', 'SHIPPED', 'DELIVERED'] },
            ...(demoOnly ? { isDemo: true } : {}),
          },
        },
        { $unwind: '$items' },
        { $group: { _id: '$items.productId', units: { $sum: '$items.quantity' } } },
        { $sort: { units: -1, _id: 1 } },
        { $limit: limit },
      ])
      .exec();
    return rows.map((r) => ({ productId: r._id, units: r.units }));
  }

  async hasPurchased(userId: string, productId: string) {
    if (typeof userId !== 'string' || !isValidObjectId(productId)) return false;
    const count = await this.model
      .countDocuments({
        userId: { $eq: userId },
        status: { $in: ['PAID', 'SHIPPED', 'DELIVERED'] },
        'items.productId': { $eq: productId },
      })
      .limit(1)
      .exec();
    return count > 0;
  }

  async countByCouponCode() {
    const rows = await this.model
      .aggregate<{ _id: string; count: number }>([
        { $match: { couponCode: { $type: 'string' } } },
        { $group: { _id: '$couponCode', count: { $sum: 1 } } },
      ])
      .exec();
    return Object.fromEntries(rows.map((r) => [r._id, r.count]));
  }

  async findOverdue(now: Date, limit: number) {
    const docs = await this.model
      .find({ status: 'PENDING_PAYMENT', expiresAt: { $lte: now } })
      .limit(limit)
      .exec();
    return docs.map((d) => toRecord(d as unknown as OrderDoc));
  }

  async transition(
    id: string,
    from: readonly OrderStatus[],
    patch: OrderPatch,
    event?: OrderEvent,
  ) {
    if (!isValidObjectId(id)) return null;
    const doc = await this.model
      .findOneAndUpdate(
        { _id: id, status: { $in: [...from] } },
        { $set: patch, ...(event ? { $push: { events: event } } : {}) },
        { new: true, runValidators: true },
      )
      .exec();
    return doc ? toRecord(doc as unknown as OrderDoc) : null;
  }

  async updateReturn(
    id: string,
    fromReturn: ReturnStatus | null,
    patch: OrderPatch,
    event: OrderEvent,
  ) {
    if (!isValidObjectId(id)) return null;
    const doc = await this.model
      .findOneAndUpdate(
        {
          _id: id,
          status: 'DELIVERED',
          ...(fromReturn === null
            ? { returnRequest: null }
            : { 'returnRequest.status': fromReturn }),
        },
        { $set: patch, $push: { events: event } },
        { new: true, runValidators: true },
      )
      .exec();
    return doc ? toRecord(doc as unknown as OrderDoc) : null;
  }

  async findReturns(status: ReturnStatus | undefined, demoOnly: boolean, limit: number) {
    const docs = await this.model
      .find({
        returnRequest: { $ne: null },
        ...(status ? { 'returnRequest.status': status } : {}),
        ...(demoOnly ? { isDemo: true } : {}),
      })
      .sort({ 'returnRequest.requestedAt': -1 })
      .limit(limit)
      .exec();
    return docs.map((d) => toRecord(d as unknown as OrderDoc));
  }
}
