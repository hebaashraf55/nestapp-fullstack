import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { MoodboardsRepository } from './moodboards.repository';

const fail = (): never => {
  throw new ServiceUnavailableException();
};

/** Bound when MONGODB_URI is not set. */
@Injectable()
export class UnavailableMoodboardsRepository extends MoodboardsRepository {
  listByUser = fail;
  countByUser = fail;
  findOwned = fail;
  findByShareToken = fail;
  create = fail;
  update = fail;
  addProduct = fail;
  removeProduct = fail;
  setShareToken = fail;
  delete = fail;
}
