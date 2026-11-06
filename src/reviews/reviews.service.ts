import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { demoScope } from '../auth/demo-scope';
import { ProductsService } from '../catalogue/catalogue.services';
import { OrdersRepository } from '../orders/orders.repository';
import { Role } from '../users/role';
import { UsersRepository } from '../users/users.repository';
import { ModerateDto, ModerationQuery, ReviewListQuery, ReviewWriteDto } from './dto';
import { ReviewStatus } from './review.schema';
import {
  DuplicateReviewError,
  RatingSummary,
  ReviewRecord,
  ReviewsRepository,
} from './reviews.repository';

export interface PublicReview {
  id: string;
  authorName: string;
  rating: number;
  title: string;
  body: string;
  verifiedPurchase: boolean;
  createdAt: Date;
  updatedAt: Date;
}
export interface OwnReview extends PublicReview {
  productId: string;
  status: ReviewStatus;
  moderationNote: string | null;
}
export interface ModerationReview extends OwnReview {
  product: { id: string; name: string } | null;
  moderatedAt: Date | null;
}

const publicView = (r: ReviewRecord): PublicReview => ({
  id: r.id,
  authorName: r.authorName,
  rating: r.rating,
  title: r.title,
  body: r.body,
  verifiedPurchase: r.verifiedPurchase,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});
const ownView = (r: ReviewRecord): OwnReview => ({
  ...publicView(r),
  productId: r.productId,
  status: r.status,
  moderationNote: r.moderationNote,
});

/** "Ada Lovelace" → "Ada L." — enough to feel personal without publishing a full name. */
export const displayName = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Customer';
  const first = parts[0]!.slice(0, 40);
  const last = parts.length > 1 ? ` ${parts[parts.length - 1]!.charAt(0).toUpperCase()}.` : '';
  return first + last;
};

@Injectable()
export class ReviewsService {
  constructor(
    private readonly reviews: ReviewsRepository,
    private readonly products: ProductsService,
    private readonly orders: OrdersRepository,
    private readonly users: UsersRepository,
  ) {}

  /** Approved reviews only, with the rating summary, plus the caller's own review in any state. */
  async forProduct(productId: string, query: ReviewListQuery, user?: AuthenticatedUser) {
    await this.products.get(productId, user); // 404 for unknown or hidden products
    const [page, summary, mine] = await Promise.all([
      this.reviews.findApproved(productId, query.sort, query.page, query.limit),
      this.reviews.summarize(productId),
      user ? this.reviews.findByUserAndProduct(user.id, productId) : Promise.resolve(null),
    ]);
    return {
      summary,
      items: page.items.map(publicView),
      page: query.page,
      limit: query.limit,
      total: page.total,
      totalPages: Math.max(1, Math.ceil(page.total / query.limit)),
      mine: mine ? ownView(mine) : null,
    };
  }

  summary(productId: string): Promise<RatingSummary> {
    return this.reviews.summarize(productId);
  }

  async create(
    productId: string,
    dto: ReviewWriteDto,
    user: AuthenticatedUser,
  ): Promise<OwnReview> {
    const product = await this.products.get(productId, user);
    const account = await this.users.findById(user.id);
    if (!account) throw new ForbiddenException();
    try {
      const review = await this.reviews.create({
        productId: product.id,
        userId: user.id,
        authorName: displayName(account.name),
        rating: dto.rating,
        title: dto.title,
        body: dto.body,
        verifiedPurchase: await this.orders.hasPurchased(user.id, product.id),
        isDemo: product.isDemo,
      });
      return ownView(review);
    } catch (e) {
      if (e instanceof DuplicateReviewError)
        throw new ConflictException(
          'You have already reviewed this product; edit your review instead',
        );
      throw e;
    }
  }

  async update(id: string, dto: ReviewWriteDto, user: AuthenticatedUser): Promise<OwnReview> {
    const existing = await this.reviews.findById(id);
    if (!existing || existing.userId !== user.id) throw new NotFoundException('Review not found');
    const updated = await this.reviews.updateContent(id, user.id, {
      ...dto,
      verifiedPurchase: await this.orders.hasPurchased(user.id, existing.productId),
    });
    if (!updated) throw new NotFoundException('Review not found');
    return ownView(updated);
  }

  /** Authors delete their own review; admins delete any. Others get 404, never a hint it exists. */
  async remove(id: string, user: AuthenticatedUser): Promise<{ deleted: true }> {
    const existing = await this.reviews.findById(id);
    if (!existing || (existing.userId !== user.id && user.role !== Role.ADMIN))
      throw new NotFoundException('Review not found');
    if (!(await this.reviews.delete(id))) throw new NotFoundException('Review not found');
    return { deleted: true };
  }

  async moderationQueue(query: ModerationQuery, viewer: AuthenticatedUser) {
    const page = await this.reviews.findForModeration({
      status: query.status,
      demoOnly: demoScope(viewer).isDemo === true,
      page: query.page,
      limit: query.limit,
    });
    const names = new Map(
      (
        await this.products.findVisible([...new Set(page.items.map((r) => r.productId))], viewer)
      ).map((p) => [p.id, p.name]),
    );
    const items: ModerationReview[] = page.items.map((r) => ({
      ...ownView(r),
      product: names.has(r.productId) ? { id: r.productId, name: names.get(r.productId)! } : null,
      moderatedAt: r.moderatedAt,
    }));
    return {
      items,
      page: query.page,
      limit: query.limit,
      total: page.total,
      totalPages: Math.max(1, Math.ceil(page.total / query.limit)),
    };
  }

  async moderate(id: string, dto: ModerateDto, admin: AuthenticatedUser): Promise<OwnReview> {
    const updated = await this.reviews.moderate(id, dto.status, dto.note ?? null, admin.id);
    if (!updated) throw new NotFoundException('Review not found');
    return ownView(updated);
  }
}
