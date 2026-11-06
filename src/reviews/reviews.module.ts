import { DynamicModule, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Env } from '../config/env';
import { MongoReviewsRepository } from './mongo-reviews.repository';
import { Review, ReviewSchema } from './review.schema';
import { ProductReviewsController, ReviewsController } from './reviews.controller';
import { ReviewsRepository } from './reviews.repository';
import { ReviewsService } from './reviews.service';
import { UnavailableReviewsRepository } from './unavailable-reviews.repository';

/** Product reviews: customers write, admins moderate, everyone reads approved ones. */
@Module({})
export class ReviewsModule {
  static register(env: Env): DynamicModule {
    const connected = env.MONGODB_URI !== undefined;
    return {
      module: ReviewsModule,
      imports: connected
        ? [MongooseModule.forFeature([{ name: Review.name, schema: ReviewSchema }])]
        : [],
      controllers: [ProductReviewsController, ReviewsController],
      providers: [
        {
          provide: ReviewsRepository,
          useClass: connected ? MongoReviewsRepository : UnavailableReviewsRepository,
        },
        ReviewsService,
      ],
      exports: [ReviewsService],
    };
  }
}
