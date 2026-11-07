import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Bundle } from './bundle.schema';
import {
  BundlePatch,
  BundleRecord,
  BundlesRepository,
  DuplicateBundleError,
  NewBundle,
} from './bundles.repository';

type BundleDoc = Omit<Bundle, 'items'> & {
  _id: Types.ObjectId;
  items: { productId: Types.ObjectId | string; quantity: number }[];
  createdAt: Date;
};

const toRecord = (d: BundleDoc): BundleRecord => ({
  id: d._id.toString(),
  name: d.name,
  slug: d.slug,
  description: d.description ?? '',
  image: d.image ?? null,
  items: d.items.map((i) => ({ productId: i.productId.toString(), quantity: i.quantity })),
  discountPercent: d.discountPercent,
  active: d.active === true,
  isDemo: d.isDemo === true,
  createdBy: d.createdBy,
  createdAt: d.createdAt,
});
const isDuplicate = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000;
const oids = (ids: string[]) =>
  ids.filter((i) => isValidObjectId(i)).map((i) => new Types.ObjectId(i));

@Injectable()
export class MongoBundlesRepository extends BundlesRepository {
  constructor(@InjectModel(Bundle.name) private readonly model: Model<Bundle>) {
    super();
  }

  async findAll(f: { activeOnly: boolean; demoOnly: boolean; productId?: string }) {
    const query: Record<string, unknown> = {};
    if (f.activeOnly) query.active = true;
    if (f.demoOnly) query.isDemo = true;
    if (f.productId !== undefined) {
      if (!isValidObjectId(f.productId)) return [];
      query['items.productId'] = new Types.ObjectId(f.productId);
    }
    const docs = await this.model
      .find(query)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean<BundleDoc[]>()
      .exec();
    return docs.map(toRecord);
  }

  async findActiveContaining(productIds: string[]) {
    const ids = oids(productIds);
    if (ids.length === 0) return [];
    const docs = await this.model
      .find({ active: true, 'items.productId': { $in: ids } })
      .limit(50)
      .lean<BundleDoc[]>()
      .exec();
    return docs.map(toRecord);
  }

  async findById(id: string) {
    if (!isValidObjectId(id)) return null;
    const d = await this.model.findById(id).lean<BundleDoc>().exec();
    return d ? toRecord(d) : null;
  }

  async findBySlug(slug: string) {
    if (typeof slug !== 'string') return null;
    const d = await this.model
      .findOne({ slug: { $eq: slug } })
      .lean<BundleDoc>()
      .exec();
    return d ? toRecord(d) : null;
  }

  async create(bundle: NewBundle) {
    try {
      const doc = await this.model.create({
        ...bundle,
        items: bundle.items.map((i) => ({
          productId: new Types.ObjectId(i.productId),
          quantity: i.quantity,
        })),
      });
      return toRecord(doc.toObject() as unknown as BundleDoc);
    } catch (e) {
      if (isDuplicate(e)) throw new DuplicateBundleError();
      throw e;
    }
  }

  async update(id: string, patch: BundlePatch) {
    if (!isValidObjectId(id)) return null;
    const set: Record<string, unknown> = { ...patch };
    if (patch.items)
      set.items = patch.items.map((i) => ({
        productId: new Types.ObjectId(i.productId),
        quantity: i.quantity,
      }));
    try {
      const d = await this.model
        .findByIdAndUpdate(id, { $set: set }, { new: true, runValidators: true })
        .lean<BundleDoc>()
        .exec();
      return d ? toRecord(d) : null;
    } catch (e) {
      if (isDuplicate(e)) throw new DuplicateBundleError();
      throw e;
    }
  }

  async delete(id: string) {
    if (!isValidObjectId(id)) return false;
    return (await this.model.deleteOne({ _id: id }).exec()).deletedCount === 1;
  }
}
