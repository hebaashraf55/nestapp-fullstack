import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Audited } from '../audit/audited';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser, OptionalAuth, Public, Roles } from '../auth/decorators';
import { ZodPipe } from '../catalogue/dto';
import { ParseObjectIdPipe } from '../catalogue/object-id.pipe';
import { Role } from '../users/role';
import {
  ModerateDto,
  moderateSchema,
  ModerationQuery,
  moderationQuerySchema,
  ReviewListQuery,
  reviewListQuerySchema,
  ReviewWriteDto,
  reviewWriteSchema,
} from './dto';
import { ReviewsService } from './reviews.service';

/** Reading is public; only customers write reviews, and only about products they can see. */
@Controller('product/:productId/reviews')
export class ProductReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Public()
  @OptionalAuth()
  @Get()
  list(
    @Param('productId', new ParseObjectIdPipe()) productId: string,
    @Query(new ZodPipe(reviewListQuerySchema)) query: ReviewListQuery,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.reviews.forProduct(productId.toLowerCase(), query, user);
  }

  @Roles(Role.CUSTOMER)
  @Post()
  create(
    @Param('productId', new ParseObjectIdPipe()) productId: string,
    @Body(new ZodPipe(reviewWriteSchema)) dto: ReviewWriteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reviews.create(productId.toLowerCase(), dto, user);
  }
}

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Roles(Role.ADMIN, Role.DEMO_VIEWER)
  @Get('moderation')
  queue(
    @Query(new ZodPipe(moderationQuerySchema)) query: ModerationQuery,
    @CurrentUser() viewer: AuthenticatedUser,
  ) {
    return this.reviews.moderationQueue(query, viewer);
  }

  @Roles(Role.ADMIN)
  @Audited('review.moderate')
  @Patch(':id/moderation')
  moderate(
    @Param('id', new ParseObjectIdPipe()) id: string,
    @Body(new ZodPipe(moderateSchema)) dto: ModerateDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.reviews.moderate(id, dto, admin);
  }

  @Roles(Role.CUSTOMER)
  @Patch(':id')
  update(
    @Param('id', new ParseObjectIdPipe()) id: string,
    @Body(new ZodPipe(reviewWriteSchema)) dto: ReviewWriteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reviews.update(id, dto, user);
  }

  @Roles(Role.CUSTOMER, Role.ADMIN)
  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id', new ParseObjectIdPipe()) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reviews.remove(id, user);
  }
}
