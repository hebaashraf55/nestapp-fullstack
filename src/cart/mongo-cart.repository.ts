import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cart } from './cart.schema';
import { CartData, CartRecord, CartsRepository, VersionConflictError } from './cart.repository';

@Injectable()
export class MongoCartsRepository extends CartsRepository {
  constructor(@InjectModel(Cart.name) private readonly model: Model<Cart>) {
    super();
  }

  async findByUser(userId: string): Promise<CartRecord | null> {
    const doc = await this.model.findOne({ user: { $eq: userId } }).exec();
    if (!doc) return null;
    return {
      userId: doc.user,
      items: doc.items.map((i) => ({ productId: String(i.productId), quantity: i.quantity })),
      couponId: doc.couponId ? String(doc.couponId) : null,
      version: doc.version,
    };
  }

  async save(userId: string, expectedVersion: number, data: CartData): Promise<void> {
    if (expectedVersion === 0) {
      try {
        await this.model.create({ user: userId, ...data, version: 1 });
        return;
      } catch (error) {
        if ((error as { code?: number }).code === 11000) throw new VersionConflictError();
        throw error;
      }
    }
    const result = await this.model
      .updateOne(
        { user: { $eq: userId }, version: { $eq: expectedVersion } },
        { $set: { items: data.items, couponId: data.couponId }, $inc: { version: 1 } },
        { runValidators: true },
      )
      .exec();
    if (result.matchedCount !== 1) throw new VersionConflictError();
  }
}
