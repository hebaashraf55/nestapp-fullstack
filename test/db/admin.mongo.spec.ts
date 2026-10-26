/**
 * Mongoose-backed tests for the Step 7 reporting queries and the audit log. They need a real MongoDB,
 * so they run only when MONGODB_TEST_URI is set (use a throwaway database); otherwise they are SKIPPED,
 * never passed.
 */
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model } from 'mongoose';
import { AuditLog, AuditLogSchema } from '../../src/audit/audit.schema';
import { MongoAuditRepository } from '../../src/audit/mongo-audit.repository';
import { Product, ProductSchema } from '../../src/catalogue/catalogue.schemas';
import { MongoProductsRepository } from '../../src/catalogue/mongo-catalogue.repositories';
import { MongoOrdersRepository } from '../../src/orders/mongo-orders.repository';
import { Order, OrderSchema } from '../../src/orders/order.schema';
import type { NewOrder } from '../../src/orders/orders.repository';
import { MongoUsersRepository } from '../../src/users/mongo-users.repository';
import { Role } from '../../src/users/role';
import { User, UserSchema } from '../../src/users/user.schema';

const uri = process.env.MONGODB_TEST_URI;
const suite = uri ? describe : describe.skip;

suite('admin reporting queries and audit log (real MongoDB)', () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let users: MongoUsersRepository;
  let orders: MongoOrdersRepository;
  let products: MongoProductsRepository;
  let audit: MongoAuditRepository;
  let models: Model<unknown>[];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(uri as string, { serverSelectionTimeoutMS: 5000 }),
        MongooseModule.forFeature([
          { name: User.name, schema: UserSchema },
          { name: Order.name, schema: OrderSchema },
          { name: Product.name, schema: ProductSchema },
          { name: AuditLog.name, schema: AuditLogSchema },
        ]),
      ],
      providers: [
        MongoUsersRepository,
        MongoOrdersRepository,
        MongoProductsRepository,
        MongoAuditRepository,
      ],
    }).compile();
    await moduleRef.init();
    users = moduleRef.get(MongoUsersRepository);
    orders = moduleRef.get(MongoOrdersRepository);
    products = moduleRef.get(MongoProductsRepository);
    audit = moduleRef.get(MongoAuditRepository);
    models = [User, Order, Product, AuditLog].map((c) => moduleRef.get(getModelToken(c.name)));
    await Promise.all(models.map((m) => m.init()));
  });
  beforeEach(async () => {
    await Promise.all(models.map((m) => m.deleteMany({})));
  });
  afterAll(async () => {
    await moduleRef?.close();
  });

  const oid = (n: number) => n.toString(16).padStart(24, '0');
  const user = (email: string, role: Role, isDemo: boolean) =>
    users.create({
      email,
      name: 'N',
      passwordHash: 'scrypt$x',
      role,
      isDemo,
      emailVerified: true,
    });
  const order = (over: Partial<NewOrder>) =>
    orders.create({
      userId: 'u1',
      isDemo: false,
      items: [
        {
          productId: oid(1),
          name: 'Vase',
          unitPriceCents: 1000,
          quantity: 1,
          lineTotalCents: 1000,
        },
      ],
      subtotalCents: 1000,
      couponCode: null,
      couponPercent: null,
      discountCents: 0,
      totalCents: 1000,
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
  const product = (stock: number, isDemo: boolean) =>
    products.create({
      name: 'P',
      slug: `p-${Math.random().toString(16).slice(2)}`,
      description: '',
      images: ['/catalogue/p.svg'],
      priceCents: 1000,
      discountPercent: 0,
      salePriceCents: 1000,
      stock,
      categoryId: oid(1),
      brandId: oid(2),
      isDemo,
      createdBy: 'tester',
    });

  it('users.findPage filters by role and demo scope, newest first, with a correct total', async () => {
    await user('a@example.com', Role.CUSTOMER, false);
    await user('b@example.com', Role.CUSTOMER, true);
    await user('c@example.com', Role.ADMIN, false);
    await user('d@example.com', Role.DEMO_VIEWER, true);
    const all = await users.findPage({
      roles: [Role.CUSTOMER],
      demoOnly: false,
      page: 1,
      limit: 10,
    });
    expect(all.total).toBe(2);
    expect(all.items.map((u) => u.email)).toEqual(['b@example.com', 'a@example.com']);
    const demo = await users.findPage({
      roles: [Role.CUSTOMER],
      demoOnly: true,
      page: 1,
      limit: 10,
    });
    expect(demo.items.map((u) => u.email)).toEqual(['b@example.com']);
    const paged = await users.findPage({
      roles: [Role.CUSTOMER],
      demoOnly: false,
      page: 2,
      limit: 1,
    });
    expect(paged.items).toHaveLength(1);
    expect(paged.total).toBe(2);
  });

  it('users.findByIds ignores malformed and unknown ids', async () => {
    const a = await user('a@example.com', Role.CUSTOMER, false);
    const found = await users.findByIds([a.id, 'nope', oid(99)]);
    expect(found.map((u) => u.id)).toEqual([a.id]);
    expect(await users.findByIds(['nope'])).toEqual([]);
  });

  it('orders.findPage filters by status and demo scope and rejects operator injection', async () => {
    await order({ status: 'PAID', paymentStatus: 'SIMULATED_PAID' });
    await order({ status: 'PAID', paymentStatus: 'SIMULATED_PAID', isDemo: true });
    await order({ status: 'EXPIRED' });
    expect((await orders.findPage({ demoOnly: false, page: 1, limit: 10 })).total).toBe(3);
    expect(
      (await orders.findPage({ status: 'PAID', demoOnly: false, page: 1, limit: 10 })).total,
    ).toBe(2);
    const demo = await orders.findPage({ status: 'PAID', demoOnly: true, page: 1, limit: 10 });
    expect(demo.items.every((o) => o.isDemo)).toBe(true);
    expect(demo.total).toBe(1);
  });

  it('orders.summarize counts by status and sums only simulated paid and refunded totals', async () => {
    await order({ status: 'PAID', paymentStatus: 'SIMULATED_PAID', totalCents: 2500 });
    await order({ status: 'SHIPPED', paymentStatus: 'SIMULATED_PAID', totalCents: 4000 });
    await order({ status: 'CANCELLED', paymentStatus: 'SIMULATED_REFUNDED', totalCents: 700 });
    await order({ status: 'PENDING_PAYMENT', totalCents: 9999 });
    await order({ status: 'PAID', paymentStatus: 'SIMULATED_PAID', totalCents: 900, isDemo: true });
    const all = await orders.summarize(false);
    expect(all.countsByStatus).toEqual({ PAID: 2, SHIPPED: 1, CANCELLED: 1, PENDING_PAYMENT: 1 });
    expect(all.paidCents).toBe(2500 + 4000 + 900);
    expect(all.refundedCents).toBe(700);
    const demo = await orders.summarize(true);
    expect(demo).toEqual({ countsByStatus: { PAID: 1 }, paidCents: 900, refundedCents: 0 });
  });

  it('products.summarizeStock counts total, sold out and low stock within the demo scope', async () => {
    await product(50, false);
    await product(5, false);
    await product(6, false);
    await product(0, false);
    await product(2, true);
    expect(await products.summarizeStock(false, 5)).toEqual({
      total: 5,
      outOfStock: 1,
      lowStock: 2,
    });
    expect(await products.summarizeStock(true, 5)).toEqual({
      total: 1,
      outOfStock: 0,
      lowStock: 1,
    });
  });

  it('audit log appends entries and returns them newest first with a total', async () => {
    for (const action of ['a.one', 'a.two', 'a.three']) {
      await audit.record({
        actorId: oid(1),
        actorRole: 'ADMIN',
        action,
        targetId: oid(2),
        detail: null,
      });
    }
    const page = await audit.findPage(1, 2);
    expect(page.total).toBe(3);
    expect(page.items.map((e) => e.action)).toEqual(['a.three', 'a.two']);
    expect((await audit.findPage(2, 2)).items.map((e) => e.action)).toEqual(['a.one']);
  });
});
