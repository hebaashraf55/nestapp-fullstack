import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Review } from './review.schema';
import {
  DuplicateReviewError,
  NewReview,
  RatingSummary,
  ReviewRecord,
  ReviewSort,
  ReviewsRepository,
} from './reviews.repository';

type ReviewDoc = Review & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };

const toRecord = (d: ReviewDoc): ReviewRecord => ({
  id: d._id.toString(),
  productId: d.productId.toString(),
  userId: d.userId,
  authorName: d.authorName,
  rating: d.rating,
  title: d.title,
  body: d.body,
  verifiedPurchase: d.verifiedPurchase === true,
  status: d.status,
  moderationNote: d.moderationNote ?? null,
  moderatedBy: d.moderatedBy ?? null,
  moderatedAt: d.moderatedAt ?? null,
  isDemo: d.isDemo === true,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});

const SORTS: Record<ReviewSort, Record<string, 1 | -1>> = {
  newest: { createdAt: -1, _id: -1 },
  highest: { rating: -1, createdAt: -1, _id: -1 },
  lowest: { rating: 1, createdAt: -1, _id: -1 },
};

const isDuplicate = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000;

@Injectable()
export class MongoReviewsRepository extends ReviewsRepository {
  constructor(@InjectModel(Review.name) private readonly model: Model<Review>) {
    super();
  }

  async create(review: NewReview) {
    try {
      const doc = await this.model.create({
        ...review,
        productId: new Types.ObjectId(review.productId),
        status: 'PENDING',
      });
      return toRecord(doc.toObject() as unknown as ReviewDoc);
    } catch (e) {
      if (isDuplicate(e)) throw new DuplicateReviewError();
      throw e;
    }
  }

  async findById(id: string) {
    if (!isValidObjectId(id)) return null;
    const doc = await this.model.findById(id).lean<ReviewDoc>().exec();
    return doc ? toRecord(doc) : null;
  }

  async findByUserAndProduct(userId: string, productId: string) {
    if (typeof userId !== 'string' || !isValidObjectId(productId)) return null;
    const doc = await this.model
      .findOne({ userId: { $eq: userId }, productId: new Types.ObjectId(productId) })
      .lean<ReviewDoc>()
      .exec();
    return doc ? toRecord(doc) : null;
  }

  async findApproved(productId: string, sort: ReviewSort, page: number, limit: number) {
    if (!isValidObjectId(productId)) return { items: [], total: 0 };
    const filter = { productId: new Types.ObjectId(productId), status: 'APPROVED' as const };
    const [docs, total] = await Promise.all([
      this.model
        .find(filter)
        .sort(SORTS[sort])
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<ReviewDoc[]>()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { items: docs.map(toRecord), total };
  }

  async summarize(productId: string): Promise<RatingSummary> {
    const distribution: RatingSummary['distribution'] = [0, 0, 0, 0, 0];
    if (!isValidObjectId(productId)) return { average: null, count: 0, distribution };
    const rows = await this.model
      .aggregate<{ _id: number; n: number }>([
        { $match: { productId: new Types.ObjectId(productId), status: 'APPROVED' } },
        { $group: { _id: '$rating', n: { $sum: 1 } } },
      ])
      .exec();
    let count = 0;
    let sum = 0;
    for (const r of rows) {
      if (r._id >= 1 && r._id <= 5) {
        distribution[r._id - 1] = r.n;
        count += r.n;
        sum += r._id * r.n;
      }
    }
    return { average: count ? Math.round((sum / count) * 10) / 10 : null, count, distribution };
  }

  async findForModeration(f: {
    status?: Review['status'];
    demoOnly: boolean;
    page: number;
    limit: number;
  }) {
    const filter = {
      ...(f.status ? { status: f.status } : {}),
      ...(f.demoOnly ? { isDemo: true } : {}),
    };
    const [docs, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((f.page - 1) * f.limit)
        .limit(f.limit)
        .lean<ReviewDoc[]>()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { items: docs.map(toRecord), total };
  }

  async updateContent(
    id: string,
    userId: string,
    patch: Pick<ReviewRecord, 'rating' | 'title' | 'body' | 'verifiedPurchase'>,
  ) {
    if (!isValidObjectId(id) || typeof userId !== 'string') return null;
    const doc = await this.model
      .findOneAndUpdate(
        { _id: id, userId: { $eq: userId } },
        {
          $set: {
            ...patch,
            status: 'PENDING',
            moderationNote: null,
            moderatedBy: null,
            moderatedAt: null,
          },
        },
        { new: true, runValidators: true },
      )
      .lean<ReviewDoc>()
      .exec();
    return doc ? toRecord(doc) : null;
  }

  async moderate(
    id: string,
    status: 'APPROVED' | 'REJECTED',
    note: string | null,
    adminId: string,
  ) {
    if (!isValidObjectId(id)) return null;
    const doc = await this.model
      .findByIdAndUpdate(
        id,
        { $set: { status, moderationNote: note, moderatedBy: adminId, moderatedAt: new Date() } },
        { new: true, runValidators: true },
      )
      .lean<ReviewDoc>()
      .exec();
    return doc ? toRecord(doc) : null;
  }

  async delete(id: string) {
    if (!isValidObjectId(id)) return false;
    return (await this.model.deleteOne({ _id: id }).exec()).deletedCount === 1;
  }
}
