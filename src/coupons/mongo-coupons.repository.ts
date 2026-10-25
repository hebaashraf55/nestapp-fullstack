import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { DuplicateKeyError } from '../catalogue/catalogue.repositories';
import { Coupon } from './coupon.schema';
import { CouponPatch, CouponRecord, CouponsRepository, NewCoupon } from './coupons.repository';

interface CouponDoc {
  id: string;
  code: string;
  discountPercent: number;
  expiresAt: Date;
  isDemo: boolean;
  createdBy: string;
  createdAt: Date;
}
const toRecord = (d: CouponDoc): CouponRecord => ({
  id: d.id,
  code: d.code,
  discountPercent: d.discountPercent,
  expiresAt: d.expiresAt,
  isDemo: d.isDemo,
  createdBy: d.createdBy,
  createdAt: d.createdAt,
});

@Injectable()
export class MongoCouponsRepository extends CouponsRepository {
  constructor(@InjectModel(Coupon.name) private readonly model: Model<Coupon>) {
    super();
  }

  async findById(id: string) {
    if (!isValidObjectId(id)) return null;
    const doc = await this.model.findById(id).exec();
    return doc ? toRecord(doc as unknown as CouponDoc) : null;
  }
  async findByCode(code: string) {
    const doc = await this.model.findOne({ code: { $eq: code } }).exec();
    return doc ? toRecord(doc as unknown as CouponDoc) : null;
  }
  async findAll() {
    const docs = await this.model.find().sort({ createdAt: -1 }).exec();
    return docs.map((d) => toRecord(d as unknown as CouponDoc));
  }
  async create(record: NewCoupon) {
    try {
      return toRecord((await this.model.create(record)) as unknown as CouponDoc);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new DuplicateKeyError();
      throw error;
    }
  }
  async update(id: string, patch: CouponPatch) {
    if (!isValidObjectId(id)) return null;
    const doc = await this.model
      .findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true })
      .exec();
    return doc ? toRecord(doc as unknown as CouponDoc) : null;
  }
  async delete(id: string) {
    if (!isValidObjectId(id)) return false;
    return (await this.model.deleteOne({ _id: id }).exec()).deletedCount === 1;
  }
}
