import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  BrandController,
  CategoryController,
  ProductController,
} from '../src/catalogue/catalogue.controllers';
import { Role } from '../src/users/role';
import { AuthTestApp, createAuthApp } from './helpers/create-auth-app';

jest.setTimeout(30_000);

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const SHIP = { address: '12 Linden Street, Oslo', phone: '+47 912 34 567' };
const DAY = 24 * 60 * 60 * 1000;
const ADDRESS = {
  label: 'Home',
  fullName: 'Ada Lovelace',
  line1: '12 Linden Street',
  city: 'Oslo',
  postalCode: '0150',
  country: 'Norway',
  phone: '+47 912 34 567',
};

describe('addresses, guest checkout, timeline, cancel, returns, reorder, notifications', () => {
  let t: AuthTestApp;
  let app: INestApplication;
  let admin: string;
  let alice: { id: string; token: string };
  let bob: { id: string; token: string };
  let viewer: string;
  let vase: string;
  let bowl: string;

  const http = () => request(app.getHttpServer());
  const stock = (id: string) => t.products.records.get(id)!.stock;
  const order = async (
    token: string,
    items: [string, number][] = [[vase, 1]],
    body: object = SHIP,
  ) => {
    for (const [productId, quantity] of items)
      await http().post('/api/cart').set(bearer(token)).send({ productId, quantity }).expect(201);
    return (await http().post('/api/order').set(bearer(token)).send(body).expect(201)).body.data;
  };
  const pay = (token: string, id: string) =>
    http().post(`/api/order/${id}/simulate-payment`).set(bearer(token)).send({}).expect(200);
  const status = (id: string, s: string) =>
    http().patch(`/api/order/${id}/status`).set(bearer(admin)).send({ status: s }).expect(200);
  const delivered = async (token: string) => {
    const o = await order(token);
    await pay(token, o.id);
    await status(o.id, 'SHIPPED');
    await status(o.id, 'DELIVERED');
    return o.id as string;
  };

  beforeEach(async () => {
    t = await createAuthApp([BrandController, CategoryController, ProductController]);
    app = t.app;
    admin = (await t.login(Role.ADMIN)).token;
    alice = await t.login(Role.CUSTOMER);
    bob = await t.login(Role.CUSTOMER);
    viewer = (await t.login(Role.DEMO_VIEWER)).token;
    const categoryId = (
      await http().post('/api/category/create').set(bearer(admin)).send({ name: 'Ceramics' })
    ).body.data.id;
    const brandId = (
      await http().post('/api/brand/create').set(bearer(admin)).send({ name: 'Wadi Works' })
    ).body.data.id;
    const mk = async (name: string, over = {}) =>
      (
        await http()
          .post('/api/product/create')
          .set(bearer(admin))
          .send({
            name,
            images: ['/catalogue/x.jpg'],
            priceCents: 2000,
            stock: 5,
            categoryId,
            brandId,
            ...over,
          })
      ).body.data.id as string;
    vase = await mk('Dune Vase');
    bowl = await mk('Oasis Bowl', { priceCents: 1000, discountPercent: 50 });
  });
  afterEach(() => app.close());

  describe('order timeline', () => {
    it('records every step with its time, oldest first', async () => {
      const id = await delivered(alice.token);
      const o = (await http().get(`/api/order/${id}`).set(bearer(alice.token)).expect(200)).body
        .data;
      expect(o.timeline.map((e: { type: string }) => e.type)).toEqual([
        'PLACED',
        'PAID',
        'SHIPPED',
        'DELIVERED',
      ]);
      expect(o).not.toHaveProperty('guestTokenHash');
    });

    it('rebuilds a timeline for orders saved before timelines existed', async () => {
      const o = await order(alice.token);
      await pay(alice.token, o.id);
      t.orders.records.get(o.id)!.events = [];
      const view = (await http().get(`/api/order/${o.id}`).set(bearer(alice.token))).body.data;
      expect(view.timeline.map((e: { type: string }) => e.type)).toEqual(['PLACED', 'PAID']);
    });
  });

  describe('customer cancellation', () => {
    it('cancels an unpaid order and gives the stock back', async () => {
      const o = await order(alice.token, [[vase, 2]]);
      expect(stock(vase)).toBe(3);
      const r = await http()
        .post(`/api/order/${o.id}/cancel`)
        .set(bearer(alice.token))
        .send({})
        .expect(200);
      expect(r.body.data).toMatchObject({
        status: 'CANCELLED',
        cancellable: false,
        paymentStatus: 'SIMULATED_UNPAID',
      });
      expect(stock(vase)).toBe(5);
      expect(
        (await http().post(`/api/order/${o.id}/cancel`).set(bearer(alice.token)).send({})).status,
      ).toBe(409);
    });

    it('refunds a paid order that has not shipped (simulated), and refuses after shipping', async () => {
      const o = await order(alice.token);
      await pay(alice.token, o.id);
      const r = await http()
        .post(`/api/order/${o.id}/cancel`)
        .set(bearer(alice.token))
        .send({})
        .expect(200);
      expect(r.body.data).toMatchObject({
        status: 'CANCELLED',
        paymentStatus: 'SIMULATED_REFUNDED',
      });
      expect(r.body.data.timeline.at(-1)).toMatchObject({ type: 'REFUNDED' });
      const shipped = await order(alice.token);
      await pay(alice.token, shipped.id);
      await status(shipped.id, 'SHIPPED');
      const late = await http()
        .post(`/api/order/${shipped.id}/cancel`)
        .set(bearer(alice.token))
        .send({});
      expect(late.status).toBe(409);
      expect(late.body.error.message).toMatch(/request a return/);
    });

    it('is only for the owner', async () => {
      const o = await order(alice.token);
      expect(
        (await http().post(`/api/order/${o.id}/cancel`).set(bearer(bob.token)).send({})).status,
      ).toBe(404);
      expect(
        (
          await http()
            .post(`/api/order/${o.id}/cancel`)
            .set(bearer(alice.token))
            .send({ refund: 1 })
        ).status,
      ).toBe(400);
    });
  });

  describe('returns', () => {
    const REASON = { reason: 'The glaze arrived chipped at the rim.' };

    it('goes requested → approved → received, refunding (simulated) and restocking once', async () => {
      const id = await delivered(alice.token);
      expect(stock(vase)).toBe(4);
      const asked = await http()
        .post(`/api/order/${id}/return`)
        .set(bearer(alice.token))
        .send(REASON)
        .expect(200);
      expect(asked.body.data.returnRequest).toMatchObject({
        status: 'REQUESTED',
        reason: REASON.reason,
      });
      expect(asked.body.data.returnable).toBe(false);
      expect(
        (await http().post(`/api/order/${id}/return`).set(bearer(alice.token)).send(REASON)).status,
      ).toBe(409);

      const decide = (decision: string, note?: string) =>
        http()
          .patch(`/api/order/${id}/return`)
          .set(bearer(admin))
          .send(note ? { decision, note } : { decision });
      expect((await decide('RECEIVED')).status).toBe(409); // must be approved first
      await decide('APPROVED', 'Please post it back within 14 days.').expect(200);
      const received = await decide('RECEIVED').expect(200);
      expect(received.body.data).toMatchObject({
        paymentStatus: 'SIMULATED_REFUNDED',
        returnRequest: { status: 'RECEIVED' },
      });
      expect(stock(vase)).toBe(5);
      expect((await decide('RECEIVED')).status).toBe(409);
      const types = received.body.data.timeline.map((e: { type: string }) => e.type);
      expect(types.slice(-3)).toEqual(['RETURN_REQUESTED', 'RETURN_APPROVED', 'RETURN_RECEIVED']);
    });

    it('is refused before delivery, after 30 days, for others, and with a short reason', async () => {
      const o = await order(alice.token);
      expect(
        (await http().post(`/api/order/${o.id}/return`).set(bearer(alice.token)).send(REASON))
          .status,
      ).toBe(409);
      const id = await delivered(alice.token);
      expect(
        (await http().post(`/api/order/${id}/return`).set(bearer(bob.token)).send(REASON)).status,
      ).toBe(404);
      expect(
        (
          await http()
            .post(`/api/order/${id}/return`)
            .set(bearer(alice.token))
            .send({ reason: 'bad' })
        ).status,
      ).toBe(400);
      const realNow = t.ordersService.now;
      t.ordersService.now = () => realNow() + 31 * DAY;
      const late = await http()
        .post(`/api/order/${id}/return`)
        .set(bearer(alice.token))
        .send(REASON);
      t.ordersService.now = realNow;
      expect(late.status).toBe(409);
      expect(late.body.error.message).toMatch(/30-day/);
    });

    it('can be rejected with a note; only admins decide; the viewer reads synthetic ones only', async () => {
      const id = await delivered(alice.token);
      await http()
        .post(`/api/order/${id}/return`)
        .set(bearer(alice.token))
        .send(REASON)
        .expect(200);
      expect(
        (
          await http()
            .patch(`/api/order/${id}/return`)
            .set(bearer(alice.token))
            .send({ decision: 'APPROVED' })
        ).status,
      ).toBe(403);
      expect(
        (
          await http()
            .patch(`/api/order/${id}/return`)
            .set(bearer(viewer))
            .send({ decision: 'APPROVED' })
        ).status,
      ).toBe(403);
      expect(
        (await http().get('/api/order/returns?status=REQUESTED').set(bearer(admin))).body.data,
      ).toHaveLength(1);
      expect((await http().get('/api/order/returns').set(bearer(viewer))).body.data).toEqual([]);
      expect((await http().get('/api/order/returns').set(bearer(alice.token))).status).toBe(403);
      const r = await http()
        .patch(`/api/order/${id}/return`)
        .set(bearer(admin))
        .send({ decision: 'REJECTED', note: 'Used items cannot be returned.' })
        .expect(200);
      expect(r.body.data).toMatchObject({
        paymentStatus: 'SIMULATED_PAID',
        returnRequest: { status: 'REJECTED', note: 'Used items cannot be returned.' },
      });
    });
  });

  describe('reorder', () => {
    it('adds what is still available at today’s prices and lists the rest', async () => {
      const o = await order(alice.token, [
        [vase, 2],
        [bowl, 1],
      ]);
      await pay(alice.token, o.id);
      await http().delete(`/api/product/${bowl}`).set(bearer(admin)); // refused while held? fall back to stock 0
      if (t.products.records.has(bowl)) t.products.records.get(bowl)!.stock = 0;
      t.products.records.get(vase)!.priceCents = 3000;
      t.products.records.get(vase)!.salePriceCents = 3000;
      const r = await http()
        .post(`/api/order/${o.id}/reorder`)
        .set(bearer(alice.token))
        .send({})
        .expect(200);
      expect(r.body.data.added).toBe(2);
      expect(r.body.data.skipped).toEqual([expect.objectContaining({ productId: bowl })]);
      expect(r.body.data.cart.items).toEqual([
        expect.objectContaining({ productId: vase, quantity: 2, unitPriceCents: 3000 }),
      ]);
      expect(
        (await http().post(`/api/order/${o.id}/reorder`).set(bearer(bob.token)).send({})).status,
      ).toBe(404);
    });
  });

  describe('address book', () => {
    it('saves addresses privately, keeps exactly one default, and checks out with one', async () => {
      const first = (
        await http().post('/api/addresses').set(bearer(alice.token)).send(ADDRESS).expect(201)
      ).body.data;
      expect(first.isDefault).toBe(true); // the first one becomes the default
      expect(first).not.toHaveProperty('userId');
      const second = (
        await http()
          .post('/api/addresses')
          .set(bearer(alice.token))
          .send({ ...ADDRESS, label: 'Studio', isDefault: true })
          .expect(201)
      ).body.data;
      const list = (await http().get('/api/addresses').set(bearer(alice.token))).body.data;
      expect(
        list.filter((a: { isDefault: boolean }) => a.isDefault).map((a: { id: string }) => a.id),
      ).toEqual([second.id]);
      expect((await http().get('/api/addresses').set(bearer(bob.token))).body.data).toEqual([]);
      expect(
        (
          await http()
            .patch(`/api/addresses/${first.id}`)
            .set(bearer(bob.token))
            .send({ label: 'x' })
        ).status,
      ).toBe(404);
      await http()
        .post(`/api/addresses/${first.id}/default`)
        .set(bearer(alice.token))
        .send({})
        .expect(200);
      await http().delete(`/api/addresses/${first.id}`).set(bearer(alice.token)).expect(200);
      // Deleting the default promotes the next one.
      expect(
        (await http().get('/api/addresses').set(bearer(alice.token))).body.data[0],
      ).toMatchObject({ id: second.id, isDefault: true });

      const o = await order(alice.token, [[vase, 1]], { addressId: second.id });
      expect(o).toMatchObject({
        address: 'Ada Lovelace, 12 Linden Street, 0150 Oslo, Norway',
        phone: '+47 912 34 567',
      });
      await http()
        .post('/api/cart')
        .set(bearer(bob.token))
        .send({ productId: vase, quantity: 1 })
        .expect(201);
      expect(
        (await http().post('/api/order').set(bearer(bob.token)).send({ addressId: second.id }))
          .status,
      ).toBe(404);
      expect(
        (
          await http()
            .post('/api/order')
            .set(bearer(bob.token))
            .send({ addressId: second.id, ...SHIP })
        ).status,
      ).toBe(400);
    });

    it('validates fields, refuses card numbers and caps the book at 10', async () => {
      const post = (body: object) =>
        http().post('/api/addresses').set(bearer(alice.token)).send(body);
      expect((await post({ ...ADDRESS, phone: 'call me' })).status).toBe(400);
      expect((await post({ ...ADDRESS, line1: '4242 4242 4242 4242' })).status).toBe(400);
      expect((await post({ ...ADDRESS, userId: bob.id })).status).toBe(400);
      for (let i = 0; i < 10; i++) await post(ADDRESS).expect(201);
      expect((await post(ADDRESS)).status).toBe(409);
      expect((await http().get('/api/addresses').set(bearer(admin))).status).toBe(403);
      expect((await http().post('/api/addresses').set(bearer(viewer)).send(ADDRESS)).status).toBe(
        403,
      );
    });
  });

  describe('guest checkout and tracking', () => {
    const guest = (over: object = {}) =>
      http()
        .post('/api/order/guest')
        .send({
          email: 'Guest@Example.com',
          items: [{ productId: vase, quantity: 2 }],
          ...SHIP,
          ...over,
        });

    it('prices a browser cart on the server, including bundle-free sale prices', async () => {
      const q = await http()
        .post('/api/cart/quote')
        .send({
          items: [
            { productId: bowl, quantity: 3 },
            { productId: bowl, quantity: 1 },
          ],
        })
        .expect(200);
      expect(q.body.data).toMatchObject({ subtotalCents: 2000, totalCents: 2000, coupon: null });
      expect(
        (
          await http()
            .post('/api/cart/quote')
            .send({ items: [{ productId: bowl, quantity: 1, unitPriceCents: 1 }] })
        ).status,
      ).toBe(400);
    });

    it('places a guest order, emails a private tracking link, and tracks only with the right code', async () => {
      const r = await guest().expect(201);
      const { order: o, trackingToken, trackPath } = r.body.data;
      expect(o).toMatchObject({
        isGuest: true,
        guestEmail: 'guest@example.com',
        totalCents: 4000,
        status: 'PENDING_PAYMENT',
      });
      expect(trackingToken).toMatch(/^[0-9a-f]{32}$/);
      expect(trackPath).toBe(`/track/${o.id}#${trackingToken}`); // the code sits after #, never sent to a server
      expect(stock(vase)).toBe(3);
      expect(t.orders.records.get(o.id)!.guestTokenHash).not.toContain(trackingToken);
      // The confirmation is sent by the background job queue.
      expect(await t.jobsService.runDue()).toBe(1);
      const mail = t.mail.sent.at(-1)!;
      expect(mail.to).toBe('guest@example.com');
      expect(mail.text).toContain(trackPath);
      expect(mail.text).toMatch(/SIMULATED/);

      const track = (token: string, path = 'track') =>
        http().post(`/api/order/${path}`).send({ orderId: o.id, token });
      expect((await track(trackingToken).expect(200)).body.data.id).toBe(o.id);
      expect((await track('0'.repeat(32))).status).toBe(404);
      expect((await track('nope')).status).toBe(400);
      await track(trackingToken, 'track/simulate-payment').expect(200);
      const cancelled = await track(trackingToken, 'track/cancel').expect(200);
      expect(cancelled.body.data).toMatchObject({
        status: 'CANCELLED',
        paymentStatus: 'SIMULATED_REFUNDED',
      });
      expect(stock(vase)).toBe(5);
      // A customer order cannot be opened through guest tracking.
      const own = await order(alice.token);
      expect(
        (
          await http()
            .post('/api/order/track')
            .send({ orderId: own.id, token: '0'.repeat(32) })
        ).status,
      ).toBe(404);
    });

    it('refuses bad input, sold-out carts and too many orders from one client', async () => {
      expect((await guest({ email: 'not-an-email' })).status).toBe(400);
      expect((await guest({ items: [] })).status).toBe(400);
      expect((await guest({ cardNumber: '4242424242424242' })).status).toBe(400);
      expect((await guest({ items: [{ productId: vase, quantity: 9 }] })).status).toBe(409);
      expect((await guest({ items: [{ productId: 'f'.repeat(24), quantity: 1 }] })).status).toBe(
        409,
      );
      t.products.records.get(bowl)!.stock = 50;
      // The unpaid-order cap also applies to guests, per email.
      for (let i = 0; i < 3; i++)
        await guest({ items: [{ productId: bowl, quantity: 1 }] }).expect(201);
      expect((await guest({ items: [{ productId: bowl, quantity: 1 }] })).status).toBe(409);
      for (let i = 0; i < 7; i++)
        await guest({ email: `g${i}@example.com`, items: [{ productId: bowl, quantity: 1 }] });
      expect(
        (await guest({ email: 'late@example.com', items: [{ productId: bowl, quantity: 1 }] }))
          .status,
      ).toBe(429);
    });

    it('merges a guest cart into the account after sign-in', async () => {
      await http()
        .post('/api/cart')
        .set(bearer(alice.token))
        .send({ productId: vase, quantity: 4 })
        .expect(201);
      const r = await http()
        .post('/api/cart/merge')
        .set(bearer(alice.token))
        .send({
          items: [
            { productId: vase, quantity: 3 },
            { productId: bowl, quantity: 1 },
            { productId: 'f'.repeat(24), quantity: 1 },
          ],
        })
        .expect(200);
      expect(
        r.body.data.cart.items.map((i: { productId: string; quantity: number }) => [
          i.productId,
          i.quantity,
        ]),
      ).toEqual([
        [vase, 5],
        [bowl, 1],
      ]);
      expect(r.body.data.skipped.map((s: { reason: string }) => s.reason)).toEqual([
        'only 1 more could be added',
        'no longer available',
      ]);
    });
  });

  describe('notifications', () => {
    it('tells the customer about fulfilment and returns, privately, and can be marked read', async () => {
      const id = await delivered(alice.token);
      const list = (await http().get('/api/notifications').set(bearer(alice.token)).expect(200))
        .body.data;
      expect(list.unread).toBe(2);
      expect(list.items.map((n: { title: string }) => n.title)).toEqual([
        'Your order was delivered',
        'Your order is on its way',
      ]);
      expect(list.items[0]).toMatchObject({ link: `/orders/${id}`, read: false, type: 'order' });
      expect((await http().get('/api/notifications').set(bearer(bob.token))).body.data).toEqual({
        items: [],
        unread: 0,
      });
      expect(
        (
          await http()
            .post(`/api/notifications/${list.items[0].id}/read`)
            .set(bearer(bob.token))
            .send({})
        ).status,
      ).toBe(404);
      expect(
        (
          await http()
            .post(`/api/notifications/${list.items[0].id}/read`)
            .set(bearer(alice.token))
            .send({})
            .expect(200)
        ).body.data,
      ).toEqual({ unread: 1 });
      await http()
        .post('/api/notifications/read-all')
        .set(bearer(alice.token))
        .send({})
        .expect(200);
      expect(
        (await http().get('/api/notifications').set(bearer(alice.token))).body.data.unread,
      ).toBe(0);
    });

    it('never notifies guests and never fails an action when saving one fails', async () => {
      const { order: o } = (
        await http()
          .post('/api/order/guest')
          .send({ email: 'g@example.com', items: [{ productId: vase, quantity: 1 }], ...SHIP })
          .expect(201)
      ).body.data;
      const before = t.notifications.records.size;
      t.notifications.create = () => Promise.reject(new Error('store down'));
      await http()
        .patch(`/api/order/${o.id}/status`)
        .set(bearer(admin))
        .send({ status: 'CANCELLED' })
        .expect(200);
      const paid = await order(alice.token);
      await pay(alice.token, paid.id);
      await status(paid.id, 'SHIPPED'); // still succeeds
      expect(t.notifications.records.size).toBe(before);
    });
  });
});
