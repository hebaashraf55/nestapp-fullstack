import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { computeAnalytics } from '../src/admin/analytics';
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
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

describe('inventory history, fulfilment, promotions, analytics', () => {
  let t: AuthTestApp;
  let app: INestApplication;
  let admin: string;
  let alice: string;
  let bob: string;
  let viewer: string;
  let ceramics: string;
  let lighting: string;
  let vase: string;
  let lamp: string;

  const http = () => request(app.getHttpServer());
  const stock = (id: string) => t.products.records.get(id)!.stock;
  const addToCart = (token: string, productId: string, quantity = 1) =>
    http().post('/api/cart').set(bearer(token)).send({ productId, quantity }).expect(201);
  const placeOrder = (token: string) => http().post('/api/order').set(bearer(token)).send(SHIP);
  const coupon = (body: object) =>
    http()
      .post('/api/coupon')
      .set(bearer(admin))
      .send({ expiresAt: inDays(10), ...body });
  const apply = (token: string, code: string) =>
    http().post('/api/cart/apply-coupon').set(bearer(token)).send({ code });
  const cart = async (token: string) =>
    (await http().get('/api/cart').set(bearer(token))).body.data;
  const movements = async (query = '') =>
    (await http().get(`/api/admin/inventory/movements${query}`).set(bearer(admin)).expect(200)).body
      .data;

  beforeEach(async () => {
    t = await createAuthApp([BrandController, CategoryController, ProductController]);
    app = t.app;
    admin = (await t.login(Role.ADMIN)).token;
    alice = (await t.login(Role.CUSTOMER)).token;
    bob = (await t.login(Role.CUSTOMER)).token;
    viewer = (await t.login(Role.DEMO_VIEWER)).token;
    const cat = async (name: string) =>
      (await http().post('/api/category/create').set(bearer(admin)).send({ name })).body.data
        .id as string;
    ceramics = await cat('Ceramics');
    lighting = await cat('Lighting');
    const brandId = (
      await http().post('/api/brand/create').set(bearer(admin)).send({ name: 'Wadi Works' })
    ).body.data.id;
    const mk = async (name: string, categoryId: string, priceCents: number) =>
      (
        await http()
          .post('/api/product/create')
          .set(bearer(admin))
          .send({ name, images: ['/catalogue/x.jpg'], priceCents, stock: 10, categoryId, brandId })
      ).body.data.id as string;
    vase = await mk('Dune Vase', ceramics, 4000);
    lamp = await mk('Arc Lamp', lighting, 10000);
  });
  afterEach(() => app.close());

  describe('inventory history', () => {
    it('records opening stock, admin changes with a reason, reservations, releases and return restocks', async () => {
      await http()
        .patch(`/api/product/${vase}/stock`)
        .set(bearer(admin))
        .send({ change: 5, reason: 'RECEIVED', note: 'Delivery from the studio' })
        .expect(200);
      await http()
        .patch(`/api/product/${vase}/stock`)
        .set(bearer(admin))
        .send({ change: -1, reason: 'DAMAGED' })
        .expect(200);
      await addToCart(alice, vase, 2);
      const o = (await placeOrder(alice).expect(201)).body.data;
      await http().post(`/api/order/${o.id}/cancel`).set(bearer(alice)).send({}).expect(200);
      const list = await movements(`?productId=${vase}`);
      expect(
        list.items.map((m: { reason: string; change: number }) => [m.reason, m.change]),
      ).toEqual([
        ['ORDER_RELEASED', 2],
        ['ORDER_RESERVED', -2],
        ['DAMAGED', -1],
        ['RECEIVED', 5],
        ['INITIAL', 10],
      ]);
      expect(list.items[3]).toMatchObject({
        note: 'Delivery from the studio',
        productName: 'Dune Vase',
      });
      expect(list.items[1]).toMatchObject({ orderId: o.id, actorId: null });
      expect(stock(vase)).toBe(14);
      expect((await movements('?reason=DAMAGED')).total).toBe(1);
    });

    it('validates input and is read-only staff data', async () => {
      expect(
        (
          await http()
            .patch(`/api/product/${vase}/stock`)
            .set(bearer(admin))
            .send({ change: 1, reason: 'ORDER_RESERVED' })
        ).status,
      ).toBe(400);
      expect(
        (await http().get('/api/admin/inventory/movements?reason=NOPE').set(bearer(admin))).status,
      ).toBe(400);
      expect((await http().get('/api/admin/inventory/movements').set(bearer(alice))).status).toBe(
        403,
      );
      expect(
        (await http().get('/api/admin/inventory/movements').set(bearer(viewer)).expect(200)).body
          .data.items,
      ).toEqual([]);
    });

    it('never undoes or fails a correct stock change when the history cannot be saved', async () => {
      t.inventory.failWith = new Error('history store down');
      await http()
        .patch(`/api/product/${vase}/stock`)
        .set(bearer(admin))
        .send({ change: 3, reason: 'RECEIVED' })
        .expect(200);
      expect(stock(vase)).toBe(13);
    });
  });

  describe('fulfilment', () => {
    const paidOrder = async () => {
      await addToCart(alice, vase);
      const o = (await placeOrder(alice).expect(201)).body.data;
      await http()
        .post(`/api/order/${o.id}/simulate-payment`)
        .set(bearer(alice))
        .send({})
        .expect(200);
      return o.id as string;
    };

    it('ships with a simulated carrier and tracking number, shown to the customer and on the timeline', async () => {
      const id = await paidOrder();
      const r = await http()
        .patch(`/api/order/${id}/status`)
        .set(bearer(admin))
        .send({ status: 'SHIPPED', carrier: 'DEMO_EXPRESS', trackingNumber: 'dx-12345678' })
        .expect(200);
      expect(r.body.data.shipment).toMatchObject({
        carrier: 'DEMO_EXPRESS',
        trackingNumber: 'DX-12345678',
        simulated: true,
      });
      const mine = (await http().get(`/api/order/${id}`).set(bearer(alice))).body.data;
      expect(mine.timeline.at(-1)).toMatchObject({
        type: 'SHIPPED',
        note: 'Demo Express DX-12345678 (simulated carrier)',
      });
      const note = [...t.notifications.records.values()].find(
        (n) => n.title === 'Your order is on its way',
      );
      expect(note?.body).toContain('DX-12345678');
    });

    it('generates a tracking number when none is given, and refuses shipping details on other steps', async () => {
      const id = await paidOrder();
      expect(
        (
          await http()
            .patch(`/api/order/${id}/status`)
            .set(bearer(admin))
            .send({ status: 'SHIPPED', trackingNumber: 'x' })
        ).status,
      ).toBe(400);
      expect(
        (
          await http()
            .patch(`/api/order/${id}/status`)
            .set(bearer(admin))
            .send({ status: 'SHIPPED', carrier: 'FEDEX' })
        ).status,
      ).toBe(400);
      const r = await http()
        .patch(`/api/order/${id}/status`)
        .set(bearer(admin))
        .send({ status: 'SHIPPED' })
        .expect(200);
      expect(r.body.data.shipment).toMatchObject({
        carrier: 'DEMO_POST',
        trackingNumber: expect.stringMatching(/^SIM-[0-9A-F]{10}$/),
      });
      expect(
        (
          await http()
            .patch(`/api/order/${id}/status`)
            .set(bearer(admin))
            .send({ status: 'DELIVERED', carrier: 'DEMO_POST' })
        ).status,
      ).toBe(400);
    });
  });

  describe('promotions', () => {
    it('takes a fixed amount off, never more than the eligible subtotal', async () => {
      await coupon({ code: 'TENOFF', type: 'FIXED', amountOffCents: 1000 }).expect(201);
      await coupon({ code: 'HUGE', type: 'FIXED', amountOffCents: 9_000_000 }).expect(201);
      await addToCart(alice, vase);
      expect((await apply(alice, 'TENOFF').expect(200)).body.data).toMatchObject({
        discountCents: 1000,
        totalCents: 3000,
        coupon: { code: 'TENOFF', type: 'FIXED', amountOffCents: 1000, discountPercent: 0 },
      });
      expect((await apply(alice, 'HUGE').expect(200)).body.data).toMatchObject({
        discountCents: 4000,
        totalCents: 0,
      });
    });

    it('waits for the minimum spend and explains what is missing', async () => {
      await coupon({ code: 'SPEND100', discountPercent: 10, minSubtotalCents: 10000 }).expect(201);
      await addToCart(alice, vase);
      const r = (await apply(alice, 'SPEND100').expect(200)).body.data;
      expect(r).toMatchObject({ coupon: null, discountCents: 0 });
      expect(r.warnings.join(' ')).toMatch(/needs a subtotal of \$100\.00 \(\$60\.00 more\)/);
      await addToCart(alice, lamp);
      expect(await cart(alice)).toMatchObject({
        discountCents: 1400,
        coupon: { code: 'SPEND100' },
      });
    });

    it('applies only to products or categories in scope', async () => {
      await coupon({
        code: 'LAMPS',
        discountPercent: 50,
        scope: 'CATEGORIES',
        categoryIds: [lighting],
      }).expect(201);
      await coupon({
        code: 'VASE',
        discountPercent: 50,
        scope: 'PRODUCTS',
        productIds: [vase],
      }).expect(201);
      await addToCart(alice, vase);
      await addToCart(alice, lamp);
      expect((await apply(alice, 'LAMPS').expect(200)).body.data.discountCents).toBe(5000);
      expect((await apply(alice, 'VASE').expect(200)).body.data.discountCents).toBe(2000);
      await http().delete(`/api/cart/${vase}`).set(bearer(alice)).expect(200);
      const r = await cart(alice);
      expect(r.coupon).toBeNull();
      expect(r.warnings.join(' ')).toMatch(/does not apply to anything in your cart/);
    });

    it('refuses codes that have not started, and automatic promotions as codes', async () => {
      await coupon({ code: 'LATER', discountPercent: 10, startsAt: inDays(2) }).expect(201);
      await coupon({ code: 'AUTO5', discountPercent: 5, automatic: true }).expect(201);
      await addToCart(alice, vase);
      expect((await apply(alice, 'LATER')).status).toBe(400);
      expect((await apply(alice, 'AUTO5')).status).toBe(400);
    });

    it('applies the best automatic promotion without a code, for guests too, and keeps the better of code and automatic', async () => {
      await coupon({ code: 'AUTO5', discountPercent: 5, automatic: true }).expect(201);
      await coupon({ code: 'TWENTY', discountPercent: 20 }).expect(201);
      await coupon({ code: 'TWO', discountPercent: 2 }).expect(201);
      await addToCart(alice, vase);
      expect(await cart(alice)).toMatchObject({
        discountCents: 200,
        coupon: { code: 'AUTO5', automatic: true },
      });
      const guest = await http()
        .post('/api/cart/quote')
        .send({ items: [{ productId: vase, quantity: 1 }] })
        .expect(200);
      expect(guest.body.data).toMatchObject({ discountCents: 200, coupon: { code: 'AUTO5' } });
      expect((await apply(alice, 'TWENTY').expect(200)).body.data).toMatchObject({
        discountCents: 800,
        coupon: { code: 'TWENTY' },
      });
      const weaker = (await apply(alice, 'TWO').expect(200)).body.data;
      expect(weaker).toMatchObject({ discountCents: 200, coupon: { code: 'AUTO5' } });
      expect(weaker.warnings.join(' ')).toMatch(/saves you more/);
      const order = (await placeOrder(alice).expect(201)).body.data;
      expect(order).toMatchObject({
        coupon: { code: 'AUTO5', discountPercent: 5 },
        discountCents: 200,
        totalCents: 3800,
      });
    });

    it('limits total uses and uses per customer, and gives a use back when an order is cancelled', async () => {
      const c = (
        await coupon({
          code: 'ONCE',
          discountPercent: 10,
          maxUses: 2,
          maxUsesPerCustomer: 1,
        }).expect(201)
      ).body.data;
      await addToCart(alice, vase);
      await apply(alice, 'ONCE').expect(200);
      const first = (await placeOrder(alice).expect(201)).body.data;
      await addToCart(alice, vase);
      expect((await apply(alice, 'ONCE')).body.error.message).toMatch(/maximum number of times/);
      expect((await http().get(`/api/coupon/${c.id}`).set(bearer(admin))).body.data.usedCount).toBe(
        1,
      );
      await http().post(`/api/order/${first.id}/cancel`).set(bearer(alice)).send({}).expect(200);
      expect((await http().get(`/api/coupon/${c.id}`).set(bearer(admin))).body.data.usedCount).toBe(
        0,
      );
      await apply(alice, 'ONCE').expect(200); // the use came back
    });

    it('gives the last use to exactly one of two customers placing orders at the same moment', async () => {
      await coupon({ code: 'LAST', discountPercent: 10, maxUses: 1 }).expect(201);
      for (const token of [alice, bob]) {
        await addToCart(token, vase);
        await apply(token, 'LAST').expect(200);
      }
      const results = await Promise.all([placeOrder(alice), placeOrder(bob)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409)!.body.error.message).toMatch(
        /has been fully used|has just been used up/,
      );
      expect(stock(vase)).toBe(9); // the refused order released its stock
    });

    it('refuses to place an order whose chosen code no longer applies, until it is removed', async () => {
      await coupon({ code: 'SOON', discountPercent: 10 }).expect(201);
      await addToCart(alice, vase);
      await apply(alice, 'SOON').expect(200);
      const c = [...t.coupons.records.values()].find((x) => x.code === 'SOON')!;
      c.expiresAt = new Date(Date.now() - 1000);
      const refused = await placeOrder(alice);
      expect(refused.status).toBe(409);
      expect(refused.body.error.message).toMatch(/Coupon SOON .*Remove it/);
      const removed = await http().delete('/api/cart/coupon').set(bearer(alice)).expect(200);
      expect(removed.body.data).toMatchObject({
        coupon: null,
        rejectedCoupon: null,
        discountCents: 0,
      });
      await placeOrder(alice).expect(201);
    });

    it('validates promotion rules', async () => {
      const bad = async (body: object) => (await coupon({ code: 'BAD1', ...body })).status;
      expect(await bad({ type: 'FIXED' })).toBe(400);
      expect(await bad({ type: 'FIXED', amountOffCents: 100, discountPercent: 10 })).toBe(400);
      expect(await bad({ discountPercent: 10, scope: 'PRODUCTS' })).toBe(400);
      expect(
        await bad({ discountPercent: 10, scope: 'PRODUCTS', productIds: ['f'.repeat(24)] }),
      ).toBe(400);
      expect(await bad({ discountPercent: 10, maxUses: 1, maxUsesPerCustomer: 2 })).toBe(400);
      expect(await bad({ discountPercent: 10, startsAt: inDays(20) })).toBe(400);
      expect(await bad({ discountPercent: 10, usedCount: 5 })).toBe(400);
      const ok = (await coupon({ code: 'GOOD', discountPercent: 10 }).expect(201)).body.data;
      expect(ok).toMatchObject({
        discountType: 'PERCENT',
        usedCount: 0,
        scope: 'ALL',
        automatic: false,
        status: 'ACTIVE',
      });
      expect(
        (
          await http()
            .patch(`/api/coupon/${ok.id}`)
            .set(bearer(admin))
            .send({ amountOffCents: 100 })
        ).status,
      ).toBe(400);
    });
  });

  describe('analytics', () => {
    it('reports real figures only: placed, paid, refunded, top products, customers and coupons', async () => {
      await coupon({ code: 'TEN', discountPercent: 10 }).expect(201);
      const buy = async (
        token: string,
        productId: string,
        qty: number,
        pay: boolean,
        code?: string,
      ) => {
        await addToCart(token, productId, qty);
        if (code) await apply(token, code).expect(200);
        const o = (await placeOrder(token).expect(201)).body.data;
        if (pay)
          await http()
            .post(`/api/order/${o.id}/simulate-payment`)
            .set(bearer(token))
            .send({})
            .expect(200);
        return o.id as string;
      };
      await buy(alice, vase, 2, true, 'TEN'); // 8000 - 800
      await buy(alice, lamp, 1, true); // 10000
      const refunded = await buy(bob, vase, 1, true); // 4000, refunded below
      await buy(bob, lamp, 1, false); // unpaid
      await http().post(`/api/order/${refunded}/refund`).set(bearer(admin)).send({}).expect(200);

      const r = (await http().get('/api/admin/analytics?days=7').set(bearer(admin)).expect(200))
        .body.data;
      expect(r.totals).toMatchObject({
        ordersPlaced: 4,
        ordersPaid: 3,
        paidCents: 7200 + 10000 + 4000,
        refundedCents: 4000,
        netCents: 17200,
        averageOrderCents: Math.round(21200 / 3),
        paymentRate: 0.75,
        discountCents: 800,
      });
      expect(r.daily).toHaveLength(7);
      expect(r.daily.at(-1)).toMatchObject({ ordersPlaced: 4, ordersPaid: 3 });
      // The refunded order is not a sale.
      expect(r.topProducts.map((p: { name: string; units: number }) => [p.name, p.units])).toEqual([
        ['Dune Vase', 2],
        ['Arc Lamp', 1],
      ]);
      expect(r.customers).toEqual({ buyers: 2, returning: 1, guestOrders: 0 });
      expect(r.coupons).toEqual([{ code: 'TEN', orders: 1, discountCents: 800 }]);
      expect(r.truncated).toBe(false);
    });

    it('is staff-only, scoped for the demo viewer, and accepts 7, 30 or 90 days', async () => {
      expect((await http().get('/api/admin/analytics').set(bearer(alice))).status).toBe(403);
      expect((await http().get('/api/admin/analytics?days=365').set(bearer(admin))).status).toBe(
        400,
      );
      const demo = (
        await http().get('/api/admin/analytics?days=90').set(bearer(viewer)).expect(200)
      ).body.data;
      expect(demo).toMatchObject({
        scope: 'demo',
        days: 90,
        totals: { ordersPlaced: 0, averageOrderCents: null, paymentRate: null },
      });
      expect(demo.daily).toHaveLength(90);
    });
  });
});

describe('computeAnalytics', () => {
  it('puts each figure on the day it happened (UTC) and ignores activity outside the period', () => {
    const now = Date.UTC(2026, 5, 10, 12);
    const base = {
      id: 'o1',
      userId: 'u1',
      isDemo: false,
      items: [{ productId: 'p', name: 'P', unitPriceCents: 100, quantity: 1, lineTotalCents: 100 }],
      subtotalCents: 100,
      bundleSavingsCents: 0,
      couponId: null,
      couponCode: null,
      couponPercent: null,
      discountCents: 0,
      totalCents: 100,
      currency: 'USD',
      address: 'a',
      phone: 'p',
      status: 'PAID' as const,
      paymentStatus: 'SIMULATED_PAID' as const,
      expiresAt: new Date(now),
      paidAt: new Date(Date.UTC(2026, 5, 9, 23, 59)),
      refundedAt: null,
      cancelledAt: null,
      createdAt: new Date(Date.UTC(2026, 5, 9, 23, 0)),
      events: [],
      returnRequest: null,
      shipment: null,
      guestEmail: null,
      guestTokenHash: null,
    };
    const old = {
      ...base,
      id: 'o2',
      createdAt: new Date(Date.UTC(2026, 4, 1)),
      paidAt: new Date(Date.UTC(2026, 4, 1)),
    };
    const r = computeAnalytics([base, old], 7, now, false);
    expect(r.from).toBe('2026-06-04');
    expect(r.to).toBe('2026-06-10');
    expect(r.daily.find((d) => d.date === '2026-06-09')).toMatchObject({
      ordersPlaced: 1,
      ordersPaid: 1,
      paidCents: 100,
    });
    expect(r.totals.ordersPaid).toBe(1);
  });
});
