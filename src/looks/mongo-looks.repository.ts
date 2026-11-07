import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Look } from './look.schema';
import {
  DuplicateLookError,
  LookPatch,
  LookRecord,
  LooksRepository,
  NewLook,
} from './looks.repository';

type LookDoc = Omit<Look, 'spots'> & {
  _id: Types.ObjectId;
  spots: { productId: Types.ObjectId | string; x?: number | null; y?: number | null }[];
  createdAt: Date;
};
const toRecord = (d: LookDoc): LookRecord => ({
  id: d._id.toString(),
  title: d.title,
  slug: d.slug,
  description: d.description ?? '',
  image: d.image,
  spots: d.spots.map((s) => ({
    productId: s.productId.toString(),
    x: s.x ?? null,
    y: s.y ?? null,
  })),
  active: d.active === true,
  isDemo: d.isDemo === true,
  createdBy: d.createdBy,
  createdAt: d.createdAt,
});
const isDuplicate = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000;
const spots = (list: LookRecord['spots']) =>
  list.map((s) => ({ productId: new Types.ObjectId(s.productId), x: s.x, y: s.y }));

@Injectable()
export class MongoLooksRepository extends LooksRepository {
  constructor(@InjectModel(Look.name) private readonly model: Model<Look>) {
    super();
  }

  async findAll(f: { activeOnly: boolean; demoOnly: boolean; productId?: string }) {
    const query: Record<string, unknown> = {};
    if (f.activeOnly) query.active = true;
    if (f.demoOnly) query.isDemo = true;
    if (f.productId !== undefined) {
      if (!isValidObjectId(f.productId)) return [];
      query['spots.productId'] = new Types.ObjectId(f.productId);
    }
    const docs = await this.model
      .find(query)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean<LookDoc[]>()
      .exec();
    return docs.map(toRecord);
  }

  async findById(id: string) {
    if (!isValidObjectId(id)) return null;
    const d = await this.model.findById(id).lean<LookDoc>().exec();
    return d ? toRecord(d) : null;
  }

  async findBySlug(slug: string) {
    if (typeof slug !== 'string') return null;
    const d = await this.model
      .findOne({ slug: { $eq: slug } })
      .lean<LookDoc>()
      .exec();
    return d ? toRecord(d) : null;
  }

  async create(look: NewLook) {
    try {
      const doc = await this.model.create({ ...look, spots: spots(look.spots) });
      return toRecord(doc.toObject() as unknown as LookDoc);
    } catch (e) {
      if (isDuplicate(e)) throw new DuplicateLookError();
      throw e;
    }
  }

  async update(id: string, patch: LookPatch) {
    if (!isValidObjectId(id)) return null;
    const set: Record<string, unknown> = { ...patch };
    if (patch.spots) set.spots = spots(patch.spots);
    try {
      const d = await this.model
        .findByIdAndUpdate(id, { $set: set }, { new: true, runValidators: true })
        .lean<LookDoc>()
        .exec();
      return d ? toRecord(d) : null;
    } catch (e) {
      if (isDuplicate(e)) throw new DuplicateLookError();
      throw e;
    }
  }

  async delete(id: string) {
    if (!isValidObjectId(id)) return false;
    return (await this.model.deleteOne({ _id: id }).exec()).deletedCount === 1;
  }
}
