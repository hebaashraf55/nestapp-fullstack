import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { CartsRepository } from './cart.repository';

const fail = (): never => {
  throw new ServiceUnavailableException();
};

/** Bound when MONGODB_URI is not set: generic 503 instead of pretending to work. */
@Injectable()
export class UnavailableCartsRepository extends CartsRepository {
  findByUser = fail;
  save = fail;
}
