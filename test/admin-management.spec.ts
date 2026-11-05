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

/** Phase 1 admin management: product stock and deletion rules, and coupon lifecycle. */
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const future = (days = 30) => new Date(Date.now() + days * 86_400_000).toISOString();
const SHIP = { address: '12 Nile Corniche, Cairo', phone: '+20 100 123 4567' };

describe('admin product and coupon management', () => {
  let t: AuthTestApp;
  let app: INestApplication;
  let admin: string;
  let customer: string;
  let viewer: string;
  let categoryId: string;
  let brandId: string;
  let productId: string; // 5000, 20% off -> 4000, stock 10

  const http = () => request(app.getHttpServer());
  const stock = (id: string) => t.products.records.get(id)!.stock;
  const adjust = (token: string, id: string, change: unknown) =>
    http().patch(`/api/product/${id}/stock`).set(bearer(token)).send({ change });
  const order = async (token: string, id: string, quantity: number) => {
    expect(
      (await http().post('/api/cart').set(bearer(token)).send({ productId: id, quantity })).status,
    ).toBe(201);
    const r = await http().post('/api/order').set(bearer(token)).send(SHIP);
    expect(r.status).toBe(201);
    return r.body.data as { id: string; totalCents: number; discountCents: number };
  };
  const newCoupon = (body: Record<string, unknown> = {}) =>
    http()
      .post('/api/coupon')
      .set(bearer(admin))
      .send({ code: 'SAVE15', discountPercent: 15, expiresAt: future(), ...body });

  beforeEach(async () => {
    t = await createAuthApp([BrandController, CategoryController, ProductController]);
    app = t.app;
    admin = (await t.login(Role.ADMIN)).token;
    customer = (await t.login(Role.CUSTOMER)).token;
    viewer = (await t.login(Role.DEMO_VIEWER)).token;
    categoryId = (
      await http().post('/api/category/create').set(bearer(admin)).send({ name: 'Cat' })
    ).body.data.id;
    brandId = (await http().post('/api/brand/create').set(bearer(admin)).send({ name: 'Brand' }))
      .body.data.id;
    const created = await http()
      .post('/api/product/create')
      .set(bearer(admin))
      .send({
        name: 'Hand Thrown Bowl',
        description: 'A bowl.',
        images: ['/catalogue/bowl.jpg'],
        priceCents: 5000,
        discountPercent: 20,
        stock: 10,
        categoryId,
        brandId,
      });
    expect(created.status).toBe(201);
    productId = created.body.data.id;
  });
  afterEach(() => app.close());

  describe('products', () => {
    it('lets an admin create, list, update and delete a product', async () => {
      const list = await http().get('/api/product?q=bowl').set(bearer(admin));
      expect(list.body.data.items.map((p: { id: string }) => p.id)).toEqual([productId]);

      const updated = await http()
        .patch(`/api/product/${productId}`)
        .set(bearer(admin))
        .send({ priceCents: 6000 });
      expect(updated.status).toBe(200);
      // Unchanged fields are preserved and the sale price is recomputed on the server.
      expect(updated.body.data).toMatchObject({
        name: 'Hand Thrown Bowl',
        stock: 10,
        discountPercent: 20,
        priceCents: 6000,
        salePriceCents: 4800,
      });

      expect((await http().delete(`/api/product/${productId}`).set(bearer(admin))).status).toBe(
        200,
      );
      expect((await http().get(`/api/product/${productId}`)).status).toBe(404);
    });

    it.each([
      ['a missing name', { name: undefined }],
      ['a negative stock', { stock: -1 }],
      ['a fractional price', { priceCents: 10.5 }],
      ['a zero price', { priceCents: 0 }],
      ['an http image', { images: ['http://example.com/a.jpg'] }],
      ['no image', { images: [] }],
      ['an unknown category', { categoryId: 'f'.repeat(24) }],
      ['a client-set sale price', { salePriceCents: 1 }],
    ])('rejects a product with %s', async (_label, over) => {
      const body: Record<string, unknown> = {
        name: 'Another Bowl',
        images: ['/catalogue/bowl.jpg'],
        priceCents: 1000,
        stock: 1,
        categoryId,
        brandId,
        ...over,
      };
      const r = await http().post('/api/product/create').set(bearer(admin)).send(body);
      expect([400, 404]).toContain(r.status);
      expect(t.products.records.size).toBe(1);
    });

    it('adds and removes stock with relative changes', async () => {
      const up = await adjust(admin, productId, 5);
      expect(up.status).toBe(200);
      expect(up.body.data.stock).toBe(15);
      const down = await adjust(admin, productId, -12);
      expect(down.body.data.stock).toBe(3);
      expect(stock(productId)).toBe(3);
    });

    it('never lets stock go below zero', async () => {
      const r = await adjust(admin, productId, -11);
      expect(r.status).toBe(409);
      expect(r.body.error.message).toMatch(/below zero/);
      expect(stock(productId)).toBe(10);
      expect(
        (await http().patch(`/api/product/${productId}`).set(bearer(admin)).send({ stock: -3 }))
          .status,
      ).toBe(400);
    });

    it.each([0, 1.5, '5', null, 2_000_000])('rejects a stock change of %p', async (change) => {
      expect((await adjust(admin, productId, change)).status).toBe(400);
      expect(stock(productId)).toBe(10);
    });

    it('keeps stock changes consistent with order reservations and cancellations', async () => {
      const placed = await order(customer, productId, 4);
      expect(stock(productId)).toBe(6); // reserved
      expect((await adjust(admin, productId, -6)).body.data.stock).toBe(0); // write off the rest
      expect((await adjust(admin, productId, -1)).status).toBe(409);
      const cancel = await http()
        .patch(`/api/order/${placed.id}/status`)
        .set(bearer(admin))
        .send({ status: 'CANCELLED' });
      expect(cancel.status).toBe(200);
      expect(stock(productId)).toBe(4); // the reservation comes back, nothing is lost
    });

    it('refuses to delete a product still held by an open order, and allows it once settled', async () => {
      const placed = await order(customer, productId, 1);
      const refused = await http().delete(`/api/product/${productId}`).set(bearer(admin));
      expect(refused.status).toBe(409);
      expect(refused.body.error.message).toMatch(/open order/);
      expect(t.products.records.has(productId)).toBe(true);

      await http()
        .patch(`/api/order/${placed.id}/status`)
        .set(bearer(admin))
        .send({ status: 'CANCELLED' });
      expect((await http().delete(`/api/product/${productId}`).set(bearer(admin))).status).toBe(
        200,
      );
      // The order keeps its own copy of the line, so history is intact after the deletion.
      const kept = await http().get(`/api/order/${placed.id}`).set(bearer(customer));
      expect(kept.status).toBe(200);
      expect(kept.body.data.items[0]).toMatchObject({ name: 'Hand Thrown Bowl', quantity: 1 });
    });

    it.each([
      ['customer', () => customer],
      ['demo viewer', () => viewer],
    ])('a %s cannot create, edit, restock or delete products', async (_who, token) => {
      const tk = token();
      const results = [
        await http().post('/api/product/create').set(bearer(tk)).send({ name: 'X' }),
        await http().patch(`/api/product/${productId}`).set(bearer(tk)).send({ priceCents: 1 }),
        await adjust(tk, productId, 100),
        await http().delete(`/api/product/${productId}`).set(bearer(tk)),
      ];
      expect(results.map((r) => r.status)).toEqual([403, 403, 403, 403]);
      expect(t.products.records.get(productId)).toMatchObject({ stock: 10, priceCents: 5000 });
    });

    it('records stock changes and deletions in the audit log', async () => {
      await adjust(admin, productId, 2);
      await http().delete(`/api/product/${productId}`).set(bearer(admin));
      const actions = t.audit.entries.map((e) => e.action);
      expect(actions).toEqual(
        expect.arrayContaining(['product.create', 'product.stock', 'product.delete']),
      );
    });
  });

  describe('coupons', () => {
    it('lets an admin create, list, update, pause, resume and delete a coupon', async () => {
      const created = await newCoupon({ code: 'spring15' });
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({
        code: 'SPRING15',
        discountType: 'PERCENT',
        discountPercent: 15,
        active: true,
        status: 'ACTIVE',
        ordersPlaced: 0,
      });
      const id = created.body.data.id as string;

      const edited = await http()
        .patch(`/api/coupon/${id}`)
        .set(bearer(admin))
        .send({ discountPercent: 25 });
      expect(edited.body.data).toMatchObject({ discountPercent: 25, active: true });

      const paused = await http()
        .patch(`/api/coupon/${id}`)
        .set(bearer(admin))
        .send({ active: false });
      expect(paused.body.data).toMatchObject({
        active: false,
        status: 'INACTIVE',
        discountPercent: 25,
      });
      const resumed = await http()
        .patch(`/api/coupon/${id}`)
        .set(bearer(admin))
        .send({ active: true });
      expect(resumed.body.data.status).toBe('ACTIVE');

      const list = await http().get('/api/coupon').set(bearer(admin));
      expect(list.body.data).toHaveLength(1);

      expect((await http().delete(`/api/coupon/${id}`).set(bearer(admin))).status).toBe(200);
      expect((await http().get('/api/coupon').set(bearer(admin))).body.data).toHaveLength(0);
    });

    it('rejects a duplicate code, ignoring case', async () => {
      expect((await newCoupon()).status).toBe(201);
      const dup = await newCoupon({ code: 'save15' });
      expect(dup.status).toBe(409);
    });

    it.each([
      ['an expiry in the past', { expiresAt: new Date(Date.now() - 1000).toISOString() }],
      ['a 0 % discount', { discountPercent: 0 }],
      ['a 95 % discount', { discountPercent: 95 }],
      ['a non-boolean active flag', { active: 'yes' }],
      ['an unknown field', { type: 'FIXED' }],
    ])('rejects a coupon with %s', async (_label, over) => {
      expect((await newCoupon(over)).status).toBe(400);
    });

    it('applies a valid coupon and calculates the discount on the server', async () => {
      await newCoupon();
      await http().post('/api/cart').set(bearer(customer)).send({ productId, quantity: 3 });
      const applied = await http()
        .post('/api/cart/apply-coupon')
        .set(bearer(customer))
        .send({ code: 'save15' });
      expect(applied.status).toBe(200);
      // 3 × 4000 = 12000; 15 % = 1800
      expect(applied.body.data).toMatchObject({
        subtotalCents: 12000,
        discountCents: 1800,
        totalCents: 10200,
      });
    });

    it('rejects unknown, expired and paused coupons with one generic message', async () => {
      const id = (await newCoupon()).body.data.id as string;
      await http().post('/api/cart').set(bearer(customer)).send({ productId, quantity: 1 });
      const apply = (code: string) =>
        http().post('/api/cart/apply-coupon').set(bearer(customer)).send({ code });

      const unknown = await apply('NOPE99');
      expect(unknown.status).toBe(400);
      expect(unknown.body.error.message).toBe('Invalid or expired coupon');

      await http().patch(`/api/coupon/${id}`).set(bearer(admin)).send({ active: false });
      const paused = await apply('SAVE15');
      expect(paused.status).toBe(400);
      expect(paused.body.error.message).toBe('Invalid or expired coupon');

      await http().patch(`/api/coupon/${id}`).set(bearer(admin)).send({ active: true });
      t.coupons.records.get(id)!.expiresAt = new Date(Date.now() - 1000);
      const expired = await apply('SAVE15');
      expect(expired.status).toBe(400);
      const listed = await http().get('/api/coupon').set(bearer(admin));
      expect(listed.body.data[0].status).toBe('EXPIRED');
    });

    it('stops discounting a cart as soon as its coupon is paused or deleted', async () => {
      const id = (await newCoupon()).body.data.id as string;
      await http().post('/api/cart').set(bearer(customer)).send({ productId, quantity: 1 });
      await http().post('/api/cart/apply-coupon').set(bearer(customer)).send({ code: 'SAVE15' });

      await http().patch(`/api/coupon/${id}`).set(bearer(admin)).send({ active: false });
      const paused = await http().get('/api/cart').set(bearer(customer));
      expect(paused.body.data).toMatchObject({ coupon: null, discountCents: 0, totalCents: 4000 });
      expect(paused.body.data.warnings.join(' ')).toMatch(/no longer valid/);

      await http().patch(`/api/coupon/${id}`).set(bearer(admin)).send({ active: true });
      expect((await http().get('/api/cart').set(bearer(customer))).body.data.discountCents).toBe(
        600,
      );

      await http().delete(`/api/coupon/${id}`).set(bearer(admin));
      expect((await http().get('/api/cart').set(bearer(customer))).body.data.coupon).toBeNull();
    });

    it('counts orders placed with each code and keeps them after the coupon is deleted', async () => {
      const id = (await newCoupon()).body.data.id as string;
      await http().post('/api/cart').set(bearer(customer)).send({ productId, quantity: 1 });
      await http().post('/api/cart/apply-coupon').set(bearer(customer)).send({ code: 'SAVE15' });
      const placed = (await http().post('/api/order').set(bearer(customer)).send(SHIP)).body.data;
      expect(placed).toMatchObject({ discountCents: 600, totalCents: 3400 });

      const listed = await http().get('/api/coupon').set(bearer(admin));
      expect(listed.body.data[0].ordersPlaced).toBe(1);

      await http().delete(`/api/coupon/${id}`).set(bearer(admin));
      const kept = await http().get(`/api/order/${placed.id}`).set(bearer(customer));
      expect(kept.body.data).toMatchObject({ coupon: { code: 'SAVE15' }, totalCents: 3400 });
    });

    it.each([
      ['customer', () => customer],
      ['demo viewer', () => viewer],
    ])('a %s can neither read nor change coupons', async (_who, token) => {
      const id = (await newCoupon()).body.data.id as string;
      const tk = token();
      const results = [
        await http().get('/api/coupon').set(bearer(tk)),
        await http()
          .post('/api/coupon')
          .set(bearer(tk))
          .send({ code: 'MINE90', discountPercent: 90, expiresAt: future() }),
        await http().patch(`/api/coupon/${id}`).set(bearer(tk)).send({ active: false }),
        await http().delete(`/api/coupon/${id}`).set(bearer(tk)),
      ];
      expect(results.map((r) => r.status)).toEqual([403, 403, 403, 403]);
      expect(t.coupons.records.get(id)).toMatchObject({ active: true, discountPercent: 15 });
    });
  });
});
