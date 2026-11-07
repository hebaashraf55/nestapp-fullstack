import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { BundlesRepository } from './bundles.repository';

const fail = (): never => {
  throw new ServiceUnavailableException();
};

/** Bound when MONGODB_URI is not set. */
@Injectable()
export class UnavailableBundlesRepository extends BundlesRepository {
  findAll = fail;
  findActiveContaining = fail;
  findById = fail;
  findBySlug = fail;
  create = fail;
  update = fail;
  delete = fail;
}
