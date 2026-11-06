import { randomBytes } from 'node:crypto';
import {
  DuplicateReviewError,
  NewReview,
  RatingSummary,
  ReviewRecord,
  ReviewSort,
  ReviewsRepository,
} from '../../src/reviews/reviews.repository';
import { ReviewStatus } from '../../src/reviews/review.schema';

/** Test-only fake with the same rules as the Mongo repository (unique per user and product). */
export class InMemoryReviewsRepository extends ReviewsRepository {
  readonly records = new Map<string, ReviewRecord>();
  private clock = 0;

  private now() {
    return new Date(Date.UTC(2026, 0, 1) + ++this.clock * 1000);
  }

  async create(review: NewReview) {
    if (
      [...this.records.values()].some(
        (r) => r.userId === review.userId && r.productId === review.productId,
      )
    )
      throw new DuplicateReviewError();
    const at = this.now();
    const record: ReviewRecord = {
      ...review,
      id: randomBytes(12).toString('hex'),
      status: 'PENDING',
      moderationNote: null,
      moderatedBy: null,
      moderatedAt: null,
      createdAt: at,
      updatedAt: at,
    };
    this.records.set(record.id, record);
    return { ...record };
  }
  async findById(id: string) {
    const r = this.records.get(id);
    return r ? { ...r } : null;
  }
  async findByUserAndProduct(userId: string, productId: string) {
    const r = [...this.records.values()].find(
      (x) => x.userId === userId && x.productId === productId,
    );
    return r ? { ...r } : null;
  }
  async findApproved(productId: string, sort: ReviewSort, page: number, limit: number) {
    const all = [...this.records.values()]
      .filter((r) => r.productId === productId && r.status === 'APPROVED')
      .sort((a, b) => {
        const byDate = b.createdAt.getTime() - a.createdAt.getTime();
        if (sort === 'highest') return b.rating - a.rating || byDate;
        if (sort === 'lowest') return a.rating - b.rating || byDate;
        return byDate;
      });
    return { items: all.slice((page - 1) * limit, page * limit), total: all.length };
  }
  async summarize(productId: string): Promise<RatingSummary> {
    const distribution: RatingSummary['distribution'] = [0, 0, 0, 0, 0];
    let sum = 0;
    let count = 0;
    for (const r of this.records.values()) {
      if (r.productId !== productId || r.status !== 'APPROVED') continue;
      distribution[r.rating - 1]! += 1;
      sum += r.rating;
      count += 1;
    }
    return { average: count ? Math.round((sum / count) * 10) / 10 : null, count, distribution };
  }
  async findForModeration(f: {
    status?: ReviewStatus;
    demoOnly: boolean;
    page: number;
    limit: number;
  }) {
    const all = [...this.records.values()]
      .filter((r) => (!f.status || r.status === f.status) && (!f.demoOnly || r.isDemo))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return { items: all.slice((f.page - 1) * f.limit, f.page * f.limit), total: all.length };
  }
  async updateContent(
    id: string,
    userId: string,
    patch: Pick<ReviewRecord, 'rating' | 'title' | 'body' | 'verifiedPurchase'>,
  ) {
    const r = this.records.get(id);
    if (!r || r.userId !== userId) return null;
    Object.assign(r, patch, {
      status: 'PENDING',
      moderationNote: null,
      moderatedBy: null,
      moderatedAt: null,
      updatedAt: this.now(),
    });
    return { ...r };
  }
  async moderate(
    id: string,
    status: 'APPROVED' | 'REJECTED',
    note: string | null,
    adminId: string,
  ) {
    const r = this.records.get(id);
    if (!r) return null;
    Object.assign(r, {
      status,
      moderationNote: note,
      moderatedBy: adminId,
      moderatedAt: this.now(),
    });
    return { ...r };
  }
  async delete(id: string) {
    return this.records.delete(id);
  }
}
