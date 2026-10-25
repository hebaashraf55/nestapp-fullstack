import { INestApplication, ServiceUnavailableException } from '@nestjs/common';
import request from 'supertest';
import {
  BrandController,
  CategoryController,
  ProductController,
} from '../src/catalogue/catalogue.controllers';
import { Role } from '../src/users/role';
import { AuthTestApp, createAuthApp } from './helpers/create-auth-app';

jest.setTimeout(30_000);

interface Line {
  productId: string;
  name: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  availableStock: number;
  status: string;
}
interface Cart {
  items: Line[];
  itemCount: number;
  subtotalCents: number;
  coupon: { code: string; discountPercent: number } | null;
  discountCents: number;
  totalCents: number;
  hasIssues: boolean;
  warnings: string[];
}
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const future = (days = 30) => new Date(Date.now() + days * 86_400_000).toISOString();

describe('coupons and cart', () => {
  let t: AuthTestApp;
  let app: INestApplication;
  let admin: string;
  let customer: string;
  let other: string;
  let viewer: string;
  let customerId: string;
  let p1: string; // 5000 cents, 20% off -> 4000, stock 10
  let p2: string; // 2500 cents, no discount, stock 3
  let soldOut: string;

  const http = () => request(app.getHttpServer());
  const asUser = (r: request.Test, token: string | null) => (token ? r.set(bearer(token)) : r);
  const cart = async (token: string): Promise<Cart> =>
    (await http().get('/api/cart').set(bearer(token))).body.data;
  const add = (token: string | null, productId: string, quantity: unknown) =>
    asUser(http().post('/api/cart'), token).send({ productId, quantity });
  const newCoupon = async (code = 'SAVE10', discountPercent = 10, expiresAt = future()) =>
    http().post('/api/coupon').set(bearer(admin)).send({ code, discountPercent, expiresAt });

  beforeEach(async () => {
    t = await createAuthApp([BrandController, CategoryController, ProductController]);
    app = t.app;
    admin = (await t.login(Role.ADMIN)).token;
    const c = await t.login(Role.CUSTOMER);
    customer = c.token;
    customerId = c.id;
    other = (await t.login(Role.CUSTOMER)).token;
    viewer = (await t.login(Role.DEMO_VIEWER)).token;

    const categoryId = (
      await http().post('/api/category/create').set(bearer(admin)).send({ name: 'Cat' })
    ).body.data.id;
    const brandId = (
      await http().post('/api/brand/create').set(bearer(admin)).send({ name: 'Brand' })
    ).body.data.id;
    const mk = async (name: string, priceCents: number, discountPercent: number, stock: number) =>
      (
        await http()
          .post('/api/product/create')
          .set(bearer(admin))
          .send({
            name,
            images: ['/catalogue/x.svg'],
            priceCents,
            discountPercent,
            stock,
            categoryId,
            brandId,
          })
      ).body.data.id as string;
    p1 = await mk('Product One', 5000, 20, 10);
    p2 = await mk('Product Two', 2500, 0, 3);
    soldOut = await mk('Product Gone', 1000, 0, 0);
  });
  afterEach(() => app.close());

  describe('coupon administration', () => {
    const id = 'a'.repeat(24);
    const routes: ['post' | 'get' | 'patch' | 'delete', string][] = [
      ['post', '/api/coupon'],
      ['get', '/api/coupon'],
      ['get', `/api/coupon/${id}`],
      ['patch', `/api/coupon/${id}`],
      ['delete', `/api/coupon/${id}`],
    ];
    it.each(routes)('%s %s: anonymous 401, customer 403, demo viewer 403', async (m, p) => {
      for (const [token, status] of [
        [null, 401],
        [customer, 403],
        [viewer, 403],
      ] as const) {
        const r = asUser(http()[m](p), token);
        expect(
          (await r.send({ code: 'ABC', discountPercent: 5, expiresAt: future() })).status,
        ).toBe(status);
      }
    });

    it('creates, lists, reads, updates and deletes', async () => {
      const created = await newCoupon('welcome-5', 5);
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({
        code: 'WELCOME-5',
        discountPercent: 5,
        expired: false,
        isDemo: false,
      });
      const cid = created.body.data.id;
      expect((await http().get('/api/coupon').set(bearer(admin))).body.data).toHaveLength(1);
      expect((await http().get(`/api/coupon/${cid}`).set(bearer(admin))).body.data.code).toBe(
        'WELCOME-5',
      );
      const upd = await http()
        .patch(`/api/coupon/${cid}`)
        .set(bearer(admin))
        .send({ discountPercent: 15 });
      expect(upd.body.data.discountPercent).toBe(15);
      expect((await http().delete(`/api/coupon/${cid}`).set(bearer(admin))).body.data).toEqual({
        deleted: true,
      });
      expect((await http().get(`/api/coupon/${cid}`).set(bearer(admin))).status).toBe(404);
      expect((await http().delete(`/api/coupon/${cid}`).set(bearer(admin))).status).toBe(404);
    });
    it('rejects duplicate codes regardless of case', async () => {
      await newCoupon('DUP');
      expect((await newCoupon('dup')).status).toBe(409);
    });
    it.each([
      ['past expiry', { expiresAt: new Date(Date.now() - 1000).toISOString() }],
      ['expiry far in the future', { expiresAt: future(365 * 10) }],
      ['non-ISO expiry', { expiresAt: 'tomorrow' }],
      ['zero discount', { discountPercent: 0 }],
      ['discount over 90', { discountPercent: 91 }],
      ['fractional discount', { discountPercent: 10.5 }],
      ['string discount', { discountPercent: '10' }],
      ['short code', { code: 'AB' }],
      ['code with spaces', { code: 'A B C' }],
      ['code with symbols', { code: 'SAVE$$' }],
      ['unknown field', { isDemo: true }],
    ])('rejects %s', async (_l, over) => {
      const r = await http()
        .post('/api/coupon')
        .set(bearer(admin))
        .send({ code: 'GOOD', discountPercent: 10, expiresAt: future(), ...over });
      expect(r.status).toBe(400);
    });
    it('keeps the code immutable and requires a change on update', async () => {
      const cid = (await newCoupon()).body.data.id;
      expect(
        (await http().patch(`/api/coupon/${cid}`).set(bearer(admin)).send({ code: 'NEW' })).status,
      ).toBe(400);
      expect((await http().patch(`/api/coupon/${cid}`).set(bearer(admin)).send({})).status).toBe(
        400,
      );
    });
    it('400 for malformed ids, 404 for unknown ones', async () => {
      expect((await http().get('/api/coupon/nope').set(bearer(admin))).status).toBe(400);
      expect(
        (
          await http()
            .get(`/api/coupon/${'c'.repeat(24)}`)
            .set(bearer(admin))
        ).status,
      ).toBe(404);
      expect(
        (
          await http()
            .patch(`/api/coupon/${'c'.repeat(24)}`)
            .set(bearer(admin))
            .send({ discountPercent: 5 })
        ).status,
      ).toBe(404);
    });
    it('shows an expired coupon as expired', async () => {
      const cid = (await newCoupon()).body.data.id;
      t.coupons.records.get(cid)!.expiresAt = new Date(Date.now() - 1000);
      expect((await http().get(`/api/coupon/${cid}`).set(bearer(admin))).body.data.expired).toBe(
        true,
      );
    });
  });

  describe('cart access control', () => {
    const id = 'a'.repeat(24);
    it.each([
      ['get', '/api/cart'],
      ['post', '/api/cart'],
      ['post', '/api/cart/apply-coupon'],
      ['patch', `/api/cart/${id}`],
      ['delete', `/api/cart/${id}`],
    ] as const)('%s %s requires a signed-in user', async (m, p) => {
      expect((await http()[m](p).send({})).status).toBe(401);
      expect((await http()[m](p).set(bearer('garbage')).send({})).status).toBe(401);
    });

    it('the demo viewer can read (an empty cart) but every write is 403', async () => {
      const read = await http().get('/api/cart').set(bearer(viewer));
      expect(read.status).toBe(200);
      expect(read.body.data).toMatchObject({ items: [], subtotalCents: 0, totalCents: 0 });
      expect((await add(viewer, p1, 1)).status).toBe(403);
      expect(
        (await http().post('/api/cart/apply-coupon').set(bearer(viewer)).send({ code: 'X' }))
          .status,
      ).toBe(403);
      expect(
        (await http().patch(`/api/cart/${p1}`).set(bearer(viewer)).send({ quantity: 1 })).status,
      ).toBe(403);
      expect((await http().delete(`/api/cart/${p1}`).set(bearer(viewer))).status).toBe(403);
      expect(t.carts.records.size).toBe(0);
    });

    it('carts belong to their owner and cannot be reached with another account', async () => {
      await add(customer, p1, 2);
      expect((await cart(other)).items).toEqual([]);
      expect(
        (await http().patch(`/api/cart/${p1}`).set(bearer(other)).send({ quantity: 1 })).status,
      ).toBe(404);
      expect((await http().delete(`/api/cart/${p1}`).set(bearer(other))).status).toBe(404);
      expect((await cart(customer)).items[0]!.quantity).toBe(2);
    });
    it('ignores a client-supplied owner and rejects the field', async () => {
      const r = await http()
        .post('/api/cart')
        .set(bearer(other))
        .send({ productId: p1, quantity: 1, userId: customerId });
      expect(r.status).toBe(400);
      expect(t.carts.records.has(customerId)).toBe(false);
    });
    it('admins and demo customers can shop like any signed-in user', async () => {
      expect((await add(admin, p1, 1)).status).toBe(201);
      const demoCustomer = (await t.login(Role.CUSTOMER, true)).token;
      expect((await add(demoCustomer, p1, 1)).status).toBe(201);
    });
    it('a demoted or token-revoked account loses access immediately', async () => {
      const { id: uid, token } = await t.login(Role.CUSTOMER);
      await t.repo.bumpTokenVersion(uid);
      expect((await add(token, p1, 1)).status).toBe(401);
    });
  });

  describe('adding, updating and removing', () => {
    it('prices a line from the catalogue sale price on the server', async () => {
      const r = await add(customer, p1, 3);
      expect(r.status).toBe(201);
      expect(r.body.data).toMatchObject({
        itemCount: 3,
        subtotalCents: 12000,
        discountCents: 0,
        totalCents: 12000,
        currency: 'USD',
        hasIssues: false,
      });
      expect(r.body.data.items[0]).toMatchObject({
        productId: p1,
        name: 'Product One',
        unitPriceCents: 4000,
        lineTotalCents: 12000,
        availableStock: 10,
        status: 'ok',
      });
    });
    it('never stores or accepts prices from the client', async () => {
      for (const extra of [
        { price: 1 },
        { priceCents: 1 },
        { total: 1 },
        { unitPriceCents: 1 },
        { subtotalCents: 1 },
      ]) {
        const r = await http()
          .post('/api/cart')
          .set(bearer(customer))
          .send({ productId: p1, quantity: 1, ...extra });
        expect(r.status).toBe(400);
      }
      await add(customer, p1, 1);
      const stored = [...t.carts.records.values()][0]!;
      expect(Object.keys(stored.items[0]!).sort()).toEqual(['productId', 'quantity']);
    });
    it('merges repeated adds of the same product', async () => {
      await add(customer, p1, 2);
      const r = await add(customer, p1, 3);
      expect(r.body.data.items).toHaveLength(1);
      expect(r.body.data.items[0].quantity).toBe(5);
      expect(r.body.data.subtotalCents).toBe(20000);
    });
    it('accepts an upper-case product id and stores one canonical line', async () => {
      await add(customer, p1.toUpperCase(), 1);
      await add(customer, p1, 1);
      expect((await cart(customer)).items).toHaveLength(1);
    });
    it.each([0, -1, 1.5, 100, '2', null, undefined, NaN])('rejects quantity %p', async (q) => {
      expect((await add(customer, p1, q)).status).toBe(400);
    });
    it('rejects a bad product id and an unknown product', async () => {
      expect((await add(customer, 'nope', 1)).status).toBe(400);
      expect((await add(customer, '{"$ne":1}', 1)).status).toBe(400);
      expect((await add(customer, 'e'.repeat(24), 1)).status).toBe(404);
    });
    it('refuses a sold-out product and quantities above the stock', async () => {
      const gone = await add(customer, soldOut, 1);
      expect(gone.status).toBe(409);
      expect(gone.body.error.message).toMatch(/out of stock/i);
      const many = await add(customer, p2, 4);
      expect(many.status).toBe(409);
      expect(many.body.error.message).toBe('Only 3 available');
      expect(t.carts.records.size).toBe(0);
    });
    it('checks stock against what is already in the cart', async () => {
      await add(customer, p2, 2);
      expect((await add(customer, p2, 2)).status).toBe(409);
      expect((await cart(customer)).items[0]!.quantity).toBe(2);
    });
    it('caps the number of distinct lines', async () => {
      for (let i = 0; i < 50; i++) {
        const id = (i + 1).toString(16).padStart(24, '0');
        t.carts.records.set(customerId, {
          userId: customerId,
          items: [
            ...(t.carts.records.get(customerId)?.items ?? []),
            { productId: id, quantity: 1 },
          ],
          couponId: null,
          version: 1,
        });
      }
      const r = await add(customer, p1, 1);
      expect(r.status).toBe(400);
      expect(r.body.error.message).toMatch(/at most 50/);
    });

    it('updates a quantity and re-checks the stock', async () => {
      await add(customer, p2, 1);
      const ok = await http().patch(`/api/cart/${p2}`).set(bearer(customer)).send({ quantity: 3 });
      expect(ok.body.data.subtotalCents).toBe(7500);
      expect(
        (await http().patch(`/api/cart/${p2}`).set(bearer(customer)).send({ quantity: 4 })).status,
      ).toBe(409);
      expect((await cart(customer)).items[0]!.quantity).toBe(3);
    });
    it('quantity 0 removes the line; unknown lines are 404', async () => {
      await add(customer, p1, 1);
      const r = await http().patch(`/api/cart/${p1}`).set(bearer(customer)).send({ quantity: 0 });
      expect(r.body.data.items).toEqual([]);
      expect(
        (await http().patch(`/api/cart/${p1}`).set(bearer(customer)).send({ quantity: 0 })).status,
      ).toBe(404);
      expect(
        (await http().patch(`/api/cart/${p1}`).set(bearer(customer)).send({ quantity: 2 })).status,
      ).toBe(404);
    });
    it.each([
      { quantity: -1 },
      { quantity: 100 },
      { quantity: 1.5 },
      {},
      { quantity: 1, price: 1 },
    ])('rejects update body %j', async (body) => {
      await add(customer, p1, 1);
      expect((await http().patch(`/api/cart/${p1}`).set(bearer(customer)).send(body)).status).toBe(
        400,
      );
    });
    it('removes a line and 404s when it is absent', async () => {
      await add(customer, p1, 1);
      await add(customer, p2, 1);
      const r = await http().delete(`/api/cart/${p1}`).set(bearer(customer));
      expect(r.status).toBe(200);
      expect(r.body.data.items.map((i: Line) => i.productId)).toEqual([p2]);
      expect((await http().delete(`/api/cart/${p1}`).set(bearer(customer))).status).toBe(404);
      expect((await http().delete('/api/cart/not-an-id').set(bearer(customer))).status).toBe(400);
    });
    it('an empty or never-used cart reads as empty, not an error', async () => {
      expect((await cart(customer)).totalCents).toBe(0);
    });
  });

  describe('live recalculation', () => {
    it('follows an admin price or discount change on the next read', async () => {
      await add(customer, p1, 2);
      await http().patch(`/api/product/${p1}`).set(bearer(admin)).send({ discountPercent: 50 });
      const c = await cart(customer);
      expect(c.items[0]).toMatchObject({ unitPriceCents: 2500, lineTotalCents: 5000 });
      expect(c.subtotalCents).toBe(5000);
    });
    it('flags a line when the stock falls below the quantity or hits zero', async () => {
      await add(customer, p2, 3);
      await http().patch(`/api/product/${p2}`).set(bearer(admin)).send({ stock: 1 });
      let c = await cart(customer);
      expect(c.items[0]).toMatchObject({ status: 'insufficient-stock', availableStock: 1 });
      expect(c.hasIssues).toBe(true);
      expect(c.warnings.join(' ')).toMatch(/unavailable|stock/);
      await http().patch(`/api/product/${p2}`).set(bearer(admin)).send({ stock: 0 });
      c = await cart(customer);
      expect(c.items[0]!.status).toBe('out-of-stock');
    });
    it('shows a deleted product as unavailable, excludes it from totals and lets the user remove it', async () => {
      await add(customer, p1, 1);
      await add(customer, p2, 1);
      await http().delete(`/api/product/${p1}`).set(bearer(admin));
      const c = await cart(customer);
      expect(c.items.find((i) => i.productId === p1)).toMatchObject({
        status: 'unavailable',
        name: null,
        lineTotalCents: 0,
      });
      expect(c.subtotalCents).toBe(2500);
      const removed = await http().delete(`/api/cart/${p1}`).set(bearer(customer));
      expect(removed.status).toBe(200);
      expect(removed.body.data.items).toHaveLength(1);
    });
  });

  describe('coupons on the cart', () => {
    it('applies a coupon and recalculates the totals', async () => {
      await newCoupon('SAVE10', 10);
      await add(customer, p1, 2); // 8000
      const r = await http()
        .post('/api/cart/apply-coupon')
        .set(bearer(customer))
        .send({ code: 'save10' });
      expect(r.status).toBe(200);
      expect(r.body.data).toMatchObject({
        coupon: { code: 'SAVE10', discountPercent: 10 },
        subtotalCents: 8000,
        discountCents: 800,
        totalCents: 7200,
      });
    });
    it('recalculates when lines change after the coupon was applied', async () => {
      await newCoupon('SAVE10', 10);
      await add(customer, p1, 1);
      await http().post('/api/cart/apply-coupon').set(bearer(customer)).send({ code: 'SAVE10' });
      const r = await add(customer, p2, 2); // 4000 + 5000
      expect(r.body.data).toMatchObject({
        subtotalCents: 9000,
        discountCents: 900,
        totalCents: 8100,
      });
      const removed = await http().delete(`/api/cart/${p1}`).set(bearer(customer));
      expect(removed.body.data).toMatchObject({
        subtotalCents: 5000,
        discountCents: 500,
        totalCents: 4500,
      });
    });
    it('follows an admin change to the coupon percentage', async () => {
      const cid = (await newCoupon('SAVE10', 10)).body.data.id;
      await add(customer, p2, 2);
      await http().post('/api/cart/apply-coupon').set(bearer(customer)).send({ code: 'SAVE10' });
      await http().patch(`/api/coupon/${cid}`).set(bearer(admin)).send({ discountPercent: 40 });
      expect(await cart(customer)).toMatchObject({ discountCents: 2000, totalCents: 3000 });
    });
    it('rounds the discount to whole cents', async () => {
      await newCoupon('ODD', 33);
      await add(customer, p2, 1); // 2500 * 33% = 825
      await http().post('/api/cart/apply-coupon').set(bearer(customer)).send({ code: 'ODD' });
      await http().patch(`/api/cart/${p2}`).set(bearer(customer)).send({ quantity: 3 }); // 7500 * .33 = 2475
      expect(await cart(customer)).toMatchObject({ discountCents: 2475, totalCents: 5025 });
    });
    it('stops applying a coupon that expired or was deleted, with a warning, without a server error', async () => {
      const cid = (await newCoupon('SAVE10', 10)).body.data.id;
      await add(customer, p1, 1);
      await http().post('/api/cart/apply-coupon').set(bearer(customer)).send({ code: 'SAVE10' });
      t.coupons.records.get(cid)!.expiresAt = new Date(Date.now() - 1000);
      let c = await cart(customer);
      expect(c).toMatchObject({ coupon: null, discountCents: 0, totalCents: 4000 });
      expect(c.warnings.join(' ')).toMatch(/coupon/i);
      t.coupons.records.get(cid)!.expiresAt = new Date(Date.now() + 100000);
      expect((await cart(customer)).coupon?.code).toBe('SAVE10');
      await http().delete(`/api/coupon/${cid}`).set(bearer(admin));
      c = await cart(customer);
      expect(c).toMatchObject({ coupon: null, totalCents: 4000 });
    });
    it('gives one generic answer for unknown and expired codes', async () => {
      const cid = (await newCoupon('OLD', 10)).body.data.id;
      t.coupons.records.get(cid)!.expiresAt = new Date(Date.now() - 1000);
      await add(customer, p1, 1);
      const a = await http()
        .post('/api/cart/apply-coupon')
        .set(bearer(customer))
        .send({ code: 'OLD' });
      const b = await http()
        .post('/api/cart/apply-coupon')
        .set(bearer(customer))
        .send({ code: 'NOPE' });
      expect([a.status, b.status]).toEqual([400, 400]);
      expect(a.body.error.message).toBe('Invalid or expired coupon');
      expect(b.body.error.message).toBe(a.body.error.message);
    });
    it('needs a non-empty cart', async () => {
      await newCoupon('SAVE10');
      const r = await http()
        .post('/api/cart/apply-coupon')
        .set(bearer(customer))
        .send({ code: 'SAVE10' });
      expect(r.status).toBe(400);
      expect(r.body.error.message).toMatch(/empty/i);
    });
    it('throttles repeated wrong guesses per user (429 with Retry-After) but not other users', async () => {
      await add(customer, p1, 1);
      for (let i = 0; i < 10; i++) {
        expect(
          (
            await http()
              .post('/api/cart/apply-coupon')
              .set(bearer(customer))
              .send({ code: `GUESS${i}` })
          ).status,
        ).toBe(400);
      }
      const blocked = await http()
        .post('/api/cart/apply-coupon')
        .set(bearer(customer))
        .send({ code: 'GUESS99' });
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      await add(other, p1, 1);
      expect(
        (await http().post('/api/cart/apply-coupon').set(bearer(other)).send({ code: 'GUESS' }))
          .status,
      ).toBe(400);
    });
    it.each([{}, { code: '' }, { code: 5 }, { code: 'A', extra: 1 }, { code: 'x'.repeat(65) }])(
      'rejects apply-coupon body %j',
      async (body) => {
        expect(
          (await http().post('/api/cart/apply-coupon').set(bearer(customer)).send(body)).status,
        ).toBe(400);
      },
    );
  });

  describe('robustness', () => {
    it('retries when another request wins the race, and gives up cleanly after three', async () => {
      t.carts.forceConflicts = 2;
      expect((await add(customer, p1, 1)).status).toBe(201);
      t.carts.forceConflicts = 3;
      const r = await add(customer, p1, 1);
      expect(r.status).toBe(409);
      expect(r.body.error.message).toMatch(/try again/i);
      expect((await cart(customer)).items[0]!.quantity).toBe(1);
    });
    it('concurrent adds never lose an update', async () => {
      const results = await Promise.all([
        add(customer, p1, 1),
        add(customer, p1, 1),
        add(customer, p1, 1),
      ]);
      const ok = results.filter((r) => r.status === 201).length;
      expect((await cart(customer)).items[0]!.quantity).toBe(ok);
      expect(ok).toBeGreaterThanOrEqual(1);
    });
    it('storage failures are generic and leak nothing', async () => {
      t.carts.failWith = new Error('mongodb://user:secret@host/db exploded');
      const r = await http().get('/api/cart').set(bearer(customer));
      expect(r.status).toBe(500);
      expect(JSON.stringify(r.body)).not.toMatch(/secret|mongodb/);
      t.carts.failWith = new ServiceUnavailableException('secret-host');
      const s = await add(customer, p1, 1);
      expect(s.status).toBe(503);
      expect(JSON.stringify(s.body)).not.toContain('secret-host');
    });
  });
});
