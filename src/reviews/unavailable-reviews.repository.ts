import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ReviewsRepository } from './reviews.repository';

const fail = (): never => {
  throw new ServiceUnavailableException();
};

/** Bound when MONGODB_URI is not set. */
@Injectable()
export class UnavailableReviewsRepository extends ReviewsRepository {
  create = fail;
  findById = fail;
  findByUserAndProduct = fail;
  findApproved = fail;
  summarize = fail;
  findForModeration = fail;
  updateContent = fail;
  moderate = fail;
  delete = fail;
}
