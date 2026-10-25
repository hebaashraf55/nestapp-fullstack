import { INestApplication, ServiceUnavailableException } from '@nestjs/common';
import request from 'supertest';
import {
  BrandController,
  CategoryController,
  ProductController,
} from '../src/catalogue/catalogue.controllers';
import { containsCardNumber, passesLuhn } from '../src/orders/dto';
import { OrderExpirySweeper } from '../src/orders/order-expiry.sweeper';
import {
  ADMIN_STATUS_TARGETS,
  canAdminTransition,
  ORDER_STATUSES,
  ORDER_TTL_MS,
  PAYMENT_STATUSES,
} from '../src/orders/order-status';
import { Role } from '../src/users/role';
import { AuthTestApp, createAuthApp } from './helpers/create-auth-app';
import { loadEnv } from '../src/config/env';

jest.setTimeout(30_000);

interface Order {
  id: string;
  status: string;
  paymentStatus: string;
  items: {
    productId: string;
    name: string;
    unitPriceCents: number;
    quantity: number;
    lineTotalCents: number;
  }[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  coupon: { code: string } | null;
  paidAt: string | null;
  refundedAt: string | null;
  expiresAt: string;
  payment: { mode: string; notice: string };
}
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const future = () => new Date(Date.now() + 30 * 86_400_000).toISOString();
const SHIP = { address: '12 Nile Corniche, Cairo', phone: '+20 100 123 4567' };

describe('orders and simulated payments', () => {
  let t: AuthTestApp;
  let app: INestApplication;
  let admin: string;
  let customer: string;
  let other: string;
  let viewer: string;
  let p1: string; // 5000, 20% off -> 4000, stock 10
  let p2: string; // 2500, stock 3

  const http = () => request(app.getHttpServer());
  const stock = (id: string) => t.products.records.get(id)!.stock;
  const addToCart = (token: string, productId: string, quantity: number) =>
    http().post('/api/cart').set(bearer(token)).send({ productId, quantity });
  const place = (token: string | null, body: object = SHIP) => {
    const r = http().post('/api/order');
    return (token ? r.set(bearer(token)) : r).send(body);
  };
  const placeOrder = async (
    token = customer,
    lines: [string, number][] = [[p1, 2]],
  ): Promise<Order> => {
    for (const [id, q] of lines) await addToCart(token, id, q);
    const r = await place(token);
    expect(r.status).toBe(201);
    return r.body.data;
  };
  const pay = (token: string, id: string, body: object = {}) =>
    http().post(`/api/order/${id}/simulate-payment`).set(bearer(token)).send(body);
  const refund = (token: string, id: string, body: object = {}) =>
    http().post(`/api/order/${id}/refund`).set(bearer(token)).send(body);
  const setStatus = (token: string, id: string, status: unknown) =>
    http().patch(`/api/order/${id}/status`).set(bearer(token)).send({ status });
  const getOrder = (token: string, id: string) => http().get(`/api/order/${id}`).set(bearer(token));

  beforeEach(async () => {
    t = await createAuthApp([BrandController, CategoryController, ProductController]);
    app = t.app;
    admin = (await t.login(Role.ADMIN)).token;
    customer = (await t.login(Role.CUSTOMER)).token;
    other = (await t.login(Role.CUSTOMER)).token;
    viewer = (await t.login(Role.DEMO_VIEWER)).token;
    const categoryId = (
      await http().post('/api/category/create').set(bearer(admin)).send({ name: 'Cat' })
    ).body.data.id;
    const brandId = (
      await http().post('/api/brand/create').set(bearer(admin)).send({ name: 'Brand' })
    ).body.data.id;
    const mk = async (name: string, priceCents: number, discountPercent: number, stockN: number) =>
      (
        await http()
          .post('/api/product/create')
          .set(bearer(admin))
          .send({
            name,
            images: ['/catalogue/x.svg'],
            priceCents,
            discountPercent,
            stock: stockN,
            categoryId,
            brandId,
          })
      ).body.data.id as string;
    p1 = await mk('Product One', 5000, 20, 10);
    p2 = await mk('Product Two', 2500, 0, 3);
  });
  afterEach(() => app.close());

  describe('access control', () => {
    const id = 'a'.repeat(24);
    const routes = [
      ['post', '/api/order'],
      ['get', '/api/order'],
      ['get', `/api/order/${id}`],
      ['post', `/api/order/${id}/simulate-payment`],
      ['patch', `/api/order/${id}/status`],
      ['post', `/api/order/${id}/refund`],
    ] as const;
    it.each(routes)('%s %s requires a signed-in user', async (m, p) => {
      expect((await http()[m](p).send({})).status).toBe(401);
    });

    it('the demo viewer can read but every write is 403, and nothing changes', async () => {
      const order = await placeOrder();
      expect((await http().get('/api/order').set(bearer(viewer))).body.data).toEqual([]);
      expect((await place(viewer)).status).toBe(403);
      expect((await pay(viewer, order.id)).status).toBe(403);
      expect((await refund(viewer, order.id)).status).toBe(403);
      expect((await setStatus(viewer, order.id, 'SHIPPED')).status).toBe(403);
      expect((await getOrder(viewer, order.id)).status).toBe(404);
      expect(t.orders.records.get(order.id)!.status).toBe('PENDING_PAYMENT');
    });

    it('customers cannot use the admin routes', async () => {
      const order = await placeOrder();
      await pay(customer, order.id);
      expect((await refund(customer, order.id)).status).toBe(403);
      expect((await setStatus(customer, order.id, 'SHIPPED')).status).toBe(403);
      expect(t.orders.records.get(order.id)!.status).toBe('PAID');
    });

    it('other users get 404 for someone else’s order on every route', async () => {
      const order = await placeOrder();
      expect((await getOrder(other, order.id)).status).toBe(404);
      expect((await pay(other, order.id)).status).toBe(404);
      expect((await http().get('/api/order').set(bearer(other))).body.data).toEqual([]);
      expect(t.orders.records.get(order.id)!.status).toBe('PENDING_PAYMENT');
    });

    it('an admin can read any order but cannot pay for a customer', async () => {
      const order = await placeOrder();
      expect((await getOrder(admin, order.id)).status).toBe(200);
      expect((await pay(admin, order.id)).status).toBe(404);
    });

    it('a revoked token loses access immediately', async () => {
      const { id, token } = await t.login(Role.CUSTOMER);
      await t.repo.bumpTokenVersion(id);
      expect((await http().get('/api/order').set(bearer(token))).status).toBe(401);
    });
  });

  describe('placing an order', () => {
    it('turns the server-priced cart into a pending, simulated order and reserves stock', async () => {
      await http()
        .post('/api/coupon')
        .set(bearer(admin))
        .send({ code: 'SAVE10', discountPercent: 10, expiresAt: future() });
      await addToCart(customer, p1, 2); // 8000
      await addToCart(customer, p2, 1); // 2500
      await http().post('/api/cart/apply-coupon').set(bearer(customer)).send({ code: 'SAVE10' });
      const r = await place(customer);
      expect(r.status).toBe(201);
      const o: Order = r.body.data;
      expect(o).toMatchObject({
        status: 'PENDING_PAYMENT',
        paymentStatus: 'SIMULATED_UNPAID',
        subtotalCents: 10500,
        discountCents: 1050,
        totalCents: 9450,
        coupon: { code: 'SAVE10' },
        paidAt: null,
      });
      expect(o.items).toEqual([
        {
          productId: p1,
          name: 'Product One',
          unitPriceCents: 4000,
          quantity: 2,
          lineTotalCents: 8000,
        },
        {
          productId: p2,
          name: 'Product Two',
          unitPriceCents: 2500,
          quantity: 1,
          lineTotalCents: 2500,
        },
      ]);
      expect(o.payment).toEqual({
        mode: 'SIMULATED',
        notice: expect.stringMatching(/no payment was taken/i),
      });
      expect(new Date(o.expiresAt).getTime() - Date.now()).toBeGreaterThan(ORDER_TTL_MS - 5000);
      expect([stock(p1), stock(p2)]).toEqual([8, 2]);
      const cart = (await http().get('/api/cart').set(bearer(customer))).body.data;
      expect(cart).toMatchObject({ items: [], coupon: null, totalCents: 0 });
    });

    it('keeps the order’s prices when the catalogue changes later', async () => {
      const o = await placeOrder();
      await http()
        .patch(`/api/product/${p1}`)
        .set(bearer(admin))
        .send({ priceCents: 99999, name: 'Renamed' });
      const again = (await getOrder(customer, o.id)).body.data as Order;
      expect(again.items[0]).toMatchObject({
        name: 'Product One',
        unitPriceCents: 4000,
        lineTotalCents: 8000,
      });
      expect(again.totalCents).toBe(8000);
    });

    it('flags demo customers’ orders as synthetic', async () => {
      const demo = (await t.login(Role.CUSTOMER, true)).token;
      const o = await placeOrder(demo);
      expect(t.orders.records.get(o.id)!.isDemo).toBe(true);
      expect(t.orders.records.get((await placeOrder(customer)).id)!.isDemo).toBe(false);
    });

    it('refuses an empty cart', async () => {
      const r = await place(customer);
      expect(r.status).toBe(400);
      expect(r.body.error.message).toMatch(/empty/i);
      expect(t.orders.records.size).toBe(0);
    });

    it('refuses a cart with unavailable or short-stock lines and reserves nothing', async () => {
      await addToCart(customer, p2, 3);
      await http().patch(`/api/product/${p2}`).set(bearer(admin)).send({ stock: 1 });
      const r = await place(customer);
      expect(r.status).toBe(409);
      expect(stock(p2)).toBe(1);
      expect(t.orders.records.size).toBe(0);
    });

    it('does not oversell: stock taken by someone else after the cart was priced', async () => {
      await addToCart(customer, p2, 3);
      t.products.records.set(p2, { ...t.products.records.get(p2)!, stock: 3 });
      // another buyer takes two units between pricing and reservation
      const real = t.products.reserveStock.bind(t.products);
      t.products.reserveStock = async (id, q) => {
        await real(id, 2);
        return real(id, q);
      };
      const r = await place(customer);
      expect(r.status).toBe(409);
      expect(r.body.error.message).toMatch(/Not enough stock/);
      expect(t.orders.records.size).toBe(0);
      expect(stock(p2)).toBe(1); // only the other buyer's two units are gone
    });

    it('rolls back earlier reservations when a later line cannot be reserved', async () => {
      await addToCart(customer, p1, 2);
      await addToCart(customer, p2, 1);
      t.products.reserveBudget = 1; // first line succeeds, second is refused
      const r = await place(customer);
      expect(r.status).toBe(409);
      expect([stock(p1), stock(p2)]).toEqual([10, 3]);
      expect(t.orders.records.size).toBe(0);
      expect((await http().get('/api/cart').set(bearer(customer))).body.data.itemCount).toBe(3);
    });

    it('gives stock back and keeps the cart if the order cannot be saved', async () => {
      await addToCart(customer, p1, 2);
      t.orders.create = async () => {
        throw new Error('db write failed: secret-host');
      };
      const r = await place(customer);
      expect(r.status).toBe(500);
      expect(JSON.stringify(r.body)).not.toContain('secret-host');
      expect(stock(p1)).toBe(10);
      expect((await http().get('/api/cart').set(bearer(customer))).body.data.itemCount).toBe(2);
    });

    it('still succeeds if only clearing the cart fails afterwards', async () => {
      await addToCart(customer, p1, 1);
      let calls = 0;
      t.carts.save = async () => {
        calls += 1;
        throw new ServiceUnavailableException('cart down');
      };
      const r = await place(customer);
      expect(calls).toBeGreaterThan(0);
      expect(r.status).toBe(201);
      expect(stock(p1)).toBe(9);
    });

    it('limits unpaid orders per user', async () => {
      for (let i = 0; i < 3; i++) await placeOrder(customer, [[p1, 1]]);
      await addToCart(customer, p1, 1);
      const r = await place(customer);
      expect(r.status).toBe(409);
      expect(r.body.error.message).toMatch(/3 unpaid orders/);
      expect(stock(p1)).toBe(7);
    });

    it('a double submit creates exactly one order', async () => {
      await addToCart(customer, p1, 2);
      const results = await Promise.all([place(customer), place(customer)]);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(t.orders.records.size).toBe(1);
      expect(stock(p1)).toBe(8);
    });

    it.each([
      ['no body', {}],
      ['short address', { ...SHIP, address: 'x' }],
      ['bad phone', { ...SHIP, phone: 'call me' }],
      ['too-long phone', { ...SHIP, phone: '1'.repeat(20) }],
      ['a card number in the address', { ...SHIP, address: 'Card 4242 4242 4242 4242 Cairo' }],
      ['cardNumber', { ...SHIP, cardNumber: '4242424242424242' }],
      ['cvv', { ...SHIP, cvv: '123' }],
      ['expiry', { ...SHIP, expiry: '12/30' }],
      ['paymentMethod', { ...SHIP, paymentMethod: 'card' }],
      ['card object', { ...SHIP, card: { number: '4242424242424242' } }],
      ['a client total', { ...SHIP, totalCents: 1 }],
      ['a user id', { ...SHIP, userId: 'a'.repeat(24) }],
      ['a cart id', { ...SHIP, cartId: 'a'.repeat(24) }],
    ])('rejects %s with 400 and echoes nothing', async (_l, body) => {
      await addToCart(customer, p1, 1);
      const r = await place(customer, body);
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).not.toMatch(/4242/);
      expect(t.orders.records.size).toBe(0);
      expect(stock(p1)).toBe(10);
    });

    it('accepts ordinary digits in an address (house and flat numbers)', async () => {
      await addToCart(customer, p1, 1);
      expect(
        (await place(customer, { ...SHIP, address: 'Flat 12, Building 1234, Street 5678, Cairo' }))
          .status,
      ).toBe(201);
    });
  });

  describe('simulated payment', () => {
    it('marks the order paid (simulated) once, with no real payment anywhere', async () => {
      const o = await placeOrder();
      const r = await pay(customer, o.id);
      expect(r.status).toBe(200);
      expect(r.body.data).toMatchObject({ status: 'PAID', paymentStatus: 'SIMULATED_PAID' });
      expect(r.body.data.paidAt).toEqual(expect.any(String));
      expect(r.body.data.payment.notice).toMatch(/no payment was taken/i);
      expect(stock(p1)).toBe(8); // reserved at placement, not decremented again
    });

    it('a repeated payment call is refused and changes nothing', async () => {
      const o = await placeOrder();
      await pay(customer, o.id);
      const paidAt = t.orders.records.get(o.id)!.paidAt;
      const again = await pay(customer, o.id);
      expect(again.status).toBe(409);
      expect(again.body.error.message).toMatch(/already been paid/);
      expect(t.orders.records.get(o.id)!.paidAt).toBe(paidAt);
      expect(stock(p1)).toBe(8);
    });

    it('simultaneous payments: exactly one wins', async () => {
      const o = await placeOrder();
      const results = await Promise.all([
        pay(customer, o.id),
        pay(customer, o.id),
        pay(customer, o.id),
      ]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    });

    it.each([
      { cardNumber: '4242424242424242' },
      { cvv: '123' },
      { token: 'tok_visa' },
      { amount: 1 },
      { paymentMethod: 'card' },
    ])('rejects a payment body containing %j', async (body) => {
      const o = await placeOrder();
      const r = await pay(customer, o.id, body);
      expect(r.status).toBe(400);
      expect(t.orders.records.get(o.id)!.status).toBe('PENDING_PAYMENT');
    });

    it('cannot pay an expired order: it expires and its stock returns', async () => {
      const o = await placeOrder();
      t.ordersService.now = () => Date.now() + ORDER_TTL_MS + 1000;
      const r = await pay(customer, o.id);
      expect(r.status).toBe(409);
      expect(r.body.error.message).toMatch(/expired/);
      expect(t.orders.records.get(o.id)).toMatchObject({
        status: 'EXPIRED',
        paymentStatus: 'SIMULATED_UNPAID',
      });
      expect(stock(p1)).toBe(10);
    });

    it('cannot pay a cancelled order', async () => {
      const o = await placeOrder();
      await setStatus(admin, o.id, 'CANCELLED');
      const r = await pay(customer, o.id);
      expect(r.status).toBe(409);
      expect(r.body.error.message).toMatch(/cancelled/);
    });

    it('unknown and malformed ids', async () => {
      expect((await pay(customer, 'b'.repeat(24))).status).toBe(404);
      expect((await pay(customer, 'nope')).status).toBe(400);
    });
  });

  describe('expiry', () => {
    it('restores stock on the next read of an overdue order', async () => {
      const o = await placeOrder();
      expect(stock(p1)).toBe(8);
      t.ordersService.now = () => Date.now() + ORDER_TTL_MS + 1000;
      const r = await getOrder(customer, o.id);
      expect(r.body.data.status).toBe('EXPIRED');
      expect(stock(p1)).toBe(10);
    });

    it('the sweep expires abandoned orders without anyone reading them, exactly once', async () => {
      await placeOrder(customer, [[p1, 2]]);
      await placeOrder(other, [[p1, 3]]);
      expect(stock(p1)).toBe(5);
      t.ordersService.now = () => Date.now() + ORDER_TTL_MS + 1000;
      expect(await t.ordersService.expireOverdue()).toBe(2);
      expect(stock(p1)).toBe(10);
      expect(await t.ordersService.expireOverdue()).toBe(0);
      expect(stock(p1)).toBe(10); // never restored twice
    });

    it('a sweep and a read racing do not double-restore', async () => {
      const o = await placeOrder();
      t.ordersService.now = () => Date.now() + ORDER_TTL_MS + 1000;
      await Promise.all([
        t.ordersService.expireOverdue(),
        getOrder(customer, o.id),
        http().get('/api/order').set(bearer(customer)),
      ]);
      expect(stock(p1)).toBe(10);
    });

    it('does not touch paid orders', async () => {
      const o = await placeOrder();
      await pay(customer, o.id);
      t.ordersService.now = () => Date.now() + ORDER_TTL_MS * 10;
      expect(await t.ordersService.expireOverdue()).toBe(0);
      expect(t.orders.records.get(o.id)!.status).toBe('PAID');
      expect(stock(p1)).toBe(8);
    });

    it('expired orders free the pending-order slots', async () => {
      for (let i = 0; i < 3; i++) await placeOrder(customer, [[p1, 1]]);
      t.ordersService.now = () => Date.now() + ORDER_TTL_MS + 1000;
      await addToCart(customer, p1, 1);
      expect((await place(customer)).status).toBe(201);
    });

    it('the background sweeper runs on a timer, only with a database and outside tests, and stops cleanly', () => {
      jest.useFakeTimers();
      try {
        const calls: number[] = [];
        const service = { expireOverdue: async () => void calls.push(1) } as never;
        const run = (env: object) => {
          const s = new OrderExpirySweeper(service, loadEnv({ ...env }));
          s.onModuleInit();
          return s;
        };
        const test = run({
          NODE_ENV: 'test',
          MONGODB_URI: 'mongodb://127.0.0.1/x',
          JWT_SECRET: 't'.repeat(48),
        });
        const noDb = run({ NODE_ENV: 'development' });
        jest.advanceTimersByTime(130_000);
        expect(calls).toHaveLength(0);
        test.onModuleDestroy();
        noDb.onModuleDestroy();
        const live = run({
          NODE_ENV: 'development',
          MONGODB_URI: 'mongodb://127.0.0.1/x',
          JWT_SECRET: 't'.repeat(48),
        });
        jest.advanceTimersByTime(130_000);
        expect(calls).toHaveLength(2);
        live.onModuleDestroy();
        jest.advanceTimersByTime(130_000);
        expect(calls).toHaveLength(2);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('admin status changes', () => {
    it('walks PAID -> SHIPPED -> DELIVERED', async () => {
      const o = await placeOrder();
      await pay(customer, o.id);
      expect((await setStatus(admin, o.id, 'SHIPPED')).body.data.status).toBe('SHIPPED');
      expect((await setStatus(admin, o.id, 'DELIVERED')).body.data.status).toBe('DELIVERED');
      expect(stock(p1)).toBe(8);
    });

    it.each([
      ['unpaid -> shipped', 'PENDING_PAYMENT', 'SHIPPED'],
      ['unpaid -> delivered', 'PENDING_PAYMENT', 'DELIVERED'],
      ['paid -> delivered (skipping a step)', 'PAID', 'DELIVERED'],
      ['paid -> cancelled (use refund)', 'PAID', 'CANCELLED'],
      ['shipped -> shipped', 'SHIPPED', 'SHIPPED'],
      ['shipped -> cancelled', 'SHIPPED', 'CANCELLED'],
      ['delivered -> shipped (backwards)', 'DELIVERED', 'SHIPPED'],
      ['cancelled -> shipped', 'CANCELLED', 'SHIPPED'],
      ['expired -> shipped', 'EXPIRED', 'SHIPPED'],
    ])('refuses %s', async (_l, from, to) => {
      const o = await placeOrder();
      t.orders.records.set(o.id, { ...t.orders.records.get(o.id)!, status: from as never });
      const r = await setStatus(admin, o.id, to);
      expect(r.status).toBe(409);
      expect(t.orders.records.get(o.id)!.status).toBe(from);
    });

    it('cancelling an unpaid order restores its stock, once', async () => {
      const o = await placeOrder();
      const r = await setStatus(admin, o.id, 'CANCELLED');
      expect(r.body.data).toMatchObject({ status: 'CANCELLED', paymentStatus: 'SIMULATED_UNPAID' });
      expect(stock(p1)).toBe(10);
      expect((await setStatus(admin, o.id, 'CANCELLED')).status).toBe(409);
      expect(stock(p1)).toBe(10);
    });

    it.each(['PAID', 'PENDING_PAYMENT', 'EXPIRED', 'REFUNDED', 'bogus', '', null, 5, ['SHIPPED']])(
      'rejects the status value %j',
      async (value) => {
        const o = await placeOrder();
        expect((await setStatus(admin, o.id, value)).status).toBe(400);
      },
    );
    it('rejects extra fields and unknown or malformed ids', async () => {
      const o = await placeOrder();
      const r = await http()
        .patch(`/api/order/${o.id}/status`)
        .set(bearer(admin))
        .send({ status: 'CANCELLED', paymentStatus: 'SIMULATED_PAID' });
      expect(r.status).toBe(400);
      expect((await setStatus(admin, 'c'.repeat(24), 'SHIPPED')).status).toBe(404);
      expect((await setStatus(admin, 'nope', 'SHIPPED')).status).toBe(400);
    });
  });

  describe('simulated refunds', () => {
    it('refunds a paid order, restores its stock and says nothing real moved', async () => {
      const o = await placeOrder();
      await pay(customer, o.id);
      const r = await refund(admin, o.id);
      expect(r.status).toBe(200);
      expect(r.body.data).toMatchObject({
        status: 'CANCELLED',
        paymentStatus: 'SIMULATED_REFUNDED',
      });
      expect(r.body.data.refundedAt).toEqual(expect.any(String));
      expect(r.body.data.payment.notice).toMatch(/no payment was taken/i);
      expect(stock(p1)).toBe(10);
    });

    it('a second refund is refused and does not restore stock again', async () => {
      const o = await placeOrder();
      await pay(customer, o.id);
      await refund(admin, o.id);
      const again = await refund(admin, o.id);
      expect(again.status).toBe(409);
      expect(again.body.error.message).toMatch(/already refunded/);
      expect(stock(p1)).toBe(10);
    });

    it('simultaneous refunds: exactly one wins and stock is restored once', async () => {
      const o = await placeOrder();
      await pay(customer, o.id);
      const results = await Promise.all([refund(admin, o.id), refund(admin, o.id)]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(stock(p1)).toBe(10);
    });

    it('refuses to refund unpaid, shipped, delivered, cancelled or expired orders', async () => {
      const unpaid = await placeOrder();
      const r1 = await refund(admin, unpaid.id);
      expect(r1.status).toBe(409);
      expect(r1.body.error.message).toMatch(/not been paid/);
      const shipped = await placeOrder();
      await pay(customer, shipped.id);
      await setStatus(admin, shipped.id, 'SHIPPED');
      expect((await refund(admin, shipped.id)).status).toBe(409);
      await setStatus(admin, shipped.id, 'DELIVERED');
      expect((await refund(admin, shipped.id)).status).toBe(409);
      await setStatus(admin, unpaid.id, 'CANCELLED');
      expect((await refund(admin, unpaid.id)).status).toBe(409);
    });

    it('rejects a refund body and unknown ids', async () => {
      const o = await placeOrder();
      await pay(customer, o.id);
      expect((await refund(admin, o.id, { amount: 1 })).status).toBe(400);
      expect((await refund(admin, o.id, { cardNumber: '4242424242424242' })).status).toBe(400);
      expect(t.orders.records.get(o.id)!.status).toBe('PAID');
      expect((await refund(admin, 'c'.repeat(24))).status).toBe(404);
      expect((await refund(admin, 'nope')).status).toBe(400);
    });
  });

  describe('order history', () => {
    it('lists only the caller’s orders, newest first', async () => {
      const a = await placeOrder(customer, [[p1, 1]]);
      const b = await placeOrder(customer, [[p1, 1]]);
      await placeOrder(other, [[p1, 1]]);
      const list = (await http().get('/api/order').set(bearer(customer))).body.data as Order[];
      expect(list.map((o) => o.id)).toEqual([b.id, a.id]);
    });
    it('shows overdue orders as expired in the list', async () => {
      await placeOrder();
      t.ordersService.now = () => Date.now() + ORDER_TTL_MS + 1000;
      const list = (await http().get('/api/order').set(bearer(customer))).body.data as Order[];
      expect(list[0]!.status).toBe('EXPIRED');
      expect(stock(p1)).toBe(10);
    });
    it('every response in every state carries the simulation notice', async () => {
      const o = await placeOrder();
      const bodies = [
        (await getOrder(customer, o.id)).body.data,
        (await pay(customer, o.id)).body.data,
        (await setStatus(admin, o.id, 'SHIPPED')).body.data,
        (await http().get('/api/order').set(bearer(customer))).body.data[0],
      ];
      for (const b of bodies)
        expect(b.payment).toEqual({
          mode: 'SIMULATED',
          notice: expect.stringMatching(/no payment was taken/i),
        });
    });
  });

  describe('robustness', () => {
    it('storage failures are generic and leak nothing', async () => {
      t.orders.failWith = new Error('mongodb://user:secret@host/db exploded');
      const r = await http().get('/api/order').set(bearer(customer));
      expect(r.status).toBe(500);
      expect(JSON.stringify(r.body)).not.toMatch(/secret|mongodb/);
    });
    it('a failed transition after stock restore errors does not 500 the expiry read', async () => {
      const o = await placeOrder();
      t.products.restoreStock = async () => {
        throw new Error('db down');
      };
      t.ordersService.now = () => Date.now() + ORDER_TTL_MS + 1000;
      expect((await getOrder(customer, o.id)).status).toBe(200);
    });
  });

  describe('state machine and card detection', () => {
    it('every payment state is marked SIMULATED', () => {
      expect(PAYMENT_STATUSES.every((s) => s.startsWith('SIMULATED_'))).toBe(true);
    });
    it('admins can only move forward along the allowed edges', () => {
      const allowed = ORDER_STATUSES.flatMap((from) =>
        ORDER_STATUSES.filter((to) => canAdminTransition(from, to)).map((to) => `${from}>${to}`),
      );
      expect(allowed.sort()).toEqual([
        'PAID>SHIPPED',
        'PENDING_PAYMENT>CANCELLED',
        'SHIPPED>DELIVERED',
      ]);
      expect([...ADMIN_STATUS_TARGETS].sort()).toEqual(['CANCELLED', 'DELIVERED', 'SHIPPED']);
    });
    it('recognises card numbers by length and checksum only', () => {
      expect(passesLuhn('4242424242424242')).toBe(true);
      expect(passesLuhn('4242424242424241')).toBe(false);
      expect(containsCardNumber('pay 4242-4242-4242-4242 now')).toBe(true);
      expect(containsCardNumber('5555 5555 5555 4444')).toBe(true);
      expect(containsCardNumber('Flat 12, Building 1234')).toBe(false);
      expect(containsCardNumber('1234567890123456')).toBe(false);
    });
  });
});
