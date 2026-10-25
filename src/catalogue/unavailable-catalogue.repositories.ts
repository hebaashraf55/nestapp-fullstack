import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  BrandsRepository,
  CategoriesRepository,
  ProductsRepository,
} from './catalogue.repositories';

const fail = (): never => {
  throw new ServiceUnavailableException();
};

/** Bound when MONGODB_URI is not set: generic 503 instead of pretending to work. */
@Injectable()
export class UnavailableBrandsRepository extends BrandsRepository {
  findById = fail;
  findBySlug = fail;
  findAll = fail;
  findByIds = fail;
  create = fail;
  update = fail;
  delete = fail;
}

@Injectable()
export class UnavailableCategoriesRepository extends CategoriesRepository {
  findById = fail;
  findBySlug = fail;
  findAll = fail;
  findByIds = fail;
  create = fail;
  update = fail;
  delete = fail;
}

@Injectable()
export class UnavailableProductsRepository extends ProductsRepository {
  findById = fail;
  findByIds = fail;
  reserveStock = fail;
  restoreStock = fail;
  findBySlug = fail;
  findPage = fail;
  create = fail;
  update = fail;
  delete = fail;
  countByCategory = fail;
  countByBrand = fail;
}
