import { INestApplication } from '@nestjs/common';
import { AddressInfo } from 'node:net';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { MemoryStore } from '../src/cache/cache.service';
import {
  BrandController,
  CategoryController,
  ProductController,
} from '../src/catalogue/catalogue.controllers';
import { redact, redactText } from '../src/common/redact';
import { backoffMs } from '../src/jobs/jobs.service';
import { Role } from '../src/users/role';
import { AuthTestApp, createAuthApp } from './helpers/create-auth-app';

jest.setTimeout(30_000);

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const SHIP = { address: '12 Linden Street, Oslo', phone: '+47 912 34 567' };

describe('operations: request ids, versioning, health, cache, jobs, search, real-time', () => {
  let t: AuthTestApp;
  let app: INestApplication;
  let admin: string;
  let alice: { id: string; token: string };
  let categoryId: string;
  let brandId: string;

  const http = () => request(app.getHttpServer());
  const mk = async (name: string, over: object = {}) =>
    (
      await http()
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
        })
        .expect(201)
    ).body.data.id as string;

  beforeEach(async () => {
    t = await createAuthApp([BrandController, CategoryController, ProductController]);
    app = t.app;
    admin = (await t.login(Role.ADMIN)).token;
    alice = await t.login(Role.CUSTOMER);
    categoryId = (
      await http().post('/api/category/create').set(bearer(admin)).send({ name: 'Ceramics' })
    ).body.data.id;
    brandId = (
      await http().post('/api/brand/create').set(bearer(admin)).send({ name: 'Wadi Works' })
    ).body.data.id;
  });
  afterEach(() => app.close());

  describe('request ids and versioning', () => {
    it('gives every response a request id, keeping a well-formed incoming one', async () => {
      const fresh = await http().get('/api/health').expect(200);
      expect(fresh.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      const kept = await http()
        .get('/api/health')
        .set('X-Request-Id', 'proxy-abc-12345')
        .expect(200);
      expect(kept.headers['x-request-id']).toBe('proxy-abc-12345');
      const replaced = await http()
        .get('/api/health')
        .set('X-Request-Id', 'bad id <script>')
        .expect(200);
      expect(replaced.headers['x-request-id']).not.toContain('<');
    });

    it('serves /api/v1 as the current version, with /api as its alias', async () => {
      const v1 = await http().get('/api/v1/category').expect(200);
      expect(v1.headers['api-version']).toBe('1');
      expect(v1.body.data.map((c: { name: string }) => c.name)).toEqual(['Ceramics']);
      await http()
        .post('/api/v1/category/create')
        .set(bearer(admin))
        .send({ name: 'Lighting' })
        .expect(201);
      expect((await http().get('/api/category')).body.data).toHaveLength(2);
      expect((await http().get('/api/v1/nope')).status).toBe(404);
      expect((await http().get('/api/v2/category')).status).toBe(404);
    });
  });

  describe('health', () => {
    it('reports liveness and readiness without revealing infrastructure details', async () => {
      expect((await http().get('/api/health/live').expect(200)).body.data).toEqual({
        status: 'ok',
      });
      const ready = (await http().get('/api/v1/health/ready').expect(200)).body.data;
      expect(ready).toEqual({
        status: 'ready',
        checks: { database: 'not-configured', cache: 'memory', jobsWorker: 'off' },
      });
    });
  });

  describe('redaction', () => {
    it('removes passwords, tokens, codes and credentials from logged text and objects', () => {
      expect(redactText('mongodb+srv://noma:S3cret!@cluster0.x.mongodb.net/noma')).toBe(
        'mongodb+srv://<redacted>@cluster0.x.mongodb.net/noma',
      );
      expect(redactText('Authorization: Bearer abc.def.ghi')).toBe(
        'Authorization: Bearer <redacted>',
      );
      expect(
        redactText('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJlLXZhbHVl'),
      ).toBe('token <jwt>');
      expect(redactText(`/track/abc#${'c'.repeat(32)}`)).toBe('/track/abc#<redacted>');
      expect(
        redact({
          email: 'a@b.co',
          password: 'x',
          nested: { refreshToken: 'y', code: '123456', note: 'ok' },
        }),
      ).toEqual({
        email: 'a@b.co',
        password: '[REDACTED]',
        nested: { refreshToken: '[REDACTED]', code: '[REDACTED]', note: 'ok' },
      });
    });
  });

  describe('cache', () => {
    it('expires entries and drops them by prefix', () => {
      const store = new MemoryStore(3);
      let now = 0;
      store.now = () => now;
      store.set('catalogue:home:all', '1', 10);
      store.set('catalogue:home:demo', '2', 10);
      store.set('other', '3', 10);
      store.delPrefix('catalogue:');
      expect([store.get('catalogue:home:all'), store.get('other')]).toEqual([null, '3']);
      now = 11_000;
      expect(store.get('other')).toBeNull();
      for (const k of ['a', 'b', 'c', 'd']) store.set(k, k, 10);
      expect(store.size).toBe(3); // bounded
    });

    it('serves the homepage from the cache and refreshes it after a catalogue change', async () => {
      const id = await mk('Dune Vase');
      const before = t.cache.hits;
      await http().get('/api/catalogue/home').expect(200);
      await http().get('/api/catalogue/home').expect(200);
      expect(t.cache.hits).toBe(before + 1);
      await http()
        .patch(`/api/product/${id}`)
        .set(bearer(admin))
        .send({ name: 'Dune Tall Vase' })
        .expect(200);
      const home = (await http().get('/api/catalogue/home').expect(200)).body.data;
      expect(home.categories[0].products[0].name).toBe('Dune Tall Vase');
    });
  });

  describe('background jobs', () => {
    it('sends queued email, then forgets the message text', async () => {
      await t.jobsService.enqueue('mail.send', {
        to: 'a@example.com',
        subject: 'Hi',
        text: 'secret link',
      });
      expect(await t.jobsService.runDue()).toBe(1);
      expect(t.mail.sent.at(-1)).toMatchObject({ to: 'a@example.com', subject: 'Hi' });
      const [job] = [...t.jobs.records.values()];
      expect(job).toMatchObject({ status: 'DONE', payload: null, attempts: 1 });
    });

    it('retries with growing back-off, then marks the job dead; an admin can retry it', async () => {
      let calls = 0;
      t.jobsService.register('flaky', async () => {
        calls++;
        throw new Error('smtp://user:pw@mail.example.com refused');
      });
      let now = Date.now();
      t.jobsService.now = () => now;
      const id = await t.jobsService.enqueue('flaky', {}, { maxAttempts: 3 });
      await t.jobsService.runDue();
      expect(t.jobs.records.get(id)).toMatchObject({ status: 'PENDING', attempts: 1 });
      expect(t.jobs.records.get(id)!.lastError).toBe('smtp://<redacted>@mail.example.com refused');
      expect(await t.jobsService.runDue()).toBe(0); // not due yet
      for (let i = 0; i < 2; i++) {
        now += 60 * 60 * 1000;
        await t.jobsService.runDue();
      }
      expect(calls).toBe(3);
      expect(t.jobs.records.get(id)!.status).toBe('DEAD');

      const list = (await http().get('/api/admin/jobs?status=DEAD').set(bearer(admin)).expect(200))
        .body.data;
      expect(list.counts.DEAD).toBe(1);
      expect(list.items[0]).not.toHaveProperty('payload');
      expect((await http().get('/api/admin/jobs').set(bearer(alice.token))).status).toBe(403);
      await http().post(`/api/admin/jobs/${id}/retry`).set(bearer(admin)).send({}).expect(200);
      expect(t.jobs.records.get(id)).toMatchObject({ status: 'PENDING', attempts: 0 });
      expect(
        (await http().post(`/api/admin/jobs/${id}/retry`).set(bearer(admin)).send({})).status,
      ).toBe(404);
    });

    it('backs off 10 s, 20 s, 40 s… capped at an hour', () => {
      const mid = () => 0.5;
      expect([1, 2, 3].map((a) => backoffMs(a, mid))).toEqual([10_000, 20_000, 40_000]);
      expect(backoffMs(30, mid)).toBe(60 * 60 * 1000);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await mk('Stoneware Mug', { specs: { material: 'Clay' } });
      await mk('Linen Throw', { description: 'Pairs well with a stoneware mug.' });
      await mk('Clay Planter', { specs: { material: 'Stoneware' }, stock: 0, discountPercent: 20 });
    });

    it('ranks name matches first, and falls back to partial matches', async () => {
      const ranked = (await http().get('/api/product?q=stoneware&sort=relevance').expect(200)).body
        .data.items;
      expect(ranked.map((p: { name: string }) => p.name)).toEqual([
        'Stoneware Mug',
        'Clay Planter',
        'Linen Throw',
      ]);
      const partial = (await http().get('/api/product?q=stonew&sort=relevance').expect(200)).body
        .data;
      expect(partial.total).toBe(3);
    });

    it('suggests products and categories as you type, with input limits', async () => {
      const s = (await http().get('/api/product/suggest?q=cera').expect(200)).body.data;
      expect(s.categories).toEqual([expect.objectContaining({ name: 'Ceramics' })]);
      const p = (await http().get('/api/product/suggest?q=linen').expect(200)).body.data;
      expect(p.products).toEqual([
        expect.objectContaining({ name: 'Linen Throw', salePriceCents: 1000 }),
      ]);
      expect((await http().get('/api/product/suggest?q=a')).status).toBe(400);
      expect((await http().get(`/api/product/suggest?q=${'x'.repeat(41)}`)).status).toBe(400);
    });

    it('counts filters for the current search, each list ignoring its own selection', async () => {
      const other = (
        await http().post('/api/category/create').set(bearer(admin)).send({ name: 'Textiles' })
      ).body.data.id;
      await mk('Wool Throw', { categoryId: other });
      const f = (await http().get(`/api/product/facets?categoryId=${categoryId}`).expect(200)).body
        .data;
      expect(f.total).toBe(3);
      expect(f.categories.map((c: { name: string; count: number }) => [c.name, c.count])).toEqual([
        ['Ceramics', 3],
        ['Textiles', 1],
      ]);
      expect(f).toMatchObject({
        inStock: 2,
        onSale: 1,
        price: { minCents: 800, maxCents: 1000 },
        truncated: false,
      });
      expect((await http().get('/api/product/facets?q=throw').expect(200)).body.data.total).toBe(2);
    });
  });

  describe('real-time', () => {
    let url: string;
    const sockets: Socket[] = [];
    const connect = (token?: string) =>
      new Promise<Socket>((resolve, reject) => {
        const s = io(url, {
          path: '/api/socket',
          transports: ['websocket'],
          auth: token ? { token } : {},
          forceNew: true,
        });
        sockets.push(s);
        s.on('connect', () => setTimeout(() => resolve(s), 100)); // let the server finish joining rooms
        s.on('connect_error', reject);
      });
    const next = (s: Socket, event: string, ms = 1500) =>
      new Promise<unknown>((resolve) => {
        const timer = setTimeout(() => resolve(null), ms);
        s.once(event, (data) => {
          clearTimeout(timer);
          resolve(data);
        });
      });

    beforeEach(async () => {
      await app.listen(0);
      url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    });
    afterEach(() => {
      for (const s of sockets.splice(0)) s.disconnect();
    });

    it('delivers a customer’s own notifications and order updates, and nobody else’s', async () => {
      const id = await mk('Dune Vase');
      const mine = await connect(alice.token);
      const stranger = await connect((await t.login(Role.CUSTOMER)).token);
      const anonymous = await connect();
      await http()
        .post('/api/cart')
        .set(bearer(alice.token))
        .send({ productId: id, quantity: 1 })
        .expect(201);
      const order = (
        await http().post('/api/order').set(bearer(alice.token)).send(SHIP).expect(201)
      ).body.data;
      const paid = next(mine, 'order.updated');
      await http()
        .post(`/api/order/${order.id}/simulate-payment`)
        .set(bearer(alice.token))
        .send({})
        .expect(200);
      expect(await paid).toEqual({ id: order.id, status: 'PAID' });
      const note = next(mine, 'notification');
      const leak1 = next(stranger, 'notification', 800);
      const leak2 = next(anonymous, 'notification', 800);
      await http()
        .patch(`/api/order/${order.id}/status`)
        .set(bearer(admin))
        .send({ status: 'SHIPPED' })
        .expect(200);
      expect(await note).toMatchObject({ title: 'Your order is on its way', read: false });
      expect(await leak1).toBeNull();
      expect(await leak2).toBeNull();
    });

    it('treats a revoked token as anonymous, and lets anyone follow a product’s stock', async () => {
      const id = await mk('Dune Vase');
      await t.users.bumpTokenVersion(alice.id); // e.g. "sign out everywhere"
      const revoked = await connect(alice.token);
      expect(await revoked.emitWithAck('product.watch', 'nope')).toEqual({ ok: false });
      expect(await revoked.emitWithAck('product.watch', id)).toEqual({ ok: true });
      const stock = next(revoked, 'product.stock');
      const note = next(revoked, 'notification', 800);
      await http()
        .patch(`/api/product/${id}/stock`)
        .set(bearer(admin))
        .send({ change: 3, reason: 'RECEIVED' })
        .expect(200);
      expect(await stock).toEqual({ id, stock: 8, inStock: true });
      expect(await note).toBeNull();
    });

    it('lets only admins hear about new orders', async () => {
      const id = await mk('Dune Vase');
      const staff = await connect(admin);
      const customer = await connect(alice.token);
      const placed = next(staff, 'order.placed');
      const leak = next(customer, 'order.placed', 800);
      await http()
        .post('/api/cart')
        .set(bearer(alice.token))
        .send({ productId: id, quantity: 1 })
        .expect(201);
      await http().post('/api/order').set(bearer(alice.token)).send(SHIP).expect(201);
      expect(await placed).toMatchObject({ totalCents: 1000, currency: 'USD' });
      expect(await leak).toBeNull();
    });
  });
});
