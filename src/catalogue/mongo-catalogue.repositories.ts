import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Brand, Category, Product } from './catalogue.schemas';
import {
  BrandsRepository,
  CategoriesRepository,
  DuplicateKeyError,
  NewProduct,
  NewTaxonomy,
  ProductFilter,
  ProductPatch,
  ProductRecord,
  ProductSpecs,
  ProductsRepository,
  TaxonomyPatch,
  TaxonomyRecord,
  TaxonomyRepository,
  StockSummary,
} from './catalogue.repositories';

const MONGO_DUPLICATE_KEY = 11000;

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if ((error as { code?: number }).code === MONGO_DUPLICATE_KEY) throw new DuplicateKeyError();
    throw error;
  }
}

interface TaxonomyDoc {
  id: string;
  name: string;
  slug: string;
  image?: string | null;
  isDemo: boolean;
  createdBy: string;
  createdAt: Date;
}

function toTaxonomy(doc: TaxonomyDoc): TaxonomyRecord {
  return {
    id: doc.id,
    name: doc.name,
    slug: doc.slug,
    image: doc.image ?? null,
    isDemo: doc.isDemo,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
  };
}

/** Shared implementation; `$eq` wraps every client-influenced value so operator objects cannot slip in. */
abstract class MongoTaxonomyRepository extends TaxonomyRepository {
  protected constructor(private readonly model: Model<Brand | Category>) {
    super();
  }

  async findById(id: string): Promise<TaxonomyRecord | null> {
    if (!isValidObjectId(id)) return null;
    const doc = await this.model.findById(id).exec();
    return doc ? toTaxonomy(doc as unknown as TaxonomyDoc) : null;
  }

  async findBySlug(slug: string): Promise<TaxonomyRecord | null> {
    const doc = await this.model.findOne({ slug: { $eq: slug } }).exec();
    return doc ? toTaxonomy(doc as unknown as TaxonomyDoc) : null;
  }

  async findAll(demoOnly: boolean): Promise<TaxonomyRecord[]> {
    const docs = await this.model
      .find(demoOnly ? { isDemo: true } : {})
      .sort({ name: 1 })
      .limit(500)
      .exec();
    return docs.map((d) => toTaxonomy(d as unknown as TaxonomyDoc));
  }

  async findByIds(ids: string[]): Promise<TaxonomyRecord[]> {
    const valid = ids.filter((id) => isValidObjectId(id));
    if (valid.length === 0) return [];
    const docs = await this.model.find({ _id: { $in: valid } }).exec();
    return docs.map((d) => toTaxonomy(d as unknown as TaxonomyDoc));
  }

  create(record: NewTaxonomy): Promise<TaxonomyRecord> {
    return guard(async () =>
      toTaxonomy((await this.model.create(record)) as unknown as TaxonomyDoc),
    );
  }

  update(id: string, patch: TaxonomyPatch): Promise<TaxonomyRecord | null> {
    if (!isValidObjectId(id)) return Promise.resolve(null);
    return guard(async () => {
      const doc = await this.model
        .findOneAndUpdate({ _id: id }, { $set: patch }, { new: true, runValidators: true })
        .exec();
      return doc ? toTaxonomy(doc as unknown as TaxonomyDoc) : null;
    });
  }

  async delete(id: string): Promise<boolean> {
    if (!isValidObjectId(id)) return false;
    return (await this.model.deleteOne({ _id: id }).exec()).deletedCount === 1;
  }
}

@Injectable()
export class MongoBrandsRepository extends MongoTaxonomyRepository implements BrandsRepository {
  constructor(@InjectModel(Brand.name) model: Model<Brand>) {
    super(model as unknown as Model<Brand | Category>);
  }
}

@Injectable()
export class MongoCategoriesRepository
  extends MongoTaxonomyRepository
  implements CategoriesRepository
{
  constructor(@InjectModel(Category.name) model: Model<Category>) {
    super(model as unknown as Model<Brand | Category>);
  }
}

interface ProductDoc {
  id: string;
  name: string;
  slug: string;
  description?: string;
  images: string[];
  priceCents: number;
  discountPercent: number;
  salePriceCents: number;
  stock: number;
  categoryId: Types.ObjectId;
  brandId: Types.ObjectId;
  specs?: { material?: string; color?: string; dimensions?: string; care?: string };
  featured?: boolean;
  variantGroup?: string | null;
  variantLabel?: string | null;
  isDemo: boolean;
  createdBy: string;
  createdAt: Date;
}

const SPEC_KEYS = ['material', 'color', 'dimensions', 'care'] as const;
/** Reads the four fields by name: a hydrated subdocument is not a plain object, so its entries cannot be listed. */
const cleanSpecs = (s: ProductDoc['specs']): ProductSpecs => {
  const out: ProductSpecs = {};
  for (const key of SPEC_KEYS) {
    const value: unknown = s?.[key];
    if (typeof value === 'string' && value !== '') out[key] = value;
  }
  return out;
};

function toProduct(doc: ProductDoc): ProductRecord {
  return {
    id: doc.id,
    name: doc.name,
    slug: doc.slug,
    description: doc.description ?? '',
    images: doc.images,
    priceCents: doc.priceCents,
    discountPercent: doc.discountPercent,
    salePriceCents: doc.salePriceCents,
    stock: doc.stock,
    categoryId: doc.categoryId.toString(),
    brandId: doc.brandId.toString(),
    specs: cleanSpecs(doc.specs),
    featured: doc.featured === true,
    variantGroup: doc.variantGroup ?? null,
    variantLabel: doc.variantLabel ?? null,
    isDemo: doc.isDemo,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
  };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SORTS = {
  newest: { createdAt: -1, _id: -1 },
  'price-asc': { salePriceCents: 1, _id: 1 },
  'price-desc': { salePriceCents: -1, _id: 1 },
  name: { name: 1, _id: 1 },
  relevance: { createdAt: -1, _id: -1 },
} as const;

@Injectable()
export class MongoProductsRepository extends ProductsRepository {
  constructor(@InjectModel(Product.name) private readonly model: Model<Product>) {
    super();
  }

  async summarizeStock(demoOnly: boolean, lowStockAt: number): Promise<StockSummary> {
    const scope = demoOnly ? { isDemo: true } : {};
    const [total, outOfStock, lowStock] = await Promise.all([
      this.model.countDocuments(scope).exec(),
      this.model.countDocuments({ ...scope, stock: 0 }).exec(),
      this.model.countDocuments({ ...scope, stock: { $gt: 0, $lte: lowStockAt } }).exec(),
    ]);
    return { total, outOfStock, lowStock };
  }

  async findByIds(ids: string[]): Promise<ProductRecord[]> {
    const valid = ids.filter((id) => isValidObjectId(id));
    if (valid.length === 0) return [];
    const docs = await this.model.find({ _id: { $in: valid } }).exec();
    return docs.map((d) => toProduct(d as unknown as ProductDoc));
  }

  async findById(id: string): Promise<ProductRecord | null> {
    if (!isValidObjectId(id)) return null;
    const doc = await this.model.findById(id).exec();
    return doc ? toProduct(doc as unknown as ProductDoc) : null;
  }

  async findBySlug(slug: string): Promise<ProductRecord | null> {
    const doc = await this.model.findOne({ slug: { $eq: slug } }).exec();
    return doc ? toProduct(doc as unknown as ProductDoc) : null;
  }

  async findByVariantGroup(group: string): Promise<ProductRecord[]> {
    if (typeof group !== 'string' || group === '') return [];
    const docs = await this.model
      .find({ variantGroup: { $eq: group } })
      .limit(20)
      .exec();
    return docs.map((d) => toProduct(d as unknown as ProductDoc));
  }

  async findPage(filter: ProductFilter): Promise<{ items: ProductRecord[]; total: number }> {
    const query: Record<string, unknown> = {};
    if (filter.demoOnly) query.isDemo = true;
    if (filter.categoryId && isValidObjectId(filter.categoryId))
      query.categoryId = filter.categoryId;
    if (filter.brandId && isValidObjectId(filter.brandId)) query.brandId = filter.brandId;
    if (filter.inStock === true) query.stock = { $gt: 0 };
    if (filter.inStock === false) query.stock = 0;
    if (filter.featured === true) query.featured = true;
    if (filter.onSale === true) query.discountPercent = { $gt: 0 };
    if (filter.ids) query._id = { $in: filter.ids.filter((id) => isValidObjectId(id)) };
    if (filter.minPriceCents !== undefined || filter.maxPriceCents !== undefined) {
      query.salePriceCents = {
        ...(filter.minPriceCents !== undefined ? { $gte: filter.minPriceCents } : {}),
        ...(filter.maxPriceCents !== undefined ? { $lte: filter.maxPriceCents } : {}),
      };
    }
    // Relevance: the weighted text index ranks whole-word matches. If it finds nothing (a half-typed
    // word, a brand or category name), the literal search below takes over.
    if (filter.sort === 'relevance' && filter.q) {
      const textQuery = { ...query, $text: { $search: filter.q.slice(0, 80) } };
      const [docs, total] = await Promise.all([
        this.model
          .find(textQuery, { score: { $meta: 'textScore' } })
          .sort({ score: { $meta: 'textScore' }, _id: 1 })
          .skip((filter.page - 1) * filter.limit)
          .limit(filter.limit)
          .exec(),
        this.model.countDocuments(textQuery).exec(),
      ]);
      if (total > 0)
        return { items: docs.map((d) => toProduct(d as unknown as ProductDoc)), total };
    }
    // The search text is escaped, so it is always matched literally (no regex injection, no ReDoS).
    // Name, description, material and colour are searched; ids of matching brands and categories
    // are resolved by the service. Escaped text keeps every match literal.
    if (filter.q) {
      const re = { $regex: escapeRegExp(filter.q), $options: 'i' };
      query.$or = [
        { name: re },
        { description: re },
        { 'specs.material': re },
        { 'specs.color': re },
        ...(filter.matchTaxonomyIds?.length
          ? [
              { categoryId: { $in: filter.matchTaxonomyIds } },
              { brandId: { $in: filter.matchTaxonomyIds } },
            ]
          : []),
      ];
    }

    const [docs, total] = await Promise.all([
      this.model
        .find(query)
        .sort(SORTS[filter.sort])
        .skip((filter.page - 1) * filter.limit)
        .limit(filter.limit)
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { items: docs.map((d) => toProduct(d as unknown as ProductDoc)), total };
  }

  create(record: NewProduct): Promise<ProductRecord> {
    return guard(async () => toProduct((await this.model.create(record)) as unknown as ProductDoc));
  }

  update(id: string, patch: ProductPatch): Promise<ProductRecord | null> {
    if (!isValidObjectId(id)) return Promise.resolve(null);
    return guard(async () => {
      const doc = await this.model
        .findOneAndUpdate({ _id: id }, { $set: patch }, { new: true, runValidators: true })
        .exec();
      return doc ? toProduct(doc as unknown as ProductDoc) : null;
    });
  }

  async delete(id: string): Promise<boolean> {
    if (!isValidObjectId(id)) return false;
    return (await this.model.deleteOne({ _id: id }).exec()).deletedCount === 1;
  }

  countByCategory(categoryId: string): Promise<number> {
    if (!isValidObjectId(categoryId)) return Promise.resolve(0);
    return this.model.countDocuments({ categoryId }).exec();
  }

  countByBrand(brandId: string): Promise<number> {
    if (!isValidObjectId(brandId)) return Promise.resolve(0);
    return this.model.countDocuments({ brandId }).exec();
  }

  /** One conditional update: the stock check and the decrement cannot be separated by another request. */
  async reserveStock(productId: string, quantity: number): Promise<boolean> {
    if (!isValidObjectId(productId)) return false;
    const result = await this.model
      .updateOne({ _id: productId, stock: { $gte: quantity } }, { $inc: { stock: -quantity } })
      .exec();
    return result.modifiedCount === 1;
  }

  async restoreStock(productId: string, quantity: number): Promise<void> {
    if (!isValidObjectId(productId)) return;
    await this.model.updateOne({ _id: productId }, { $inc: { stock: quantity } }).exec();
  }
}
