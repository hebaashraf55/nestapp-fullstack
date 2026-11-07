import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import { Address, AddressSchema } from '../../src/addresses/address.schema';
import { MongoAddressesRepository } from '../../src/addresses/mongo-addresses.repository';
import { MongoNotificationsRepository } from '../../src/notifications/mongo-notifications.repository';
import { Notification, NotificationSchema } from '../../src/notifications/notification.schema';
import { MongoOrdersRepository } from '../../src/orders/mongo-orders.repository';
import { Order, OrderSchema } from '../../src/orders/order.schema';
import { NewOrder } from '../../src/orders/orders.repository';

const uri = process.env.MONGODB_TEST_URI;
const suite = uri ? describe : describe.skip;
const oid = (n: number) => n.toString(16).padStart(24, '0');
const FIELDS = {
  label: 'Home',
  fullName: 'Ada Lovelace',
  line1: '12 Linden Street',
  line2: '',
  city: 'Oslo',
  postalCode: '0150',
  country: 'Norway',
  phone: '+47 912 34 567',
};
const newOrder = (over: Partial<NewOrder> = {}): NewOrder => ({
  userId: 'u1',
  isDemo: false,
  items: [
    { productId: oid(1), name: 'Vase', unitPriceCents: 1000, quantity: 1, lineTotalCents: 1000 },
  ],
  subtotalCents: 1000,
  couponCode: null,
  couponPercent: null,
  discountCents: 0,
  totalCents: 1000,
  currency: 'USD',
  address: '12 Linden Street, Oslo',
  phone: '+47 912 34 567',
  status: 'DELIVERED',
  paymentStatus: 'SIMULATED_PAID',
  expiresAt: new Date(),
  paidAt: new Date(),
  refundedAt: null,
  cancelledAt: null,
  ...over,
});

suite('orders timeline and returns, addresses, notifications (real MongoDB)', () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let orders: MongoOrdersRepository;
  let addresses: MongoAddressesRepository;
  let notes: MongoNotificationsRepository;
  let models: Model<unknown>[];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(uri as string, { serverSelectionTimeoutMS: 5000 }),
        MongooseModule.forFeature([
          { name: Order.name, schema: OrderSchema },
          { name: Address.name, schema: AddressSchema },
          { name: Notification.name, schema: NotificationSchema },
        ]),
      ],
      providers: [MongoOrdersRepository, MongoAddressesRepository, MongoNotificationsRepository],
    }).compile();
    await moduleRef.init();
    orders = moduleRef.get(MongoOrdersRepository);
    addresses = moduleRef.get(MongoAddressesRepository);
    notes = moduleRef.get(MongoNotificationsRepository);
    models = [Order, Address, Notification].map((c) => moduleRef.get(getModelToken(c.name)));
    await Promise.all(models.map((m) => m.init()));
  });
  beforeEach(async () => {
    await Promise.all(models.map((m) => m.deleteMany({})));
  });
  afterAll(async () => {
    await moduleRef?.close();
  });

  it('starts every order with a PLACED event and appends events atomically with the status', async () => {
    const o = await orders.create(
      newOrder({ status: 'PENDING_PAYMENT', paymentStatus: 'SIMULATED_UNPAID' }),
    );
    expect(o.events.map((e) => e.type)).toEqual(['PLACED']);
    const paid = await orders.transition(
      o.id,
      ['PENDING_PAYMENT'],
      { status: 'PAID' },
      { type: 'PAID', at: new Date(), note: null },
    );
    expect(paid?.events.map((e) => e.type)).toEqual(['PLACED', 'PAID']);
    // A losing transition adds nothing.
    expect(
      await orders.transition(
        o.id,
        ['PENDING_PAYMENT'],
        { status: 'EXPIRED' },
        { type: 'EXPIRED', at: new Date(), note: null },
      ),
    ).toBeNull();
    expect((await orders.findById(o.id))?.events).toHaveLength(2);
    await expect(
      orders.transition(
        o.id,
        ['PAID'],
        {},
        { type: 'NOT_A_TYPE' as 'PAID', at: new Date(), note: null },
      ),
    ).rejects.toThrow();
  });

  it('lets exactly one of several racing return requests in, and only for delivered orders', async () => {
    const o = await orders.create(newOrder());
    const request = () =>
      orders.updateReturn(
        o.id,
        null,
        {
          returnRequest: {
            status: 'REQUESTED',
            reason: 'Chipped rim',
            requestedAt: new Date(),
            decidedAt: null,
            note: null,
          },
        },
        { type: 'RETURN_REQUESTED', at: new Date(), note: null },
      );
    const results = await Promise.all(Array.from({ length: 6 }, request));
    expect(results.filter(Boolean)).toHaveLength(1);
    const stored = await orders.findById(o.id);
    expect(stored?.events.filter((e) => e.type === 'RETURN_REQUESTED')).toHaveLength(1);
    expect((await orders.findReturns('REQUESTED', false, 10)).map((r) => r.id)).toEqual([o.id]);
    expect(await orders.findReturns('APPROVED', false, 10)).toEqual([]);
    const pending = await orders.create(newOrder({ status: 'PAID' }));
    expect(
      await orders.updateReturn(
        pending.id,
        null,
        {},
        { type: 'RETURN_REQUESTED', at: new Date(), note: null },
      ),
    ).toBeNull();
    // Older orders without the new fields read as empty.
    await models[0]!.collection.updateOne(
      { _id: new Types.ObjectId(pending.id) },
      { $unset: { events: '', returnRequest: '', guestEmail: '', guestTokenHash: '' } },
    );
    expect(await orders.findById(pending.id)).toMatchObject({
      events: [],
      returnRequest: null,
      guestEmail: null,
      guestTokenHash: null,
    });
  });

  it('keeps one default address per customer, even when two requests race', async () => {
    await Promise.all(Array.from({ length: 5 }, () => addresses.create('u1', FIELDS, true)));
    const list = await addresses.list('u1');
    expect(list).toHaveLength(5);
    expect(list.filter((a) => a.isDefault)).toHaveLength(1);
    const other = list.find((a) => !a.isDefault)!;
    await Promise.all([
      addresses.setDefault(other.id, 'u1'),
      addresses.setDefault(list[0]!.id, 'u1'),
    ]);
    expect((await addresses.list('u1')).filter((a) => a.isDefault)).toHaveLength(1);
    expect(await addresses.setDefault(other.id, 'u2')).toBeNull(); // not the owner
    expect(await addresses.findOwned(other.id, { $ne: 'x' } as unknown as string)).toBeNull();
    await expect(
      addresses.create('u1', { ...FIELDS, postalCode: 'x'.repeat(30) }, false),
    ).rejects.toThrow();
  });

  it('scopes notifications to their owner and marks them read once', async () => {
    const n = await notes.create({
      userId: 'u1',
      type: 'order',
      title: 'Shipped',
      body: '',
      link: '/orders/1',
    });
    await notes.create({ userId: 'u2', type: 'order', title: 'Other', body: '', link: null });
    expect(await notes.countUnread('u1')).toBe(1);
    expect(await notes.markRead(n.id, 'u2', new Date())).toBe(false);
    const first = new Date('2026-01-01T00:00:00Z');
    expect(await notes.markRead(n.id, 'u1', first)).toBe(true);
    await notes.markRead(n.id, 'u1', new Date('2027-01-01T00:00:00Z'));
    expect((await notes.listByUser('u1', 10))[0]!.readAt).toEqual(first); // the first read time is kept
    expect(await notes.listByUser({ $ne: 'x' } as unknown as string, 10)).toEqual([]);
    expect(await notes.markAllRead('u2', new Date())).toBe(1);
  });
});
