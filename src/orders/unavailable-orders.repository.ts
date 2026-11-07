import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { OrdersRepository } from './orders.repository';

const fail = (): never => {
  throw new ServiceUnavailableException();
};

/** Bound when MONGODB_URI is not set: generic 503 instead of pretending to work. */
@Injectable()
export class UnavailableOrdersRepository extends OrdersRepository {
  create = fail;
  findPage = fail;
  summarize = fail;
  findById = fail;
  findByUser = fail;
  countPending = fail;
  countStockHoldingWithProduct = fail;
  countByCouponCode = fail;
  bestSellers = fail;
  hasPurchased = fail;
  findOverdue = fail;
  transition = fail;
  updateReturn = fail;
  findReturns = fail;
  findActivitySince = fail;
}
