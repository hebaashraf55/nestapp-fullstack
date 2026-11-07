import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { applyBundles } from '../src/bundles/bundle-pricing';
import { BundleRecord } from '../src/bundles/bundles.repository';
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

describe('variants, bundles, Shop the Look and moodboards', () => {
  let t: AuthTestApp;
  let app: INestApplication;
  let admin: string;
  let alice: string;
  let bob: string;
  let viewer: string;
  let categoryId: string;
  let brandId: string;

  const http = () => request(app.getHttpServer());
  const mk = async (name: string, over: object = {}) => {
    const r = await http()
      .post('/api/product/create')
      .set(bearer(admin))
      .send({
        name,
        images: ['/catalogue/x.jpg'],
        priceCents: 1000,
        stock: 10,
        categoryId,
        brandId,
        ...over,
      });
    expect(r.status).toBe(201);
    return r.body.data.id as string;
  };

  beforeEach(async () => {
    t = await createAuthApp([BrandController, CategoryController, ProductController]);
    app = t.app;
    admin = (await t.login(Role.ADMIN)).token;
    alice = (await t.login(Role.CUSTOMER)).token;
    bob = (await t.login(Role.CUSTOMER)).token;
    viewer = (await t.login(Role.DEMO_VIEWER)).token;
    categoryId = (
      await http().post('/api/category/create').set(bearer(admin)).send({ name: 'Textiles' })
    ).body.data.id;
    brandId = (
      await http().post('/api/brand/create').set(bearer(admin)).send({ name: 'Wadi Works' })
    ).body.data.id;
  });
  afterEach(() => app.close());

  describe('variants', () => {
    it('lists the other options of a product, each with its own price and stock', async () => {
      const sage = await mk('Linen Throw Sage', {
        variantGroup: 'Linen-Throw',
        variantLabel: 'Sage',
      });
      const oat = await mk('Linen Throw Oat', {
        variantGroup: 'linen-throw',
        variantLabel: 'Oat',
        priceCents: 2000,
        stock: 0,
      });
      await mk('Unrelated Rug');
      const r = (await http().get(`/api/product/${sage}`).expect(200)).body.data;
      expect(r).toMatchObject({ variantGroup: 'linen-throw', variantLabel: 'Sage' });
      expect(r.variants).toEqual([
        { id: oat, label: 'Oat', salePriceCents: 2000, inStock: false, image: '/catalogue/x.jpg' },
        { id: sage, label: 'Sage', salePriceCents: 1000, inStock: true, image: '/catalogue/x.jpg' },
      ]);
      // Listings stay light.
      const list = (await http().get('/api/product').expect(200)).body.data.items;
      expect(list[0]).not.toHaveProperty('variants');
    });

    it('needs both group and label, in a safe format', async () => {
      const bad = (over: object) =>
        http()
          .post('/api/product/create')
          .set(bearer(admin))
          .send({
            name: 'Bad Variant',
            images: ['/catalogue/x.jpg'],
            priceCents: 1,
            stock: 1,
            categoryId,
            brandId,
            ...over,
          });
      expect((await bad({ variantGroup: 'linen-throw' })).status).toBe(400);
      expect((await bad({ variantLabel: 'Oat' })).status).toBe(400);
      expect((await bad({ variantGroup: 'Linen Throw!', variantLabel: 'Oat' })).status).toBe(400);
      expect((await bad({ variantGroup: { $ne: 1 }, variantLabel: 'Oat' })).status).toBe(400);
      const id = await mk('Plain Throw');
      expect(
        (
          await http()
            .patch(`/api/product/${id}`)
            .set(bearer(admin))
            .send({ variantGroup: 'throws' })
        ).status,
      ).toBe(400);
    });
  });

  describe('bundles', () => {
    let a: string;
    let b: string;
    let c: string;
    const create = (body: object) => http().post('/api/bundles').set(bearer(admin)).send(body);

    beforeEach(async () => {
      a = await mk('Bath Towel', { priceCents: 3000 });
      b = await mk('Hand Towel', { priceCents: 2000, discountPercent: 50 }); // sale price 1000
      c = await mk('Bath Mat', { priceCents: 4000, stock: 1 });
    });

    it('prices a bundle from today’s sale prices on the server', async () => {
      const r = await create({
        name: 'Bath Set',
        items: [
          { productId: a, quantity: 2 },
          { productId: b, quantity: 1 },
        ],
        discountPercent: 10,
      }).expect(201);
      expect(r.body.data).toMatchObject({
        slug: 'bath-set',
        itemsTotalCents: 7000,
        savingsCents: 700,
        priceCents: 6300,
        available: true,
      });
      expect((await http().get('/api/bundles/bath-set').expect(200)).body.data.priceCents).toBe(
        6300,
      );
      expect((await http().get(`/api/bundles?productId=${b}`).expect(200)).body.data).toHaveLength(
        1,
      );
    });

    it('validates items, discount and products; refuses client prices', async () => {
      expect(
        (await create({ name: 'One', items: [{ productId: a, quantity: 1 }], discountPercent: 10 }))
          .status,
      ).toBe(400);
      expect(
        (
          await create({
            name: 'Dupes',
            items: [
              { productId: a, quantity: 1 },
              { productId: a, quantity: 1 },
            ],
            discountPercent: 10,
          })
        ).status,
      ).toBe(400);
      const two = [
        { productId: a, quantity: 1 },
        { productId: b, quantity: 1 },
      ];
      expect((await create({ name: 'Greedy', items: two, discountPercent: 90 })).status).toBe(400);
      expect(
        (await create({ name: 'Priced', items: two, discountPercent: 10, priceCents: 1 })).status,
      ).toBe(400);
      expect(
        (
          await create({
            name: 'Ghost',
            items: [
              { productId: a, quantity: 1 },
              { productId: 'f'.repeat(24), quantity: 1 },
            ],
            discountPercent: 10,
          })
        ).status,
      ).toBe(400);
      expect((await http().post('/api/bundles').set(bearer(alice)).send({})).status).toBe(403);
      expect((await http().post('/api/bundles').set(bearer(viewer)).send({})).status).toBe(403);
    });

    it('hides inactive bundles and sets without enough stock from shoppers', async () => {
      const set = await create({
        name: 'Mat Set',
        items: [
          { productId: a, quantity: 1 },
          { productId: c, quantity: 2 },
        ],
        discountPercent: 5,
      }).expect(201);
      expect(set.body.data.available).toBe(false); // only 1 mat in stock
      expect((await http().get('/api/bundles').expect(200)).body.data).toEqual([]);
      const off = await create({
        name: 'Paused Set',
        items: [
          { productId: a, quantity: 1 },
          { productId: b, quantity: 1 },
        ],
        discountPercent: 5,
        active: false,
      }).expect(201);
      expect((await http().get('/api/bundles/paused-set')).status).toBe(404);
      expect((await http().get('/api/bundles/paused-set').set(bearer(admin))).status).toBe(200);
      expect((await http().get('/api/bundles?all=true').set(bearer(admin))).body.data).toHaveLength(
        2,
      );
      expect((await http().get('/api/bundles?all=true').set(bearer(alice))).body.data).toEqual([]);
      await http()
        .patch(`/api/bundles/${off.body.data.id}`)
        .set(bearer(admin))
        .send({ active: true })
        .expect(200);
      expect((await http().get('/api/bundles').expect(200)).body.data).toHaveLength(1);
      await http().delete(`/api/bundles/${off.body.data.id}`).set(bearer(admin)).expect(200);
      expect((await http().get('/api/bundles/../etc')).status).toBe(404);
    });

    it('applies the discount in the cart for every complete set, before the coupon, and keeps it on the order', async () => {
      await create({
        name: 'Bath Set',
        items: [
          { productId: a, quantity: 1 },
          { productId: b, quantity: 1 },
        ],
        discountPercent: 10,
      }).expect(201);
      // One complete set + one extra towel.
      const cart = await http()
        .post('/api/cart/batch')
        .set(bearer(alice))
        .send({
          items: [
            { productId: a, quantity: 2 },
            { productId: b, quantity: 1 },
          ],
        })
        .expect(201);
      expect(cart.body.data).toMatchObject({
        subtotalCents: 7000,
        bundleSavingsCents: 400, // 10 % of (3000 + 1000)
        totalCents: 6600,
      });
      expect(cart.body.data.bundles).toEqual([
        expect.objectContaining({ name: 'Bath Set', times: 1, savingsCents: 400 }),
      ]);
      // A coupon is taken off the price after bundle savings.
      await http()
        .post('/api/coupon')
        .set(bearer(admin))
        .send({
          code: 'TEN',
          discountPercent: 10,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        })
        .expect(201);
      const coupon = await http()
        .post('/api/cart/apply-coupon')
        .set(bearer(alice))
        .send({ code: 'TEN' })
        .expect(200);
      expect(coupon.body.data).toMatchObject({
        bundleSavingsCents: 400,
        discountCents: 660,
        totalCents: 5940,
      });
      const order = (await http().post('/api/order').set(bearer(alice)).send(SHIP).expect(201)).body
        .data;
      expect(order).toMatchObject({
        subtotalCents: 7000,
        bundleSavingsCents: 400,
        discountCents: 660,
        totalCents: 5940,
      });
    });

    it('stops discounting when a set is broken', async () => {
      await create({
        name: 'Bath Set',
        items: [
          { productId: a, quantity: 1 },
          { productId: b, quantity: 1 },
        ],
        discountPercent: 10,
      }).expect(201);
      await http()
        .post('/api/cart/batch')
        .set(bearer(bob))
        .send({
          items: [
            { productId: a, quantity: 1 },
            { productId: b, quantity: 1 },
          ],
        })
        .expect(201);
      const after = await http().delete(`/api/cart/${b}`).set(bearer(bob)).expect(200);
      expect(after.body.data).toMatchObject({
        bundleSavingsCents: 0,
        bundles: [],
        totalCents: 3000,
      });
    });
  });

  describe('batch add to cart', () => {
    it('is all or nothing and checks stock', async () => {
      const a = await mk('Cushion', { stock: 2 });
      const b = await mk('Pillow', { stock: 1 });
      const r = await http()
        .post('/api/cart/batch')
        .set(bearer(alice))
        .send({
          items: [
            { productId: a, quantity: 1 },
            { productId: b, quantity: 2 },
          ],
        });
      expect(r.status).toBe(409);
      expect((await http().get('/api/cart').set(bearer(alice))).body.data.items).toEqual([]);
      expect(
        (
          await http()
            .post('/api/cart/batch')
            .set(bearer(alice))
            .send({ items: [{ productId: a, quantity: 1, priceCents: 1 }] })
        ).status,
      ).toBe(400);
      expect(
        (
          await http()
            .post('/api/cart/batch')
            .set(bearer(alice))
            .send({
              items: [
                { productId: a, quantity: 1 },
                { productId: a, quantity: 1 },
              ],
            })
        ).status,
      ).toBe(400);
      expect(
        (
          await http()
            .post('/api/cart/batch')
            .set(bearer(alice))
            .send({ items: [{ productId: 'f'.repeat(24), quantity: 1 }] })
        ).status,
      ).toBe(404);
      expect(
        (
          await http()
            .post('/api/cart/batch')
            .set(bearer(viewer))
            .send({ items: [{ productId: a, quantity: 1 }] })
        ).status,
      ).toBe(403);
    });
  });

  describe('Shop the Look', () => {
    it('shows active looks with their products and optional spots; admins curate', async () => {
      const sofa = await mk('Bouclé Sofa');
      const lamp = await mk('Arc Lamp');
      const created = await http()
        .post('/api/looks')
        .set(bearer(admin))
        .send({
          title: 'Quiet Living Room',
          image: '/catalogue/live-edge-coffee-table.jpg',
          spots: [
            { productId: sofa, x: 30, y: 60 },
            { productId: lamp, x: null, y: null },
          ],
        })
        .expect(201);
      expect(created.body.data).toMatchObject({ slug: 'quiet-living-room', totalCents: 2000 });
      const look = (await http().get('/api/looks/quiet-living-room').expect(200)).body.data;
      expect(
        look.spots.map((s: { product: { id: string }; x: number | null }) => [s.product.id, s.x]),
      ).toEqual([
        [sofa, 30],
        [lamp, null],
      ]);
      expect((await http().get(`/api/looks?productId=${lamp}`)).body.data).toHaveLength(1);
      // A deleted product simply drops out of the look.
      await http().delete(`/api/product/${lamp}`).set(bearer(admin)).expect(200);
      expect((await http().get('/api/looks/quiet-living-room')).body.data.spots).toHaveLength(1);
      await http()
        .patch(`/api/looks/${created.body.data.id}`)
        .set(bearer(admin))
        .send({ active: false })
        .expect(200);
      expect((await http().get('/api/looks/quiet-living-room')).status).toBe(404);
    });

    it('validates spots and is admin-only to change', async () => {
      const sofa = await mk('Bouclé Sofa');
      const post = (body: object, token = admin) =>
        http().post('/api/looks').set(bearer(token)).send(body);
      const base = { title: 'Look', image: '/catalogue/x.jpg' };
      expect((await post({ ...base, spots: [] })).status).toBe(400);
      expect((await post({ ...base, spots: [{ productId: sofa, x: 120, y: 10 }] })).status).toBe(
        400,
      );
      expect((await post({ ...base, spots: [{ productId: sofa, x: 10, y: null }] })).status).toBe(
        400,
      );
      expect(
        (await post({ ...base, image: 'javascript:alert(1)', spots: [{ productId: sofa }] }))
          .status,
      ).toBe(400);
      expect((await post({ ...base, spots: [{ productId: sofa }] }, alice)).status).toBe(403);
    });
  });

  describe('moodboards', () => {
    it('lets a customer collect products privately and share a read-only link', async () => {
      const p = await mk('Clay Vase');
      const board = (
        await http()
          .post('/api/moodboards')
          .set(bearer(alice))
          .send({ name: 'Calm bedroom' })
          .expect(201)
      ).body.data;
      await http().put(`/api/moodboards/${board.id}/products/${p}`).set(bearer(alice)).expect(200);
      const twice = await http()
        .put(`/api/moodboards/${board.id}/products/${p}`)
        .set(bearer(alice))
        .expect(200);
      expect(twice.body.data.productIds).toEqual([p]);
      expect(twice.body.data.sharePath).toBeNull();

      // Private: another customer cannot see, change or delete it.
      expect((await http().get(`/api/moodboards/${board.id}`).set(bearer(bob))).status).toBe(404);
      expect(
        (await http().put(`/api/moodboards/${board.id}/products/${p}`).set(bearer(bob))).status,
      ).toBe(404);
      expect((await http().delete(`/api/moodboards/${board.id}`).set(bearer(bob))).status).toBe(
        404,
      );
      expect((await http().get('/api/moodboards').set(bearer(bob))).body.data).toEqual([]);

      const shared = (
        await http().post(`/api/moodboards/${board.id}/share`).set(bearer(alice)).expect(200)
      ).body.data;
      expect(shared.sharePath).toMatch(/^\/moodboards\/shared\/[0-9a-f]{32}$/);
      const token = shared.sharePath.split('/').pop();
      const pub = (await http().get(`/api/moodboards/shared/${token}`).expect(200)).body.data;
      expect(Object.keys(pub).sort()).toEqual(['name', 'note', 'products', 'updatedAt']);
      expect(pub.products.map((x: { id: string }) => x.id)).toEqual([p]);

      // A new link replaces the old one; unsharing stops the link.
      const again = (
        await http().post(`/api/moodboards/${board.id}/share`).set(bearer(alice)).expect(200)
      ).body.data;
      expect((await http().get(`/api/moodboards/shared/${token}`)).status).toBe(404);
      await http().delete(`/api/moodboards/${board.id}/share`).set(bearer(alice)).expect(200);
      expect(
        (await http().get(`/api/moodboards/shared/${again.sharePath.split('/').pop()}`)).status,
      ).toBe(404);
      expect((await http().get('/api/moodboards/shared/not-a-token')).status).toBe(404);
    });

    it('enforces limits and validation; customers only', async () => {
      expect(
        (await http().post('/api/moodboards').set(bearer(alice)).send({ name: '' })).status,
      ).toBe(400);
      expect(
        (
          await http()
            .post('/api/moodboards')
            .set(bearer(alice))
            .send({ name: 'x', userId: 'someone' })
        ).status,
      ).toBe(400);
      expect(
        (await http().post('/api/moodboards').set(bearer(admin)).send({ name: 'x' })).status,
      ).toBe(403);
      expect((await http().get('/api/moodboards').set(bearer(viewer))).status).toBe(403);
      expect((await http().get('/api/moodboards')).status).toBe(401);
      for (let i = 0; i < 20; i++)
        await http()
          .post('/api/moodboards')
          .set(bearer(alice))
          .send({ name: `Board ${i}` })
          .expect(201);
      expect(
        (await http().post('/api/moodboards').set(bearer(alice)).send({ name: 'One too many' }))
          .status,
      ).toBe(409);
      const board = (await http().get('/api/moodboards').set(bearer(alice))).body.data[0];
      expect(
        (
          await http()
            .put(`/api/moodboards/${board.id}/products/${'f'.repeat(24)}`)
            .set(bearer(alice))
        ).status,
      ).toBe(404);
      const full = t.moodboards.records.get(board.id)!;
      full.productIds = Array.from({ length: 50 }, (_, i) => i.toString(16).padStart(24, '0'));
      const p = await mk('Last Straw');
      expect(
        (await http().put(`/api/moodboards/${board.id}/products/${p}`).set(bearer(alice))).status,
      ).toBe(409);
    });
  });
});

describe('bundle pricing', () => {
  const bundle = (id: string, pct: number, items: [string, number][]): BundleRecord => ({
    id,
    name: id,
    slug: id,
    description: '',
    image: null,
    items: items.map(([productId, quantity]) => ({ productId, quantity })),
    discountPercent: pct,
    active: true,
    isDemo: false,
    createdBy: 'x',
    createdAt: new Date(),
  });
  const lines = [
    { productId: 'a', quantity: 3, unitPriceCents: 1000 },
    { productId: 'b', quantity: 1, unitPriceCents: 500 },
  ];

  it('never discounts the same unit twice and prefers the larger discount', () => {
    const r = applyBundles(lines, [
      bundle('small', 5, [
        ['a', 1],
        ['b', 1],
      ]),
      bundle('big', 20, [['a', 2]]),
    ]);
    expect(r).toEqual([
      expect.objectContaining({ bundleId: 'big', times: 1, savingsCents: 400 }),
      expect.objectContaining({ bundleId: 'small', times: 1, savingsCents: 75 }),
    ]);
  });

  it('counts how many complete sets there are, and ignores inactive bundles', () => {
    expect(applyBundles(lines, [bundle('pair', 10, [['a', 1]])])[0]).toMatchObject({
      times: 3,
      savingsCents: 300,
    });
    expect(applyBundles(lines, [{ ...bundle('off', 50, [['a', 1]]), active: false }])).toEqual([]);
    expect(
      applyBundles(lines, [
        bundle('missing', 50, [
          ['a', 1],
          ['z', 1],
        ]),
      ]),
    ).toEqual([]);
  });
});
