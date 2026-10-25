import { DynamicModule, Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Env } from '../config/env';
import {
  BrandsRepository,
  CategoriesRepository,
  ProductsRepository,
} from './catalogue.repositories';
import {
  Brand,
  BrandSchema,
  Category,
  CategorySchema,
  Product,
  ProductSchema,
} from './catalogue.schemas';
import { BrandController, CategoryController, ProductController } from './catalogue.controllers';
import { BrandsService, CategoriesService, ProductsService } from './catalogue.services';
import {
  MongoBrandsRepository,
  MongoCategoriesRepository,
  MongoProductsRepository,
} from './mongo-catalogue.repositories';
import {
  UnavailableBrandsRepository,
  UnavailableCategoriesRepository,
  UnavailableProductsRepository,
} from './unavailable-catalogue.repositories';

/** Global so the cart (and later orders) can read products without re-importing the module. */
@Global()
@Module({})
export class CatalogueModule {
  static register(env: Env): DynamicModule {
    const connected = env.MONGODB_URI !== undefined;
    return {
      module: CatalogueModule,
      imports: connected
        ? [
            MongooseModule.forFeature([
              { name: Brand.name, schema: BrandSchema },
              { name: Category.name, schema: CategorySchema },
              { name: Product.name, schema: ProductSchema },
            ]),
          ]
        : [],
      controllers: [BrandController, CategoryController, ProductController],
      providers: [
        {
          provide: BrandsRepository,
          useClass: connected ? MongoBrandsRepository : UnavailableBrandsRepository,
        },
        {
          provide: CategoriesRepository,
          useClass: connected ? MongoCategoriesRepository : UnavailableCategoriesRepository,
        },
        {
          provide: ProductsRepository,
          useClass: connected ? MongoProductsRepository : UnavailableProductsRepository,
        },
        BrandsService,
        CategoriesService,
        ProductsService,
      ],
      exports: [
        BrandsService,
        CategoriesService,
        ProductsService,
        BrandsRepository,
        CategoriesRepository,
        ProductsRepository,
      ],
    };
  }
}
