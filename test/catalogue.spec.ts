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

type Item = { id: string; name: string; stock: number; salePriceCents: number };
type Page = { items: Item[]; total: number; totalPages: number };
type Method = 'post' | 'patch' | 'delete';
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('catalogue API', () => {
  let t: AuthTestApp;
  let app: INestApplication;
  let admin: string;
  let customer: string;
  let viewer: string;
  let categoryId: string; // real
  let brandId: string; // real
  let demoCategoryId: string;
  let demoBrandId: string;
  let demoProductId: string;
  let realProductId: string;

  const http = () => request(app.getHttpServer());
  const productBody = (over: Record<string, unknown> = {}) => ({
    name: 'Hand Thrown Bowl',
    description: 'A bowl.',
    images: ['/catalogue/bowl.svg'],
    priceCents: 5000,
    discountPercent: 20,
    stock: 4,
    categoryId,
    brandId,
    ...over,
  });
  const post = async (path: string, token: string | null, body: unknown) => {
    const r = http().post(path);
    if (token) r.set(bearer(token));
    return r.send(body as object);
  };

  beforeEach(async () => {
    t = await createAuthApp([BrandController, CategoryController, ProductController]);
    app = t.app;
    admin = (await t.login(Role.ADMIN)).token;
    customer = (await t.login(Role.CUSTOMER)).token;
    viewer = (await t.login(Role.DEMO_VIEWER)).token;

    // Synthetic records are seeded directly (clients can never create isDemo records).
    const mk = (name: string, slug: string, isDemo: boolean) => ({
      name,
      slug,
      image: null,
      isDemo,
      createdBy: 'seed',
    });
    demoCategoryId = (await t.categories.create(mk('Demo Ceramics', 'demo-ceramics', true))).id;
    demoBrandId = (await t.brands.create(mk('Demo Brand', 'demo-brand', true))).id;
    demoProductId = (
      await t.products.create({
        name: 'Demo Vase',
        slug: 'demo-vase',
        description: '',
        images: ['/catalogue/demo.svg'],
        priceCents: 9000,
        discountPercent: 0,
        salePriceCents: 9000,
        stock: 2,
        categoryId: demoCategoryId,
        brandId: demoBrandId,
        isDemo: true,
        createdBy: 'seed',
      })
    ).id;

    categoryId = (await post('/api/category/create', admin, { name: 'Real Lighting' })).body.data
      .id;
    brandId = (await post('/api/brand/create', admin, { name: 'Real Brand' })).body.data.id;
    realProductId = (await post('/api/product/create', admin, productBody())).body.data.id;
  });
  afterEach(() => app.close());

  describe('authorization on writes', () => {
    const writes: [Method, string, object][] = [
      ['post', '/api/brand/create', { name: 'Zed' }],
      ['post', '/api/category/create', { name: 'Zed' }],
      ['post', '/api/product/create', {}],
      ['patch', `/api/brand/${'a'.repeat(24)}`, { name: 'Zed' }],
      ['patch', `/api/category/${'a'.repeat(24)}`, { name: 'Zed' }],
      ['patch', `/api/product/${'a'.repeat(24)}`, { stock: 1 }],
      ['delete', `/api/brand/${'a'.repeat(24)}`, {}],
      ['delete', `/api/category/${'a'.repeat(24)}`, {}],
      ['delete', `/api/product/${'a'.repeat(24)}`, {}],
    ];
    const call = (method: Method, path: string, token: string | null, body?: object) => {
      const r = http()[method](path);
      if (token) r.set(bearer(token));
      return r.send(body ?? {});
    };

    it.each(writes)('%s %s: anonymous gets 401', async (m, p, b) => {
      expect((await call(m, p, null, b)).status).toBe(401);
    });
    it.each(writes)('%s %s: customer gets 403', async (m, p, b) => {
      expect((await call(m, p, customer, b)).status).toBe(403);
    });
    it.each(writes)('%s %s: demo viewer gets 403', async (m, p, b) => {
      expect((await call(m, p, viewer, b)).status).toBe(403);
    });

    it('a forged token for a demoted admin is refused', async () => {
      const { id, token } = await t.login(Role.ADMIN);
      await t.users.setRole(id, Role.CUSTOMER, false);
      expect((await post('/api/brand/create', token, { name: 'Late Brand' })).status).toBe(403);
    });
    it('writes never change the store when refused', async () => {
      const before = t.products.records.size;
      await post('/api/product/create', viewer, productBody({ name: 'Sneaky' }));
      await post('/api/product/create', customer, productBody({ name: 'Sneaky' }));
      expect(t.products.records.size).toBe(before);
    });
  });

  describe('admin CRUD', () => {
    it('creates a product with a computed sale price, slug and embedded refs', async () => {
      const r = await post('/api/product/create', admin, productBody({ name: 'Linen Throw' }));
      expect(r.status).toBe(201);
      expect(r.body.data).toMatchObject({
        name: 'Linen Throw',
        slug: 'linen-throw',
        priceCents: 5000,
        discountPercent: 20,
        salePriceCents: 4000,
        currency: 'USD',
        inStock: true,
        isDemo: false,
        category: { id: categoryId, name: 'Real Lighting', slug: 'real-lighting' },
        brand: { id: brandId, name: 'Real Brand' },
      });
    });
    it('gives duplicate product names distinct slugs', async () => {
      const a = await post('/api/product/create', admin, productBody({ name: 'Twin' }));
      const b = await post('/api/product/create', admin, productBody({ name: 'Twin' }));
      expect([a.body.data.slug, b.body.data.slug]).toEqual(['twin', 'twin-2']);
    });
    it('recomputes sale price and slug on update', async () => {
      const r = await http()
        .patch(`/api/product/${realProductId}`)
        .set(bearer(admin))
        .send({ priceCents: 10000, discountPercent: 50, name: 'Renamed Bowl', stock: 0 });
      expect(r.status).toBe(200);
      expect(r.body.data).toMatchObject({
        salePriceCents: 5000,
        slug: 'renamed-bowl',
        inStock: false,
      });
    });
    it('updates only the discount using the stored price', async () => {
      const r = await http()
        .patch(`/api/product/${realProductId}`)
        .set(bearer(admin))
        .send({ discountPercent: 0 });
      expect(r.body.data.salePriceCents).toBe(5000);
    });
    it('deletes a product, then reports 404', async () => {
      const del = await http().delete(`/api/product/${realProductId}`).set(bearer(admin));
      expect(del.status).toBe(200);
      expect(del.body.data).toEqual({ deleted: true });
      expect((await http().get(`/api/product/${realProductId}`)).status).toBe(404);
      expect((await http().delete(`/api/product/${realProductId}`).set(bearer(admin))).status).toBe(
        404,
      );
    });
    it('rejects an unknown category or brand with a field error', async () => {
      const r = await post(
        '/api/product/create',
        admin,
        productBody({ categoryId: 'b'.repeat(24) }),
      );
      expect(r.status).toBe(400);
      expect(r.body.error.details).toEqual([{ field: 'categoryId', message: 'unknown category' }]);
      const u = await http()
        .patch(`/api/product/${realProductId}`)
        .set(bearer(admin))
        .send({ brandId: 'b'.repeat(24) });
      expect(u.status).toBe(400);
    });
    it('renames a brand, regenerates its slug and refuses a clashing name', async () => {
      const other = await post('/api/brand/create', admin, { name: 'Other Brand' });
      const ok = await http()
        .patch(`/api/brand/${brandId}`)
        .set(bearer(admin))
        .send({ name: 'Fresh Name' });
      expect(ok.body.data).toMatchObject({ name: 'Fresh Name', slug: 'fresh-name' });
      const clash = await http()
        .patch(`/api/brand/${other.body.data.id}`)
        .set(bearer(admin))
        .send({ name: 'fresh   name' });
      expect(clash.status).toBe(409);
    });
    it('refuses duplicate category names (case/spacing-insensitive)', async () => {
      const r = await post('/api/category/create', admin, { name: 'real  lighting' });
      expect(r.status).toBe(409);
    });
    it('refuses to delete a category or brand that products use', async () => {
      expect((await http().delete(`/api/category/${categoryId}`).set(bearer(admin))).status).toBe(
        409,
      );
      expect((await http().delete(`/api/brand/${brandId}`).set(bearer(admin))).status).toBe(409);
      await http().delete(`/api/product/${realProductId}`).set(bearer(admin));
      expect((await http().delete(`/api/category/${categoryId}`).set(bearer(admin))).status).toBe(
        200,
      );
      expect((await http().delete(`/api/brand/${brandId}`).set(bearer(admin))).status).toBe(200);
    });
    it('marks created records as non-demo and records the creator', async () => {
      const rec = t.products.records.get(realProductId)!;
      expect(rec.isDemo).toBe(false);
      expect(rec.createdBy).toBeTruthy();
    });
  });

  describe('validation and error handling', () => {
    it.each([
      ['isDemo', { isDemo: true }],
      ['salePriceCents', { salePriceCents: 1 }],
      ['createdBy', { createdBy: 'x' }],
      ['float price', { priceCents: 1.5 }],
      ['javascript image', { images: ['javascript:alert(1)'] }],
      ['short name', { name: 'ab' }],
    ])('rejects %s without echoing the value', async (_l, over) => {
      const r = await post('/api/product/create', admin, productBody(over));
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).not.toContain('javascript:alert');
    });
    it('rejects an empty body and a non-object body', async () => {
      expect((await post('/api/product/create', admin, {})).status).toBe(400);
      const r = await http()
        .post('/api/brand/create')
        .set(bearer(admin))
        .set('Content-Type', 'application/json')
        .send('[1,2]');
      expect(r.status).toBe(400);
    });
    it('400 for malformed ids on every read and write', async () => {
      for (const id of ['abc', '%7B%22%24ne%22%3Anull%7D', 'g'.repeat(24)]) {
        expect((await http().get(`/api/product/${id}`)).status).toBe(400);
        expect((await http().get(`/api/brand/${id}`)).status).toBe(400);
        expect((await http().delete(`/api/category/${id}`).set(bearer(admin))).status).toBe(400);
        expect(
          (await http().patch(`/api/product/${id}`).set(bearer(admin)).send({ stock: 1 })).status,
        ).toBe(400);
      }
    });
    it('404 for a well-formed id that does not exist', async () => {
      const id = 'c'.repeat(24);
      for (const kind of ['product', 'brand', 'category']) {
        const r = await http().get(`/api/${kind}/${id}`);
        expect(r.status).toBe(404);
        expect(r.body.success).toBe(false);
      }
      expect(
        (await http().patch(`/api/product/${id}`).set(bearer(admin)).send({ stock: 1 })).status,
      ).toBe(404);
    });
    it('treats operator-looking query values as plain invalid input', async () => {
      const r = await http().get('/api/product').query({ categoryId: '{"$ne":null}' });
      expect(r.status).toBe(400);
      const nested = await http().get('/api/product?q[$ne]=x');
      expect(nested.status).toBe(400);
    });
    it('returns a leak-free 503 when storage fails', async () => {
      t.products.failWith = new Error('mongodb://user:secret@host/db exploded');
      const r = await http().get('/api/product');
      expect(r.status).toBe(500);
      expect(JSON.stringify(r.body)).not.toMatch(/secret|mongodb/);
      t.products.failWith = new ServiceUnavailableException('db down: secret-host');
      const s = await http().get('/api/product');
      expect(s.status).toBe(503);
      expect(JSON.stringify(s.body)).not.toContain('secret-host');
    });
  });

  describe('public reads and DEMO_VIEWER scope', () => {
    it('anonymous and customers see every record', async () => {
      for (const token of [null, customer, admin]) {
        const r = http().get('/api/product');
        if (token) r.set(bearer(token));
        const res = await r;
        expect(res.status).toBe(200);
        expect(res.body.data.total).toBe(2);
      }
    });
    it('the demo viewer sees only synthetic products, brands and categories', async () => {
      const products = await http().get('/api/product').set(bearer(viewer));
      expect(products.body.data.items.map((p: Item) => p.id)).toEqual([demoProductId]);
      const brands = await http().get('/api/brand').set(bearer(viewer));
      expect(brands.body.data.map((b: { id: string }) => b.id)).toEqual([demoBrandId]);
      const cats = await http().get('/api/category').set(bearer(viewer));
      expect(cats.body.data.map((c: { id: string }) => c.id)).toEqual([demoCategoryId]);
    });
    it('the demo viewer gets 404 (not 403) for real records and 200 for demo ones', async () => {
      expect((await http().get(`/api/product/${realProductId}`).set(bearer(viewer))).status).toBe(
        404,
      );
      expect((await http().get(`/api/brand/${brandId}`).set(bearer(viewer))).status).toBe(404);
      expect((await http().get(`/api/category/${categoryId}`).set(bearer(viewer))).status).toBe(
        404,
      );
      expect((await http().get(`/api/product/${demoProductId}`).set(bearer(viewer))).status).toBe(
        200,
      );
    });
    it('filtering by a real category as the demo viewer reveals nothing', async () => {
      const r = await http().get('/api/product').query({ categoryId }).set(bearer(viewer));
      expect(r.body.data).toMatchObject({ items: [], total: 0 });
    });
    it('a stale or garbage token falls back to anonymous (public data only)', async () => {
      const r = await http().get('/api/product').set(bearer('not-a-token'));
      expect(r.status).toBe(200);
      expect(r.body.data.total).toBe(2);
    });
    it('a revoked token on a public route is treated as anonymous', async () => {
      const { id, token } = await t.login(Role.DEMO_VIEWER);
      await t.repo.bumpTokenVersion(id);
      const r = await http().get('/api/product').set(bearer(token));
      expect(r.status).toBe(200);
    });
    it('storage outage during optional identification is not swallowed', async () => {
      t.repo.findById = async () => {
        throw new Error('down');
      };
      const r = await http().get('/api/product').set(bearer(viewer));
      expect(r.status).toBeGreaterThanOrEqual(500);
    });
    it('responses expose no internal fields', async () => {
      const r = await http().get(`/api/product/${realProductId}`);
      expect(Object.keys(r.body.data).sort()).toEqual(
        [
          'brand',
          'category',
          'createdAt',
          'currency',
          'description',
          'discountPercent',
          'id',
          'images',
          'inStock',
          'isDemo',
          'name',
          'priceCents',
          'salePriceCents',
          'slug',
          'stock',
        ].sort(),
      );
    });
  });

  describe('listing: search, filters, sort, pagination', () => {
    beforeEach(async () => {
      const add = (name: string, priceCents: number, stock: number, discountPercent = 0) =>
        post(
          '/api/product/create',
          admin,
          productBody({ name, priceCents, stock, discountPercent }),
        );
      await add('Alpha Lamp', 1000, 5);
      await add('Beta Lamp', 3000, 0);
      await add('Gamma (Special) [Lamp]', 2000, 1);
      await add('Delta .* Dish', 4000, 2, 50);
    });
    const list = async (query: Record<string, string>) =>
      (await http().get('/api/product').query(query)).body.data;
    const names = (d: Page) => d.items.map((p: Item) => p.name);

    it('searches case-insensitively by name', async () => {
      expect(names(await list({ q: 'lamp', sort: 'name' }))).toEqual([
        'Alpha Lamp',
        'Beta Lamp',
        'Gamma (Special) [Lamp]',
      ]);
    });
    it('treats regex metacharacters in the search as literal text', async () => {
      expect(names(await list({ q: '.*' }))).toEqual(['Delta .* Dish']);
      expect(names(await list({ q: '(Special)' }))).toEqual(['Gamma (Special) [Lamp]']);
      expect((await list({ q: '[x' })).total).toBe(0);
      expect((await list({ q: '^Alpha' })).total).toBe(0);
    });
    it('filters by price range on the sale price', async () => {
      // sale prices: Alpha 1000, Beta 3000, Gamma 2000, Delta 2000 (4000 at 50% off), Bowl 4000, Demo 9000
      const r = await list({ minPrice: '1500', maxPrice: '2500', sort: 'name' });
      expect(names(r)).toEqual(['Delta .* Dish', 'Gamma (Special) [Lamp]']);
    });
    it('filters by stock', async () => {
      const inStock = await list({ inStock: 'true', limit: '50' });
      expect(inStock.items.every((p: Item) => p.stock > 0)).toBe(true);
      const out = await list({ inStock: 'false' });
      expect(names(out)).toEqual(['Beta Lamp']);
    });
    it('filters by category and brand', async () => {
      expect((await list({ categoryId })).total).toBe(5);
      expect((await list({ brandId: demoBrandId })).total).toBe(1);
    });
    it('sorts', async () => {
      const asc = (await list({ sort: 'price-asc', limit: '50' })).items.map(
        (p: Item) => p.salePriceCents,
      );
      expect(asc).toEqual([...asc].sort((a, b) => a - b));
      const desc = (await list({ sort: 'price-desc', limit: '50' })).items.map(
        (p: Item) => p.salePriceCents,
      );
      expect(desc).toEqual([...desc].sort((a, b) => b - a));
      expect(names(await list({ sort: 'newest', limit: '1' }))).toEqual(['Delta .* Dish']);
    });
    it('paginates with totals', async () => {
      const p1 = await list({ limit: '4', page: '1', sort: 'name' });
      const p2 = await list({ limit: '4', page: '2', sort: 'name' });
      const p9 = await list({ limit: '4', page: '9', sort: 'name' });
      expect([p1.total, p1.totalPages, p1.items.length]).toEqual([6, 2, 4]);
      expect(p2.items.length).toBe(2);
      expect(new Set([...names(p1), ...names(p2)]).size).toBe(6);
      expect(p9).toMatchObject({ items: [], total: 6, page: 9 });
    });
    it('rejects out-of-range paging', async () => {
      expect((await http().get('/api/product?limit=500')).status).toBe(400);
      expect((await http().get('/api/product?page=0')).status).toBe(400);
    });
    it('returns an empty page, not an error, when nothing matches', async () => {
      expect(await list({ q: 'zzzz' })).toMatchObject({ items: [], total: 0, totalPages: 1 });
    });
  });
});
