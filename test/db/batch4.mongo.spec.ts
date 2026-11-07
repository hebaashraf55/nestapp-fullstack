import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model } from 'mongoose';
import { Coupon, CouponSchema, CouponUse, CouponUseSchema } from '../../src/coupons/coupon.schema';
import { MongoCouponsRepository } from '../../src/coupons/mongo-coupons.repository';
import { InventoryMovement, InventoryMovementSchema } from '../../src/inventory/movement.schema';
import { MongoInventoryRepository } from '../../src/inventory/mongo-inventory.repository';
import { MongoOrdersRepository } from '../../src/orders/mongo-orders.repository';
import { Order, OrderSchema } from '../../src/orders/order.schema';
import { NewOrder } from '../../src/orders/orders.repository';

const uri = process.env.MONGODB_TEST_URI;
const suite = uri ? describe : describe.skip;
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);
const newOrder = (over: Partial<NewOrder> = {}): NewOrder => ({
  userId: 'u1',
  isDemo: false,
  items: [
    {
      productId: '0'.repeat(23) + '1',
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
  address: '12 Linden Street, Oslo',
  phone: '+47 912 34 567',
  status: 'PAID',
  paymentStatus: 'SIMULATED_PAID',
  expiresAt: new Date(),
  paidAt: new Date(),
  refundedAt: null,
  cancelledAt: null,
  ...over,
});

suite('promotions, inventory history and fulfilment storage (real MongoDB)', () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let coupons: MongoCouponsRepository;
  let inventory: MongoInventoryRepository;
  let orders: MongoOrdersRepository;
  let models: Model<unknown>[];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(uri as string, { serverSelectionTimeoutMS: 5000 }),
        MongooseModule.forFeature([
          { name: Coupon.name, schema: CouponSchema },
          { name: CouponUse.name, schema: CouponUseSchema },
          { name: InventoryMovement.name, schema: InventoryMovementSchema },
          { name: Order.name, schema: OrderSchema },
        ]),
      ],
      providers: [MongoCouponsRepository, MongoInventoryRepository, MongoOrdersRepository],
    }).compile();
    await moduleRef.init();
    coupons = moduleRef.get(MongoCouponsRepository);
    inventory = moduleRef.get(MongoInventoryRepository);
    orders = moduleRef.get(MongoOrdersRepository);
    models = [Coupon, CouponUse, InventoryMovement, Order].map((c) =>
      moduleRef.get(getModelToken(c.name)),
    );
    await Promise.all(models.map((m) => m.init()));
  });
  beforeEach(async () => {
    await Promise.all(models.map((m) => m.deleteMany({})));
  });
  afterAll(async () => {
    await moduleRef?.close();
  });

  const create = (over: object = {}) =>
    coupons.create({
      code: 'SAVE',
      discountPercent: 10,
      expiresAt: inDays(5),
      active: true,
      isDemo: false,
      createdBy: 'a',
      ...over,
    });

  it('hands out exactly maxUses uses when many orders claim at once', async () => {
    const c = await create({ maxUses: 3 });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => coupons.claim(c.id, `u${i}`, null)),
    );
    expect(results.filter((r) => r === 'ok')).toHaveLength(3);
    expect(results.filter((r) => r === 'used-up')).toHaveLength(7);
    expect((await coupons.findById(c.id))?.usedCount).toBe(3);
  });

  it('enforces the per-customer limit under a race and keeps the total count consistent', async () => {
    const c = await create({ maxUsesPerCustomer: 2 });
    const results = await Promise.all(
      Array.from({ length: 6 }, () => coupons.claim(c.id, 'u1', 2)),
    );
    expect(results.filter((r) => r === 'ok')).toHaveLength(2);
    expect(await coupons.usesBy(c.id, 'u1')).toBe(2);
    expect((await coupons.findById(c.id))?.usedCount).toBe(2); // refused claims gave their global use back
    await coupons.release(c.id, 'u1');
    await coupons.release(c.id, 'u1');
    await coupons.release(c.id, 'u1'); // never below zero
    expect(await coupons.usesBy(c.id, 'u1')).toBe(0);
    expect((await coupons.findById(c.id))?.usedCount).toBe(0);
    expect(await coupons.claim(c.id, { $ne: 'x' } as unknown as string, 2)).toBe('used-up');
  });

  it('reads coupons saved before promotions existed with safe defaults', async () => {
    await models[0]!.collection.insertOne({
      code: 'OLD10',
      discountPercent: 10,
      expiresAt: inDays(5),
      isDemo: false,
      createdBy: 'a',
      createdAt: new Date(),
    });
    expect(await coupons.findByCode('OLD10')).toMatchObject({
      type: 'PERCENT',
      active: true,
      usedCount: 0,
      maxUses: null,
      scope: 'ALL',
      automatic: false,
      startsAt: null,
      minSubtotalCents: 0,
    });
    await create({ code: 'AUTO', automatic: true });
    expect((await coupons.findAutomatic()).map((c) => c.code)).toEqual(['AUTO']);
  });

  it('appends inventory movements and filters them without operator injection', async () => {
    await inventory.append([
      {
        productId: 'p1',
        productName: 'Vase',
        change: 10,
        reason: 'INITIAL',
        note: null,
        orderId: null,
        actorId: 'a',
        isDemo: false,
      },
      {
        productId: 'p1',
        productName: 'Vase',
        change: -2,
        reason: 'ORDER_RESERVED',
        note: null,
        orderId: 'o1',
        actorId: null,
        isDemo: false,
      },
      {
        productId: 'p2',
        productName: 'Lamp',
        change: 5,
        reason: 'RECEIVED',
        note: 'Pallet 4',
        orderId: null,
        actorId: 'a',
        isDemo: true,
      },
    ]);
    expect(
      (
        await inventory.findPage({ productId: 'p1', demoOnly: false, page: 1, limit: 10 })
      ).items.map((m) => m.change),
    ).toEqual([-2, 10]);
    expect((await inventory.findPage({ demoOnly: true, page: 1, limit: 10 })).total).toBe(1);
    expect(
      (
        await inventory.findPage({
          productId: { $ne: 'x' } as unknown as string,
          demoOnly: false,
          page: 1,
          limit: 10,
        })
      ).total,
    ).toBe(0);
    await expect(
      inventory.append([
        {
          productId: 'p1',
          productName: 'Vase',
          change: 1,
          reason: 'MAGIC' as 'INITIAL',
          note: null,
          orderId: null,
          actorId: null,
          isDemo: false,
        },
      ]),
    ).rejects.toThrow();
  });

  it('stores the shipment and coupon id, and finds recent activity for analytics', async () => {
    const o = await orders.create(newOrder({ couponId: 'c1' }));
    expect(o).toMatchObject({ couponId: 'c1', shipment: null });
    const shipped = await orders.transition(
      o.id,
      ['PAID'],
      {
        status: 'SHIPPED',
        shipment: {
          carrier: 'DEMO_POST',
          trackingNumber: 'SIM-ABC123',
          shippedAt: new Date(),
          simulated: true,
        },
      },
      { type: 'SHIPPED', at: new Date(), note: null },
    );
    expect((await orders.findById(o.id))?.shipment).toMatchObject({
      carrier: 'DEMO_POST',
      trackingNumber: 'SIM-ABC123',
      simulated: true,
    });
    expect(shipped?.status).toBe('SHIPPED');
    await expect(
      orders.transition(o.id, ['SHIPPED'], {
        shipment: {
          carrier: 'FEDEX' as 'DEMO_POST',
          trackingNumber: 'x',
          shippedAt: new Date(),
          simulated: true,
        },
      }),
    ).rejects.toThrow();
    await models[3]!.collection.insertOne({
      ...newOrder(),
      createdAt: inDays(-100),
      paidAt: inDays(-100),
    });
    const recent = await orders.findActivitySince(inDays(-30), false, 100);
    expect(recent.map((r) => r.id)).toEqual([o.id]);
    expect(await orders.findActivitySince(inDays(-30), true, 100)).toEqual([]);
  });
});
