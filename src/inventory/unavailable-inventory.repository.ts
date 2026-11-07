import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InventoryRepository } from './inventory.repository';

const fail = (): never => {
  throw new ServiceUnavailableException();
};

/** Bound when MONGODB_URI is not set. */
@Injectable()
export class UnavailableInventoryRepository extends InventoryRepository {
  append = fail;
  findPage = fail;
}
