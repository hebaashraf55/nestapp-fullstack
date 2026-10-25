/**
 * Mongoose-backed tests for the catalogue repositories. They need a real MongoDB, so they run only when
 * MONGODB_TEST_URI is set; otherwise they are SKIPPED (not passed).
 */
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model } from 'mongoose';
import { DuplicateKeyError } from '../../src/catalogue/catalogue.repositories';
import {
  Brand,
  BrandSchema,
  Category,
  CategorySchema,
  Product,
  ProductSchema,
} from '../../src/catalogue/catalogue.schemas';
import {
  MongoBrandsRepository,
  MongoCategoriesRepository,
  MongoProductsRepository,
} from '../../src/catalogue/mongo-catalogue.repositories';

const uri = process.env.MONGODB_TEST_URI;
const suite = uri ? describe : describe.skip;

suite('catalogue storage (real MongoDB)', () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let brands: MongoBrandsRepository;
  let categories: MongoCategoriesRepository;
  let products: MongoProductsRepository;
  let models: Model<unknown>[];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(uri as string, { serverSelectionTimeoutMS: 5000 }),
        MongooseModule.forFeature([
          { name: Brand.name, schema: BrandSchema },
          { name: Category.name, schema: CategorySchema },
          { name: Product.name, schema: ProductSchema },
        ]),
      ],
      providers: [MongoBrandsRepository, MongoCategoriesRepository, MongoProductsRepository],
    }).compile();
    await moduleRef.init();
    brands = moduleRef.get(MongoBrandsRepository);
    categories = moduleRef.get(MongoCategoriesRepository);
    products = moduleRef.get(MongoProductsRepository);
    models = [Brand, Category, Product].map((c) => moduleRef.get(getModelToken(c.name)));
    await Promise.all(models.map((m) => (m as Model<unknown>).init()));
  });
  beforeEach(async () => {
    await Promise.all(models.map((m) => m.deleteMany({})));
  });
  afterAll(async () => {
    await moduleRef?.close();
  });

  const tax = (name: string, isDemo = false) => ({
    name,
    slug: name.toLowerCase().replace(/\W+/g, '-'),
    image: null,
    isDemo,
    createdBy: 'tester',
  });
  const product = (over: Record<string, unknown>) => ({
    name: 'P',
    slug: 'p',
    description: '',
    images: ['/catalogue/p.svg'],
    priceCents: 1000,
    discountPercent: 0,
    salePriceCents: 1000,
    stock: 1,
    categoryId: '',
    brandId: '',
    isDemo: false,
    createdBy: 'tester',
    ...over,
  });

  it('rejects a duplicate brand slug as DuplicateKeyError', async () => {
    await brands.create(tax('Noor'));
    await expect(brands.create(tax('Noor'))).rejects.toBeInstanceOf(DuplicateKeyError);
  });

  it('handles malformed ids without throwing', async () => {
    expect(await brands.findById('nope')).toBeNull();
    expect(await products.findById('nope')).toBeNull();
    expect(await products.delete('nope')).toBe(false);
  });

  it('round-trips a product and finds it by slug', async () => {
    const c = await categories.create(tax('Cat'));
    const b = await brands.create(tax('Brand'));
    const created = await products.create(
      product({ name: 'Vase', slug: 'vase', categoryId: c.id, brandId: b.id }),
    );
    expect((await products.findBySlug('vase'))?.id).toBe(created.id);
    expect(await products.countByCategory(c.id)).toBe(1);
    expect(await products.countByBrand(b.id)).toBe(1);
  });

  it('searches names literally, filters, sorts and paginates', async () => {
    const c = await categories.create(tax('Cat'));
    const b = await brands.create(tax('Brand'));
    const base = { categoryId: c.id, brandId: b.id };
    await products.create(
      product({ ...base, name: 'Alpha (x)', slug: 'alpha', salePriceCents: 100, priceCents: 100 }),
    );
    await products.create(
      product({
        ...base,
        name: 'Beta',
        slug: 'beta',
        salePriceCents: 300,
        priceCents: 300,
        stock: 0,
      }),
    );
    await products.create(
      product({
        ...base,
        name: 'Demo Gamma',
        slug: 'gamma',
        salePriceCents: 200,
        priceCents: 200,
        isDemo: true,
      }),
    );
    const filter = { sort: 'name' as const, page: 1, limit: 10, demoOnly: false };
    expect((await products.findPage({ ...filter, q: '(x)' })).total).toBe(1);
    expect((await products.findPage({ ...filter, q: '.*' })).total).toBe(0);
    expect(
      (await products.findPage({ ...filter, inStock: false })).items.map((p) => p.name),
    ).toEqual(['Beta']);
    expect(
      (await products.findPage({ ...filter, demoOnly: true })).items.map((p) => p.name),
    ).toEqual(['Demo Gamma']);
    expect(
      (await products.findPage({ ...filter, minPriceCents: 150, maxPriceCents: 250 })).total,
    ).toBe(1);
    const desc = await products.findPage({ ...filter, sort: 'price-desc', limit: 2 });
    expect(desc.items.map((p) => p.name)).toEqual(['Beta', 'Demo Gamma']);
    expect(desc.total).toBe(3);
    expect((await products.findPage({ ...filter, limit: 2, page: 2 })).items).toHaveLength(1);
  });
});
