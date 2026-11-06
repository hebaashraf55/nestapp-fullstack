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

describe('wishlist, recently viewed, comparison and the homepage feed', () => {
  let t: AuthTestApp;
  let app: INestApplication;
  let admin: string;
  let alice: string;
  let bob: string;
  let viewer: string;
  let cat: { a: string; b: string };
  let ids: string[]; // 10 real products
  let demoId: string; // one synthetic product

  const http = () => request(app.getHttpServer());
  const mk = async (name: string, categoryId: string, brandId: string, over: object = {}) => {
    const r = await http()
      .post('/api/product/create')
      .set(bearer(admin))
      .send({
        name,
        images: ['/catalogue/x.jpg'],
        priceCents: 1000,
        stock: 5,
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
    cat = {
      a: (await http().post('/api/category/create').set(bearer(admin)).send({ name: 'Ceramics' }))
        .body.data.id,
      b: (await http().post('/api/category/create').set(bearer(admin)).send({ name: 'Lighting' }))
        .body.data.id,
    };
    const brand = (
      await http().post('/api/brand/create').set(bearer(admin)).send({ name: 'Wadi Works' })
    ).body.data.id;
    ids = [];
    for (let i = 0; i < 10; i++) {
      ids.push(
        await mk(`Product ${String.fromCharCode(65 + i)}`, i < 9 ? cat.a : cat.b, brand, {
          discountPercent: i === 2 ? 20 : 0,
          featured: i === 3,
          specs: i === 0 ? { material: 'Stoneware', color: 'Oat' } : undefined,
        }),
      );
    }
    // A synthetic product: only the demo viewer is limited to these; everyone may see it.
    demoId = ids[9]!;
    t.products.records.get(demoId)!.isDemo = true;
  });
  afterEach(() => app.close());

  describe('wishlist', () => {
    it('adds without duplicates, removes, and keeps each customer’s list private', async () => {
      await http().put(`/api/wishlist/${ids[0]}`).set(bearer(alice)).expect(200);
      const twice = await http().put(`/api/wishlist/${ids[0]}`).set(bearer(alice)).expect(200);
      expect(twice.body.data.productIds).toEqual([ids[0]]);
      await http().put(`/api/wishlist/${ids[1]}`).set(bearer(alice)).expect(200);
      expect((await http().get('/api/wishlist').set(bearer(bob))).body.data.productIds).toEqual([]);
      const removed = await http().delete(`/api/wishlist/${ids[0]}`).set(bearer(alice)).expect(200);
      expect(removed.body.data.items.map((p: { id: string }) => p.id)).toEqual([ids[1]]);
    });

    it('refuses unknown products and malformed ids, and requires sign-in', async () => {
      expect(
        (
          await http()
            .put(`/api/wishlist/${'f'.repeat(24)}`)
            .set(bearer(alice))
        ).status,
      ).toBe(404);
      expect((await http().put('/api/wishlist/not-an-id').set(bearer(alice))).status).toBe(400);
      expect((await http().get('/api/wishlist')).status).toBe(401);
      expect((await http().put(`/api/wishlist/${ids[0]}`)).status).toBe(401);
    });

    it('leaves deleted products out of the list instead of failing', async () => {
      await http().put(`/api/wishlist/${ids[4]}`).set(bearer(alice)).expect(200);
      await http().put(`/api/wishlist/${ids[5]}`).set(bearer(alice)).expect(200);
      await http().delete(`/api/product/${ids[4]}`).set(bearer(admin)).expect(200);
      const list = await http().get('/api/wishlist').set(bearer(alice)).expect(200);
      expect(list.body.data.productIds).toEqual([ids[5]]);
    });

    it('merges a guest wishlist at sign-in, ignoring unknown ids and duplicates', async () => {
      await http().put(`/api/wishlist/${ids[0]}`).set(bearer(alice)).expect(200);
      const merged = await http()
        .post('/api/wishlist/merge')
        .set(bearer(alice))
        .send({ productIds: [ids[0], ids[1], 'a'.repeat(24), ids[1].toUpperCase()] })
        .expect(200);
      expect(merged.body.data.productIds).toEqual([ids[0], ids[1]]);
      expect(
        (
          await http()
            .post('/api/wishlist/merge')
            .set(bearer(alice))
            .send({ productIds: ['x'] })
        ).status,
      ).toBe(400);
    });

    it('is capped at 100 items', async () => {
      t.shopper.wishlists.set((await t.login(Role.CUSTOMER)).id, []);
      const full = await t.login(Role.CUSTOMER);
      t.shopper.wishlists.set(
        full.id,
        Array.from({ length: 100 }, (_, i) => i.toString(16).padStart(24, '0')),
      );
      expect((await http().put(`/api/wishlist/${ids[0]}`).set(bearer(full.token))).status).toBe(
        409,
      );
    });

    it('is read-only for the demo viewer', async () => {
      expect((await http().get('/api/wishlist').set(bearer(viewer))).status).toBe(200);
      expect((await http().put(`/api/wishlist/${demoId}`).set(bearer(viewer))).status).toBe(403);
    });
  });

  describe('recently viewed', () => {
    it('keeps newest first, never repeats a product, and caps the list at 20', async () => {
      for (const id of [ids[0], ids[1], ids[0]]) {
        await http().post(`/api/recently-viewed/${id}`).set(bearer(alice)).expect(200);
      }
      expect(
        (await http().get('/api/recently-viewed').set(bearer(alice))).body.data.productIds,
      ).toEqual([ids[0], ids[1]]);
      const user = await t.login(Role.CUSTOMER);
      t.shopper.recents.set(
        user.id,
        Array.from({ length: 20 }, (_, i) => (i + 100).toString(16).padStart(24, '0')),
      );
      const after = await http()
        .post(`/api/recently-viewed/${ids[2]}`)
        .set(bearer(user.token))
        .expect(200);
      expect(t.shopper.recents.get(user.id)).toHaveLength(20);
      expect(after.body.data.productIds[0]).toBe(ids[2]);
    });

    it('merges guest history newest first and ignores unknown products', async () => {
      await http().post(`/api/recently-viewed/${ids[3]}`).set(bearer(alice)).expect(200);
      const merged = await http()
        .post('/api/recently-viewed/merge')
        .set(bearer(alice))
        .send({ productIds: [ids[1], 'b'.repeat(24), ids[2]] })
        .expect(200);
      expect(merged.body.data.productIds).toEqual([ids[1], ids[2], ids[3]]);
    });
  });

  describe('comparison', () => {
    it('returns 2–4 products in the requested order with their specifications', async () => {
      const r = await http().get(`/api/product/compare?ids=${ids[1]},${ids[0]}`).expect(200);
      expect(r.body.data.map((p: { id: string }) => p.id)).toEqual([ids[1], ids[0]]);
      expect(r.body.data[1].specs).toEqual({ material: 'Stoneware', color: 'Oat' });
      expect(r.body.data[0].specs).toEqual({}); // missing specs are simply empty
    });

    it.each([
      ['one product', () => `${ids[0]}`],
      ['five products', () => ids.slice(0, 5).join(',')],
      ['a malformed id', () => `${ids[0]},nope`],
    ])('rejects %s', async (_l, q) => {
      expect((await http().get(`/api/product/compare?ids=${q()}`)).status).toBe(400);
    });
  });

  describe('homepage feed', () => {
    it('lists every category with its count and up to 8 products, plus featured and sale rows', async () => {
      const home = (await http().get('/api/catalogue/home').expect(200)).body.data;
      const byName = Object.fromEntries(home.categories.map((c: { name: string }) => [c.name, c]));
      expect(byName.Ceramics).toMatchObject({ count: 9 });
      expect(byName.Ceramics.products).toHaveLength(8);
      expect(byName.Lighting).toMatchObject({ count: 1 });
      expect(home.featured.map((p: { id: string }) => p.id)).toEqual([ids[3]]);
      expect(home.onSale.map((p: { id: string }) => p.id)).toEqual([ids[2]]);
      expect(home.newArrivals).toHaveLength(8);
      expect(home.bestSellers).toEqual([]); // nothing sold yet: no invented best sellers
    });

    it('derives best sellers from paid orders only', async () => {
      const buy = async (token: string, productId: string, quantity: number, pay: boolean) => {
        await http().post('/api/cart').set(bearer(token)).send({ productId, quantity }).expect(201);
        const order = (await http().post('/api/order').set(bearer(token)).send(SHIP).expect(201))
          .body.data;
        if (pay)
          await http()
            .post(`/api/order/${order.id}/simulate-payment`)
            .set(bearer(token))
            .send({})
            .expect(200);
      };
      await buy(alice, ids[5]!, 1, true);
      await buy(bob, ids[6]!, 3, true);
      await buy((await t.login(Role.CUSTOMER)).token, ids[7]!, 4, false); // unpaid: does not count
      const home = (await http().get('/api/catalogue/home').expect(200)).body.data;
      expect(home.bestSellers.map((p: { id: string }) => p.id)).toEqual([ids[6], ids[5]]);
    });

    it('shows the demo viewer synthetic records only', async () => {
      const home = (await http().get('/api/catalogue/home').set(bearer(viewer)).expect(200)).body
        .data;
      const all = home.categories.flatMap((c: { products: { id: string }[] }) =>
        c.products.map((p) => p.id),
      );
      expect(all).toEqual([]); // the viewer sees synthetic categories only; these are real ones
    });
  });
});
