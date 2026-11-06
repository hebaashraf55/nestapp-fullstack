import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  BrandController,
  CategoryController,
  ProductController,
} from '../src/catalogue/catalogue.controllers';
import { displayName } from '../src/reviews/reviews.service';
import { Role } from '../src/users/role';
import { AuthTestApp, createAuthApp } from './helpers/create-auth-app';

jest.setTimeout(30_000);

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const SHIP = { address: '12 Linden Street, Oslo', phone: '+47 912 34 567' };
const REVIEW = { rating: 4, title: 'Lovely glaze', body: 'Heavier than expected, in a good way.' };

describe('product reviews', () => {
  let t: AuthTestApp;
  let app: INestApplication;
  let admin: string;
  let alice: { id: string; token: string };
  let bob: { id: string; token: string };
  let viewer: string;
  let productId: string;
  let demoProductId: string;

  const http = () => request(app.getHttpServer());
  const write = (token: string, body: object = REVIEW, pid = productId) =>
    http().post(`/api/product/${pid}/reviews`).set(bearer(token)).send(body);
  const moderate = (id: string, status: string, note?: string) =>
    http()
      .patch(`/api/reviews/${id}/moderation`)
      .set(bearer(admin))
      .send(note === undefined ? { status } : { status, note });
  const list = (query = '', token?: string) => {
    const r = http().get(`/api/product/${productId}/reviews${query}`);
    return token ? r.set(bearer(token)) : r;
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
    const mk = async (name: string) =>
      (
        await http()
          .post('/api/product/create')
          .set(bearer(admin))
          .send({
            name,
            images: ['/catalogue/x.jpg'],
            priceCents: 1000,
            stock: 9,
            categoryId,
            brandId,
          })
      ).body.data.id as string;
    productId = await mk('Dune Vase');
    demoProductId = await mk('Synthetic Bowl');
    t.products.records.get(demoProductId)!.isDemo = true;
  });
  afterEach(() => app.close());

  it('holds new reviews for moderation and shows only approved ones publicly', async () => {
    const created = await write(alice.token).expect(201);
    expect(created.body.data).toMatchObject({ status: 'PENDING', verifiedPurchase: false });
    const before = (await list().expect(200)).body.data;
    expect(before.items).toEqual([]);
    expect(before.summary).toEqual({ average: null, count: 0, distribution: [0, 0, 0, 0, 0] });
    // The author still sees their own pending review.
    expect((await list('', alice.token)).body.data.mine).toMatchObject({ status: 'PENDING' });

    await moderate(created.body.data.id, 'APPROVED').expect(200);
    const after = (await list()).body.data;
    expect(after.items).toHaveLength(1);
    expect(after.items[0]).not.toHaveProperty('userId');
    expect(after.items[0]).not.toHaveProperty('status');
    expect(after.summary).toEqual({ average: 4, count: 1, distribution: [0, 0, 0, 1, 0] });
  });

  it('marks a review as a verified purchase only after a paid order', async () => {
    await http()
      .post('/api/cart')
      .set(bearer(bob.token))
      .send({ productId, quantity: 1 })
      .expect(201);
    const order = (await http().post('/api/order').set(bearer(bob.token)).send(SHIP).expect(201))
      .body.data;
    // Unpaid: not verified.
    const first = await write(bob.token).expect(201);
    expect(first.body.data.verifiedPurchase).toBe(false);
    await http()
      .post(`/api/order/${order.id}/simulate-payment`)
      .set(bearer(bob.token))
      .send({})
      .expect(200);
    // Editing re-checks against the orders: now verified, and back to moderation.
    const edited = await http()
      .patch(`/api/reviews/${first.body.data.id}`)
      .set(bearer(bob.token))
      .send(REVIEW)
      .expect(200);
    expect(edited.body.data).toMatchObject({ verifiedPurchase: true, status: 'PENDING' });
  });

  it('refuses a client-supplied verified flag, rating out of range and empty text', async () => {
    expect((await write(alice.token, { ...REVIEW, verifiedPurchase: true })).status).toBe(400);
    expect((await write(alice.token, { ...REVIEW, rating: 6 })).status).toBe(400);
    expect((await write(alice.token, { ...REVIEW, rating: 3.5 })).status).toBe(400);
    expect((await write(alice.token, { ...REVIEW, body: '   short ' })).status).toBe(400);
    expect((await write(alice.token, { ...REVIEW, title: 'a\u0000b' })).status).toBe(400);
  });

  it('allows one review per customer per product (409), and only customers write', async () => {
    await write(alice.token).expect(201);
    expect((await write(alice.token)).status).toBe(409);
    expect((await write(admin)).status).toBe(403);
    expect((await write(viewer, REVIEW, demoProductId)).status).toBe(403);
    expect((await http().post(`/api/product/${productId}/reviews`).send(REVIEW)).status).toBe(401);
    expect((await write(alice.token, REVIEW, 'f'.repeat(24))).status).toBe(404);
  });

  it('only the author edits; author or admin deletes; others get 404', async () => {
    const id = (await write(alice.token).expect(201)).body.data.id;
    const asBob = await http().patch(`/api/reviews/${id}`).set(bearer(bob.token)).send(REVIEW);
    expect(asBob.status).toBe(404);
    expect((await http().delete(`/api/reviews/${id}`).set(bearer(bob.token))).status).toBe(404);
    await http().delete(`/api/reviews/${id}`).set(bearer(alice.token)).expect(200);
    const again = (await write(alice.token).expect(201)).body.data.id;
    await http().delete(`/api/reviews/${again}`).set(bearer(admin)).expect(200);
  });

  it('sends an edited review back to moderation and clears the old decision', async () => {
    const id = (await write(alice.token).expect(201)).body.data.id;
    await moderate(id, 'REJECTED', 'Please describe the product itself.').expect(200);
    const mine = (await list('', alice.token)).body.data.mine;
    expect(mine).toMatchObject({
      status: 'REJECTED',
      moderationNote: 'Please describe the product itself.',
    });
    await http()
      .patch(`/api/reviews/${id}`)
      .set(bearer(alice.token))
      .send({ ...REVIEW, rating: 5 })
      .expect(200);
    expect((await list('', alice.token)).body.data.mine).toMatchObject({
      status: 'PENDING',
      moderationNote: null,
      rating: 5,
    });
  });

  it('sorts and paginates approved reviews', async () => {
    for (const [i, rating] of [3, 5, 1].entries()) {
      const u = await t.login(Role.CUSTOMER);
      const id = (await write(u.token, { ...REVIEW, rating, title: `Review ${i}` }).expect(201))
        .body.data.id;
      await moderate(id, 'APPROVED').expect(200);
    }
    const ratings = async (q: string) =>
      (await list(q)).body.data.items.map((r: { rating: number }) => r.rating);
    expect(await ratings('?sort=highest')).toEqual([5, 3, 1]);
    expect(await ratings('?sort=lowest')).toEqual([1, 3, 5]);
    expect(await ratings('?sort=newest')).toEqual([1, 5, 3]);
    const paged = (await list('?limit=2&page=2')).body.data;
    expect(paged).toMatchObject({ total: 3, totalPages: 2, page: 2 });
    expect(paged.summary).toMatchObject({ average: 3, count: 3 });
    expect((await list('?sort=random')).status).toBe(400);
  });

  describe('moderation queue', () => {
    it('lists by status for admins; the demo viewer sees synthetic products only and cannot decide', async () => {
      const real = (await write(alice.token).expect(201)).body.data.id;
      await write(bob.token, REVIEW, demoProductId).expect(201);
      const all = await http()
        .get('/api/reviews/moderation?status=PENDING')
        .set(bearer(admin))
        .expect(200);
      expect(all.body.data.total).toBe(2);
      expect(all.body.data.items[1].product).toEqual({ id: productId, name: 'Dune Vase' });
      const demo = await http().get('/api/reviews/moderation').set(bearer(viewer)).expect(200);
      expect(demo.body.data.items.map((r: { productId: string }) => r.productId)).toEqual([
        demoProductId,
      ]);
      expect(
        (
          await http()
            .patch(`/api/reviews/${real}/moderation`)
            .set(bearer(viewer))
            .send({ status: 'APPROVED' })
        ).status,
      ).toBe(403);
      expect((await http().get('/api/reviews/moderation').set(bearer(alice.token))).status).toBe(
        403,
      );
      expect((await moderate(real, 'MAYBE')).status).toBe(400);
      expect((await moderate('a'.repeat(24), 'APPROVED')).status).toBe(404);
    });
  });

  it('publishes a short display name, never the full name or email', () => {
    expect(displayName('Ada Lovelace')).toBe('Ada L.');
    expect(displayName('  Ada  ')).toBe('Ada');
    expect(displayName('Ada Augusta King lovelace')).toBe('Ada L.');
    expect(displayName('')).toBe('Customer');
  });
});
