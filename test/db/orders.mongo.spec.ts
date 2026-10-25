/**
 * Mongoose-backed tests for the order repository and the atomic stock primitives. They need a real
 * MongoDB, so they run only when MONGODB_TEST_URI is set; otherwise they are SKIPPED (not passed).
 */
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model } from 'mongoose';
import { Product, ProductSchema } from '../../src/catalogue/catalogue.schemas';
import { MongoProductsRepository } from '../../src/catalogue/mongo-catalogue.repositories';
import { MongoOrdersRepository } from '../../src/orders/mongo-orders.repository';
import { Order, OrderSchema } from '../../src/orders/order.schema';
import type { NewOrder } from '../../src/orders/orders.repository';

const uri = process.env.MONGODB_TEST_URI;
const suite = uri ? describe : describe.skip;

suite('order storage and stock reservation (real MongoDB)', () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let orders: MongoOrdersRepository;
  let products: MongoProductsRepository;
  let models: Model<unknown>[];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(uri as string, { serverSelectionTimeoutMS: 5000 }),
        MongooseModule.forFeature([
          { name: Order.name, schema: OrderSchema },
          { name: Product.name, schema: ProductSchema },
        ]),
      ],
      providers: [MongoOrdersRepository, MongoProductsRepository],
    }).compile();
    await moduleRef.init();
    orders = moduleRef.get(MongoOrdersRepository);
    products = moduleRef.get(MongoProductsRepository);
    models = [Order, Product].map((c) => moduleRef.get(getModelToken(c.name)));
    await Promise.all(models.map((m) => m.init()));
  });
  beforeEach(async () => {
    await Promise.all(models.map((m) => m.deleteMany({})));
  });
  afterAll(async () => {
    await moduleRef?.close();
  });

  const oid = (n: number) => n.toString(16).padStart(24, '0');
  const newOrder = (over: Partial<NewOrder> = {}): NewOrder => ({
    userId: 'u1',
    isDemo: false,
    items: [
      { productId: oid(1), name: 'Vase', unitPriceCents: 1000, quantity: 2, lineTotalCents: 2000 },
    ],
    subtotalCents: 2000,
    couponCode: null,
    couponPercent: null,
    discountCents: 0,
    totalCents: 2000,
    currency: 'USD',
    address: '12 Nile Corniche, Cairo',
    phone: '+20 100 123 4567',
    status: 'PENDING_PAYMENT',
    paymentStatus: 'SIMULATED_UNPAID',
    expiresAt: new Date(Date.now() + 60_000),
    paidAt: null,
    refundedAt: null,
    cancelledAt: null,
    ...over,
  });
  const product = async (stock: number) =>
    products.create({
      name: 'A product',
      slug: `a-product-${Math.random().toString(16).slice(2)}`,
      description: '',
      images: ['/catalogue/p.svg'],
      priceCents: 1000,
      discountPercent: 0,
      salePriceCents: 1000,
      stock,
      categoryId: oid(1),
      brandId: oid(2),
      isDemo: false,
      createdBy: 'tester',
    });

  it('round-trips an order', async () => {
    const created = await orders.create(newOrder());
    expect(await orders.findById(created.id)).toMatchObject({
      status: 'PENDING_PAYMENT',
      totalCents: 2000,
    });
    expect(await orders.findById('nope')).toBeNull();
  });

  it('transitions only from an allowed state, and only one of two racing callers wins', async () => {
    const created = await orders.create(newOrder());
    const results = await Promise.all([
      orders.transition(created.id, ['PENDING_PAYMENT'], {
        status: 'PAID',
        paymentStatus: 'SIMULATED_PAID',
      }),
      orders.transition(created.id, ['PENDING_PAYMENT'], {
        status: 'PAID',
        paymentStatus: 'SIMULATED_PAID',
      }),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(
      await orders.transition(created.id, ['PENDING_PAYMENT'], { status: 'EXPIRED' }),
    ).toBeNull();
    expect((await orders.findById(created.id))?.status).toBe('PAID');
  });

  it('lists a user’s orders newest first and counts only pending ones', async () => {
    await orders.create(newOrder());
    const b = await orders.create(newOrder({ status: 'PAID', paymentStatus: 'SIMULATED_PAID' }));
    await orders.create(newOrder({ userId: 'u2' }));
    const list = await orders.findByUser('u1', 10);
    expect(list).toHaveLength(2);
    expect(list[0]?.createdAt.getTime()).toBeGreaterThanOrEqual(list[1]?.createdAt.getTime() ?? 0);
    expect(b.status).toBe('PAID');
    expect(await orders.countPending('u1')).toBe(1);
  });

  it('finds overdue unpaid orders only', async () => {
    await orders.create(newOrder({ expiresAt: new Date(Date.now() - 1000) }));
    await orders.create(newOrder({ expiresAt: new Date(Date.now() - 1000), status: 'PAID' }));
    await orders.create(newOrder());
    expect(await orders.findOverdue(new Date(), 10)).toHaveLength(1);
  });

  it('reserves stock only while enough remains, never going negative', async () => {
    const p = await product(3);
    expect(await products.reserveStock(p.id, 2)).toBe(true);
    expect(await products.reserveStock(p.id, 2)).toBe(false);
    expect((await products.findById(p.id))?.stock).toBe(1);
    const racers = await Promise.all(
      Array.from({ length: 5 }, () => products.reserveStock(p.id, 1)),
    );
    expect(racers.filter(Boolean)).toHaveLength(1);
    expect((await products.findById(p.id))?.stock).toBe(0);
  });

  it('restores stock, and ignores unknown or malformed product ids', async () => {
    const p = await product(1);
    await products.reserveStock(p.id, 1);
    await products.restoreStock(p.id, 1);
    expect((await products.findById(p.id))?.stock).toBe(1);
    await expect(products.restoreStock(oid(99), 1)).resolves.toBeUndefined();
    await expect(products.restoreStock('nope', 1)).resolves.toBeUndefined();
    expect(await products.reserveStock('nope', 1)).toBe(false);
  });
});
