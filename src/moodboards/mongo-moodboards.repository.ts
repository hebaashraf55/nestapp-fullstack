import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { MOODBOARD_MAX_PRODUCTS, Moodboard } from './moodboard.schema';
import { MoodboardRecord, MoodboardsRepository } from './moodboards.repository';

type Doc = Moodboard & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };
const toRecord = (d: Doc): MoodboardRecord => ({
  id: d._id.toString(),
  userId: d.userId,
  name: d.name,
  note: d.note ?? '',
  productIds: d.productIds ?? [],
  shareToken: d.shareToken ?? null,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});
const ok = (id: string, userId: string) =>
  isValidObjectId(id) && typeof userId === 'string' && userId !== '';
const owned = (id: string, userId: string) => ({
  _id: new Types.ObjectId(id),
  userId: { $eq: userId },
});

@Injectable()
export class MongoMoodboardsRepository extends MoodboardsRepository {
  constructor(@InjectModel(Moodboard.name) private readonly model: Model<Moodboard>) {
    super();
  }

  async listByUser(userId: string) {
    if (typeof userId !== 'string') return [];
    const docs = await this.model
      .find({ userId: { $eq: userId } })
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean<Doc[]>()
      .exec();
    return docs.map(toRecord);
  }

  countByUser(userId: string) {
    if (typeof userId !== 'string') return Promise.resolve(0);
    return this.model.countDocuments({ userId: { $eq: userId } }).exec();
  }

  async findOwned(id: string, userId: string) {
    if (!ok(id, userId)) return null;
    const d = await this.model.findOne(owned(id, userId)).lean<Doc>().exec();
    return d ? toRecord(d) : null;
  }

  async findByShareToken(token: string) {
    if (typeof token !== 'string' || !/^[0-9a-f]{32}$/.test(token)) return null;
    const d = await this.model
      .findOne({ shareToken: { $eq: token } })
      .lean<Doc>()
      .exec();
    return d ? toRecord(d) : null;
  }

  async create(board: { userId: string; name: string; note: string }) {
    const doc = await this.model.create({ ...board, productIds: [], shareToken: null });
    return toRecord(doc.toObject() as unknown as Doc);
  }

  private async change(id: string, userId: string, filter: object, update: object) {
    if (!ok(id, userId)) return null;
    const d = await this.model
      .findOneAndUpdate({ ...owned(id, userId), ...filter }, update, {
        new: true,
        runValidators: true,
      })
      .lean<Doc>()
      .exec();
    return d ? toRecord(d) : null;
  }

  update(id: string, userId: string, patch: { name?: string; note?: string }) {
    return this.change(id, userId, {}, { $set: patch });
  }

  async addProduct(id: string, userId: string, productId: string) {
    // Already there: unchanged. Otherwise the size check and the push happen in one update.
    const current = await this.findOwned(id, userId);
    if (!current) return null;
    if (current.productIds.includes(productId)) return current;
    return this.change(
      id,
      userId,
      { [`productIds.${MOODBOARD_MAX_PRODUCTS - 1}`]: { $exists: false } },
      { $addToSet: { productIds: productId } },
    );
  }

  removeProduct(id: string, userId: string, productId: string) {
    return this.change(id, userId, {}, { $pull: { productIds: productId } });
  }

  setShareToken(id: string, userId: string, token: string | null) {
    return this.change(id, userId, {}, { $set: { shareToken: token } });
  }

  async delete(id: string, userId: string) {
    if (!ok(id, userId)) return false;
    return (await this.model.deleteOne(owned(id, userId)).exec()).deletedCount === 1;
  }
}
