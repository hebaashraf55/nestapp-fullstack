import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { CouponsRepository } from './coupons.repository';

const fail = (): never => {
  throw new ServiceUnavailableException();
};

/** Bound when MONGODB_URI is not set: generic 503 instead of pretending to work. */
@Injectable()
export class UnavailableCouponsRepository extends CouponsRepository {
  findById = fail;
  findByCode = fail;
  findAll = fail;
  create = fail;
  update = fail;
  delete = fail;
}
