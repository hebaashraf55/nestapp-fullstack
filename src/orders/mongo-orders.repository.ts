import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { Order } from './order.schema';
import type { OrderStatus, PaymentStatus } from './order-status';
import { NewOrder, OrderPatch, OrderRecord, OrdersRepository } from './orders.repository';

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
});

@Injectable()
export class MongoOrdersRepository extends OrdersRepository {
  constructor(@InjectModel(Order.name) private readonly model: Model<Order>) {
    super();
  }

  async create(order: NewOrder) {
    return toRecord((await this.model.create(order)) as unknown as OrderDoc);
  }

  async findById(id: string) {
    if (!isValidObjectId(id)) return null;
    const doc = await this.model.findById(id).exec();
    return doc ? toRecord(doc as unknown as OrderDoc) : null;
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

  async findOverdue(now: Date, limit: number) {
    const docs = await this.model
      .find({ status: 'PENDING_PAYMENT', expiresAt: { $lte: now } })
      .limit(limit)
      .exec();
    return docs.map((d) => toRecord(d as unknown as OrderDoc));
  }

  async transition(id: string, from: readonly OrderStatus[], patch: OrderPatch) {
    if (!isValidObjectId(id)) return null;
    const doc = await this.model
      .findOneAndUpdate({ _id: id, status: { $in: [...from] } }, { $set: patch }, { new: true })
      .exec();
    return doc ? toRecord(doc as unknown as OrderDoc) : null;
  }
}
