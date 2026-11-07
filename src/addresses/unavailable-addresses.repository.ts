import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AddressesRepository } from './addresses.repository';

const fail = (): never => {
  throw new ServiceUnavailableException();
};

/** Bound when MONGODB_URI is not set. */
@Injectable()
export class UnavailableAddressesRepository extends AddressesRepository {
  list = fail;
  count = fail;
  findOwned = fail;
  create = fail;
  update = fail;
  setDefault = fail;
  delete = fail;
}
