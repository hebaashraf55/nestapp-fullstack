import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { DuplicateKeyError } from '../catalogue/catalogue.repositories';
import { Coupon, CouponUse } from './coupon.schema';
import {
  ClaimResult,
  CouponPatch,
  CouponRecord,
  CouponsRepository,
  NewCoupon,
  withPromotionDefaults,
} from './coupons.repository';

type CouponDoc = Partial<CouponRecord> & {
  id: string;
  code: string;
  expiresAt: Date;
  createdAt: Date;
};
const toRecord = (raw: CouponDoc): CouponRecord => {
  const d = withPromotionDefaults(raw);
  return {
    id: d.id,
    code: d.code,
    type: d.type,
    discountPercent: d.discountPercent ?? 0,
    amountOffCents: d.amountOffCents,
    minSubtotalCents: d.minSubtotalCents,
    startsAt: d.startsAt,
    expiresAt: d.expiresAt,
    maxUses: d.maxUses,
    usedCount: d.usedCount,
    maxUsesPerCustomer: d.maxUsesPerCustomer,
    scope: d.scope,
    productIds: [...d.productIds],
    categoryIds: [...d.categoryIds],
    automatic: d.automatic,
    active: d.active !== false, // created before the flag existed: active
    isDemo: d.isDemo === true,
    createdBy: d.createdBy ?? '',
    createdAt: d.createdAt,
  };
};
const isDuplicate = (e: unknown) => (e as { code?: number }).code === 11000;
const bad = (v: unknown) => typeof v !== 'string' || v === '';

@Injectable()
export class MongoCouponsRepository extends CouponsRepository {
  constructor(
    @InjectModel(Coupon.name) private readonly model: Model<Coupon>,
    @InjectModel(CouponUse.name) private readonly uses: Model<CouponUse>,
  ) {
    super();
  }

  private doc(d: unknown) {
    return toRecord(d as CouponDoc);
  }

  async findById(id: string) {
    if (!isValidObjectId(id)) return null;
    const doc = await this.model.findById(id).exec();
    return doc ? this.doc(doc.toObject({ virtuals: true })) : null;
  }
  async findByCode(code: string) {
    if (bad(code)) return null;
    const doc = await this.model.findOne({ code: { $eq: code } }).exec();
    return doc ? this.doc(doc.toObject({ virtuals: true })) : null;
  }
  async findAll() {
    const docs = await this.model.find().sort({ createdAt: -1 }).exec();
    return docs.map((d) => this.doc(d.toObject({ virtuals: true })));
  }
  async findAutomatic() {
    const docs = await this.model
      .find({ automatic: true, active: { $ne: false } })
      .limit(50)
      .exec();
    return docs.map((d) => this.doc(d.toObject({ virtuals: true })));
  }
  async create(record: NewCoupon) {
    try {
      const doc = await this.model.create(withPromotionDefaults(record));
      return this.doc(doc.toObject({ virtuals: true }));
    } catch (error) {
      if (isDuplicate(error)) throw new DuplicateKeyError();
      throw error;
    }
  }
  async update(id: string, patch: CouponPatch) {
    if (!isValidObjectId(id)) return null;
    const doc = await this.model
      .findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true })
      .exec();
    return doc ? this.doc(doc.toObject({ virtuals: true })) : null;
  }
  async delete(id: string) {
    if (!isValidObjectId(id)) return false;
    return (await this.model.deleteOne({ _id: id }).exec()).deletedCount === 1;
  }

  async usesBy(couponId: string, ownerId: string) {
    if (bad(couponId) || bad(ownerId)) return 0;
    const doc = await this.uses
      .findOne({ couponId: { $eq: couponId }, ownerId: { $eq: ownerId } })
      .lean()
      .exec();
    return doc?.count ?? 0;
  }

  async claim(couponId: string, ownerId: string, perCustomer: number | null): Promise<ClaimResult> {
    if (!isValidObjectId(couponId) || bad(ownerId)) return 'used-up';
    const taken = await this.model
      .findOneAndUpdate(
        {
          _id: couponId,
          $or: [
            { maxUses: null },
            { maxUses: { $exists: false } },
            { $expr: { $lt: ['$usedCount', '$maxUses'] } },
          ],
        },
        { $inc: { usedCount: 1 } },
        { new: true },
      )
      .exec();
    if (!taken) return 'used-up';
    if (perCustomer === null) {
      await this.uses
        .updateOne({ couponId, ownerId }, { $inc: { count: 1 } }, { upsert: true })
        .exec();
      return 'ok';
    }
    try {
      // Matches only while under the limit; at the limit the upsert collides with the unique index.
      await this.uses
        .updateOne(
          { couponId, ownerId, count: { $lt: perCustomer } },
          { $inc: { count: 1 } },
          { upsert: true },
        )
        .exec();
      return 'ok';
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      await this.model
        .updateOne({ _id: couponId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } })
        .exec();
      return 'customer-limit';
    }
  }

  async release(couponId: string, ownerId: string) {
    if (!isValidObjectId(couponId) || bad(ownerId)) return;
    await Promise.all([
      this.model
        .updateOne({ _id: couponId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } })
        .exec(),
      this.uses.updateOne({ couponId, ownerId, count: { $gt: 0 } }, { $inc: { count: -1 } }).exec(),
    ]);
  }
}
