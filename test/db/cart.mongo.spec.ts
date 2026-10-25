/**
 * Mongoose-backed tests for the coupon and cart repositories and the product bulk lookup. They need a
 * real MongoDB, so they run only when MONGODB_TEST_URI is set; otherwise they are SKIPPED (not passed).
 */
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model } from 'mongoose';
import { Cart, CartSchema } from '../../src/cart/cart.schema';
import { VersionConflictError } from '../../src/cart/cart.repository';
import { MongoCartsRepository } from '../../src/cart/mongo-cart.repository';
import { DuplicateKeyError } from '../../src/catalogue/catalogue.repositories';
import { Product, ProductSchema } from '../../src/catalogue/catalogue.schemas';
import { MongoProductsRepository } from '../../src/catalogue/mongo-catalogue.repositories';
import { Coupon, CouponSchema } from '../../src/coupons/coupon.schema';
import { MongoCouponsRepository } from '../../src/coupons/mongo-coupons.repository';

const uri = process.env.MONGODB_TEST_URI;
const suite = uri ? describe : describe.skip;

suite('coupon and cart storage (real MongoDB)', () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let coupons: MongoCouponsRepository;
  let carts: MongoCartsRepository;
  let products: MongoProductsRepository;
  let models: Model<unknown>[];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(uri as string, { serverSelectionTimeoutMS: 5000 }),
        MongooseModule.forFeature([
          { name: Coupon.name, schema: CouponSchema },
          { name: Cart.name, schema: CartSchema },
          { name: Product.name, schema: ProductSchema },
        ]),
      ],
      providers: [MongoCouponsRepository, MongoCartsRepository, MongoProductsRepository],
    }).compile();
    await moduleRef.init();
    coupons = moduleRef.get(MongoCouponsRepository);
    carts = moduleRef.get(MongoCartsRepository);
    products = moduleRef.get(MongoProductsRepository);
    models = [Coupon, Cart, Product].map((c) => moduleRef.get(getModelToken(c.name)));
    await Promise.all(models.map((m) => m.init()));
  });
  beforeEach(async () => {
    await Promise.all(models.map((m) => m.deleteMany({})));
  });
  afterAll(async () => {
    await moduleRef?.close();
  });

  const coupon = (code: string) => ({
    code,
    discountPercent: 10,
    expiresAt: new Date(Date.now() + 86_400_000),
    isDemo: false,
    createdBy: 'tester',
  });
  const oid = (n: number) => n.toString(16).padStart(24, '0');

  it('stores codes upper-case and rejects a duplicate as DuplicateKeyError', async () => {
    await coupons.create(coupon('save10'));
    expect((await coupons.findByCode('SAVE10'))?.code).toBe('SAVE10');
    await expect(coupons.create(coupon('SAVE10'))).rejects.toBeInstanceOf(DuplicateKeyError);
  });

  it('handles malformed coupon ids without throwing', async () => {
    expect(await coupons.findById('nope')).toBeNull();
    expect(await coupons.update('nope', { discountPercent: 5 })).toBeNull();
    expect(await coupons.delete('nope')).toBe(false);
  });

  it('creates a cart once and updates it only with the matching version', async () => {
    await carts.save('u1', 0, { items: [{ productId: oid(1), quantity: 2 }], couponId: null });
    const first = await carts.findByUser('u1');
    expect(first).toMatchObject({ version: 1, items: [{ productId: oid(1), quantity: 2 }] });
    await carts.save('u1', 1, { items: [{ productId: oid(1), quantity: 3 }], couponId: null });
    expect((await carts.findByUser('u1'))?.version).toBe(2);
    await expect(carts.save('u1', 1, { items: [], couponId: null })).rejects.toBeInstanceOf(
      VersionConflictError,
    );
    await expect(carts.save('u1', 0, { items: [], couponId: null })).rejects.toBeInstanceOf(
      VersionConflictError,
    );
    expect((await carts.findByUser('u1'))?.items[0]?.quantity).toBe(3);
  });

  it('keeps carts of different users separate', async () => {
    await carts.save('u1', 0, { items: [{ productId: oid(1), quantity: 1 }], couponId: null });
    expect(await carts.findByUser('u2')).toBeNull();
  });

  it('looks products up in bulk and ignores malformed or unknown ids', async () => {
    const base = {
      description: '',
      images: ['/catalogue/p.svg'],
      priceCents: 1000,
      discountPercent: 0,
      salePriceCents: 1000,
      stock: 1,
      categoryId: oid(1),
      brandId: oid(2),
      isDemo: false,
      createdBy: 'tester',
    };
    const a = await products.create({ ...base, name: 'A product', slug: 'a-product' });
    expect(await products.findByIds([])).toEqual([]);
    const found = await products.findByIds([a.id, 'nope', oid(99)]);
    expect(found.map((p) => p.id)).toEqual([a.id]);
  });
});
