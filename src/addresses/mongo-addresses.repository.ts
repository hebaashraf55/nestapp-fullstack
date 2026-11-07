import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Address } from './address.schema';
import { AddressFields, AddressRecord, AddressesRepository } from './addresses.repository';

type Doc = Address & { _id: Types.ObjectId; createdAt: Date };
const toRecord = (d: Doc): AddressRecord => ({
  id: d._id.toString(),
  userId: d.userId,
  label: d.label ?? '',
  fullName: d.fullName,
  line1: d.line1,
  line2: d.line2 ?? '',
  city: d.city,
  postalCode: d.postalCode,
  country: d.country,
  phone: d.phone,
  isDefault: d.isDefault === true,
  createdAt: d.createdAt,
});
const ok = (id: string, userId: string) =>
  isValidObjectId(id) && typeof userId === 'string' && userId !== '';
const owned = (id: string, userId: string) => ({
  _id: new Types.ObjectId(id),
  userId: { $eq: userId },
});

@Injectable()
export class MongoAddressesRepository extends AddressesRepository {
  constructor(@InjectModel(Address.name) private readonly model: Model<Address>) {
    super();
  }

  async list(userId: string) {
    if (typeof userId !== 'string') return [];
    const docs = await this.model
      .find({ userId: { $eq: userId } })
      .sort({ isDefault: -1, createdAt: 1 })
      .limit(20)
      .lean<Doc[]>()
      .exec();
    return docs.map(toRecord);
  }

  count(userId: string) {
    if (typeof userId !== 'string') return Promise.resolve(0);
    return this.model.countDocuments({ userId: { $eq: userId } }).exec();
  }

  async findOwned(id: string, userId: string) {
    if (!ok(id, userId)) return null;
    const d = await this.model.findOne(owned(id, userId)).lean<Doc>().exec();
    return d ? toRecord(d) : null;
  }

  async create(userId: string, fields: AddressFields, isDefault: boolean) {
    if (isDefault)
      await this.model
        .updateMany({ userId: { $eq: userId } }, { $set: { isDefault: false } })
        .exec();
    try {
      const doc = await this.model.create({ ...fields, userId, isDefault });
      return toRecord(doc.toObject() as unknown as Doc);
    } catch (e) {
      // A concurrent request made another default first: keep theirs, save this one as non-default.
      if ((e as { code?: number }).code !== 11000) throw e;
      const doc = await this.model.create({ ...fields, userId, isDefault: false });
      return toRecord(doc.toObject() as unknown as Doc);
    }
  }

  async update(id: string, userId: string, fields: Partial<AddressFields>) {
    if (!ok(id, userId)) return null;
    const d = await this.model
      .findOneAndUpdate(owned(id, userId), { $set: fields }, { new: true, runValidators: true })
      .lean<Doc>()
      .exec();
    return d ? toRecord(d) : null;
  }

  async setDefault(id: string, userId: string) {
    if (!(await this.findOwned(id, userId))) return null;
    await this.model
      .updateMany(
        { userId: { $eq: userId }, _id: { $ne: new Types.ObjectId(id) } },
        { $set: { isDefault: false } },
      )
      .exec();
    try {
      const d = await this.model
        .findOneAndUpdate(owned(id, userId), { $set: { isDefault: true } }, { new: true })
        .lean<Doc>()
        .exec();
      return d ? toRecord(d) : null;
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e;
      return this.findOwned(id, userId); // another request won; the address stays as it was
    }
  }

  async delete(id: string, userId: string) {
    if (!ok(id, userId)) return false;
    return (await this.model.deleteOne(owned(id, userId)).exec()).deletedCount === 1;
  }
}
