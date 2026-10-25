/** Brands and categories share one shape. */
export interface TaxonomyRecord {
  id: string;
  name: string;
  slug: string;
  image: string | null;
  /** Synthetic seed data. Demo viewers can only ever see records with this flag. */
  isDemo: boolean;
  createdBy: string;
  createdAt: Date;
}
export type NewTaxonomy = Omit<TaxonomyRecord, 'id' | 'createdAt'>;
export type TaxonomyPatch = Partial<Pick<TaxonomyRecord, 'name' | 'slug' | 'image'>>;

export class DuplicateKeyError extends Error {
  constructor() {
    super('Duplicate key');
    this.name = 'DuplicateKeyError';
  }
}

export abstract class TaxonomyRepository {
  abstract findById(id: string): Promise<TaxonomyRecord | null>;
  abstract findBySlug(slug: string): Promise<TaxonomyRecord | null>;
  abstract findAll(demoOnly: boolean): Promise<TaxonomyRecord[]>;
  abstract findByIds(ids: string[]): Promise<TaxonomyRecord[]>;
  abstract create(record: NewTaxonomy): Promise<TaxonomyRecord>;
  abstract update(id: string, patch: TaxonomyPatch): Promise<TaxonomyRecord | null>;
  abstract delete(id: string): Promise<boolean>;
}
export abstract class BrandsRepository extends TaxonomyRepository {}
export abstract class CategoriesRepository extends TaxonomyRepository {}

export interface ProductRecord {
  id: string;
  name: string;
  slug: string;
  description: string;
  images: string[];
  priceCents: number;
  discountPercent: number;
  /** Always computed by the server from priceCents and discountPercent. */
  salePriceCents: number;
  stock: number;
  categoryId: string;
  brandId: string;
  isDemo: boolean;
  createdBy: string;
  createdAt: Date;
}
export type NewProduct = Omit<ProductRecord, 'id' | 'createdAt'>;
export type ProductPatch = Partial<
  Pick<
    ProductRecord,
    | 'name'
    | 'slug'
    | 'description'
    | 'images'
    | 'priceCents'
    | 'discountPercent'
    | 'salePriceCents'
    | 'stock'
    | 'categoryId'
    | 'brandId'
  >
>;

export type ProductSort = 'newest' | 'price-asc' | 'price-desc' | 'name';

export interface ProductFilter {
  q?: string;
  categoryId?: string;
  brandId?: string;
  /** Applied to the sale price. */
  minPriceCents?: number;
  maxPriceCents?: number;
  inStock?: boolean;
  demoOnly: boolean;
  sort: ProductSort;
  page: number;
  limit: number;
}

export abstract class ProductsRepository {
  abstract findById(id: string): Promise<ProductRecord | null>;
  abstract findByIds(ids: string[]): Promise<ProductRecord[]>;
  abstract findBySlug(slug: string): Promise<ProductRecord | null>;
  abstract findPage(filter: ProductFilter): Promise<{ items: ProductRecord[]; total: number }>;
  abstract create(record: NewProduct): Promise<ProductRecord>;
  abstract update(id: string, patch: ProductPatch): Promise<ProductRecord | null>;
  abstract delete(id: string): Promise<boolean>;
  abstract countByCategory(categoryId: string): Promise<number>;
  abstract countByBrand(brandId: string): Promise<number>;
  /** Atomically takes `quantity` from stock only if enough remains. Returns false (and changes nothing) otherwise. */
  abstract reserveStock(productId: string, quantity: number): Promise<boolean>;
  /** Gives stock back. A product that no longer exists is ignored. */
  abstract restoreStock(productId: string, quantity: number): Promise<void>;
}
