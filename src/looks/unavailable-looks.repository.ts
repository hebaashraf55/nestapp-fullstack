import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { LooksRepository } from './looks.repository';

const fail = (): never => {
  throw new ServiceUnavailableException();
};

/** Bound when MONGODB_URI is not set. */
@Injectable()
export class UnavailableLooksRepository extends LooksRepository {
  findAll = fail;
  findById = fail;
  findBySlug = fail;
  create = fail;
  update = fail;
  delete = fail;
}
