import { ReviewStatus } from './review.schema';

export interface ReviewRecord {
  id: string;
  productId: string;
  userId: string;
  authorName: string;
  rating: number;
  title: string;
  body: string;
  verifiedPurchase: boolean;
  status: ReviewStatus;
  moderationNote: string | null;
  moderatedBy: string | null;
  moderatedAt: Date | null;
  isDemo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type NewReview = Pick<
  ReviewRecord,
  | 'productId'
  | 'userId'
  | 'authorName'
  | 'rating'
  | 'title'
  | 'body'
  | 'verifiedPurchase'
  | 'isDemo'
>;

export type ReviewSort = 'newest' | 'highest' | 'lowest';

export interface RatingSummary {
  average: number | null;
  count: number;
  /** Approved reviews per star, index 0 = 1 star. */
  distribution: [number, number, number, number, number];
}

export class DuplicateReviewError extends Error {
  constructor() {
    super('Duplicate review');
    this.name = 'DuplicateReviewError';
  }
}

export abstract class ReviewsRepository {
  /** Throws DuplicateReviewError when this user already reviewed the product. */
  abstract create(review: NewReview): Promise<ReviewRecord>;
  abstract findById(id: string): Promise<ReviewRecord | null>;
  abstract findByUserAndProduct(userId: string, productId: string): Promise<ReviewRecord | null>;
  abstract findApproved(
    productId: string,
    sort: ReviewSort,
    page: number,
    limit: number,
  ): Promise<{ items: ReviewRecord[]; total: number }>;
  abstract summarize(productId: string): Promise<RatingSummary>;
  abstract findForModeration(filter: {
    status?: ReviewStatus;
    demoOnly: boolean;
    page: number;
    limit: number;
  }): Promise<{ items: ReviewRecord[]; total: number }>;
  /** Author edit: replaces the text and sends the review back to moderation. */
  abstract updateContent(
    id: string,
    userId: string,
    patch: Pick<ReviewRecord, 'rating' | 'title' | 'body' | 'verifiedPurchase'>,
  ): Promise<ReviewRecord | null>;
  abstract moderate(
    id: string,
    status: 'APPROVED' | 'REJECTED',
    note: string | null,
    adminId: string,
  ): Promise<ReviewRecord | null>;
  abstract delete(id: string): Promise<boolean>;
}
