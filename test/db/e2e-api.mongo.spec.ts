import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { hashPassword } from '../../src/auth/password';
import { loadEnv } from '../../src/config/env';
import { MailMessage, MailSender } from '../../src/mail/mail-sender';
import { seedUsers } from '../../src/seed/seed-users';
import { Role } from '../../src/users/role';
import { UsersService } from '../../src/users/users.service';

/*
 * End to end against a REAL MongoDB: the production AppModule (real Mongoose repositories, guards,
 * validation, throttling, audit) over HTTP. Nothing is mocked except the outgoing email, which is
 * captured so the verification code can be read. Restarts the application to prove persistence.
 *
 * Runs only when MONGODB_TEST_URI is set and its database name contains "test"; that database is
 * emptied first. The development database (MONGODB_URI) is never touched.
 */
const uri = process.env.MONGODB_TEST_URI;
const dbName = uri
  ? new URL(uri.replace(/^mongodb(\+srv)?:/, 'http:')).pathname.slice(1) || ''
  : '';
const suite = uri && /test/i.test(dbName) ? describe : describe.skip;
jest.setTimeout(120_000);

const SECRET = 'e2e-secret-'.padEnd(48, 'x');
const ADMIN = { email: 'e2e-admin@example.com', password: 'E2e-Admin-Password-1' };
const DEMO_PASSWORD = 'E2e-Demo-Password-1';
const SHIP = { address: '12 Linden Street, Oslo', phone: '+47 912 34 567' };

class CapturingMail extends MailSender {
  readonly sent: MailMessage[] = [];
  async send(m: MailMessage) {
    this.sent.push(m);
  }
  codeFor(email: string) {
    const m = [...this.sent].reverse().find((x) => x.to === email);
    return /\b(\d{6})\b/.exec(m?.text ?? '')?.[1] ?? '';
  }
}

suite('NOMA API end to end on a real MongoDB', () => {
  const env = loadEnv({
    NODE_ENV: 'test',
    MONGODB_URI: uri,
    JWT_SECRET: SECRET,
    CORS_ORIGINS: 'http://localhost:5173',
    THROTTLE_LIMIT: '100000',
  });
  const mail = new CapturingMail();
  let app: INestApplication;

  const start = async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(env)] })
      .overrideProvider(MailSender)
      .useValue(mail)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app, env);
    await app.init();
  };
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (email: string, password: string) => {
    const r = await http().post('/api/auth/login').send({ email, password });
    expect(r.status).toBe(200);
    return r.body.data.Credentials as { accessToken: string; refreshToken: string };
  };

  // Shared across the ordered steps below (each step builds on the previous one, like a real session).
  let admin: string;
  let customer: string;
  let viewer: string;
  let customerRefresh: string;
  let productId: string;
  let scarceId: string;
  let paidOrderId: string;
  let couponId: string;

  beforeAll(async () => {
    await start();
    const conn = app.get<Connection>(getConnectionToken());
    expect(conn.db?.databaseName).toBe(dbName); // never the development database
    await Promise.all(Object.values(conn.collections).map((c) => c.deleteMany({})));
    await seedUsers(app.get(UsersService), {
      adminEmail: ADMIN.email,
      adminPassword: ADMIN.password,
      demoPassword: DEMO_PASSWORD,
    });
    admin = (await login(ADMIN.email, ADMIN.password)).accessToken;
    viewer = (await login('demo-viewer@example.com', DEMO_PASSWORD)).accessToken;
  });
  afterAll(async () => {
    await app?.close();
  });

  it('registers a customer: signup, emailed code, verification, login, profile (no hash leaks)', async () => {
    const email = 'e2e-customer@example.com';
    const password = 'E2e-Customer-Password-1';
    expect(
      (await http().post('/api/auth/signup').send({ email, password, name: 'E2E Customer' }))
        .status,
    ).toBe(202);
    // A client cannot choose its own role.
    expect(
      (
        await http()
          .post('/api/auth/signup')
          .send({ email: 'x@example.com', password, name: 'X', role: 'ADMIN' })
      ).status,
    ).toBe(400);
    expect((await http().post('/api/auth/login').send({ email, password })).status).toBe(403); // right password, unverified email
    expect(
      (
        await http()
          .post('/api/auth/verify-email')
          .send({ email, code: mail.codeFor(email) })
      ).status,
    ).toBe(200);
    const creds = await login(email, password);
    customer = creds.accessToken;
    customerRefresh = creds.refreshToken;
    const me = await http().get('/api/auth/profile').set(bearer(customer));
    expect(me.body.data).toMatchObject({ email, role: 'CUSTOMER' });
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash|scrypt/);

    const conn = app.get<Connection>(getConnectionToken());
    const stored = await conn.collection('users').findOne({ email });
    expect(stored?.passwordHash).toMatch(/^scrypt\$/); // hashed, never the plain password
    expect(JSON.stringify(stored)).not.toContain(password);
  });

  it('rejects a wrong password, a missing, a forged and an expired token', async () => {
    expect(
      (
        await http()
          .post('/api/auth/login')
          .send({ email: ADMIN.email, password: 'wrong-password-123' })
      ).status,
    ).toBe(401);
    expect((await http().get('/api/auth/profile')).status).toBe(401);
    const forged = jwt.sign({ ver: 0 }, 'z'.repeat(48), {
      subject: 'a'.repeat(24),
      issuer: 'nestapp-fullstack',
    });
    expect((await http().get('/api/auth/profile').set(bearer(forged))).status).toBe(401);
    const me = await http().get('/api/auth/profile').set(bearer(admin));
    const expired = jwt.sign({ ver: 0 }, SECRET, {
      subject: me.body.data.id,
      issuer: 'nestapp-fullstack',
      expiresIn: -10,
    });
    expect((await http().get('/api/auth/profile').set(bearer(expired))).status).toBe(401);
  });

  it('lets only the admin build the catalogue; search, filter, sort and paging read MongoDB', async () => {
    const product = { images: ['/catalogue/dune-stoneware-vase.jpg'], description: 'E2E.' };
    for (const t of [customer, viewer]) {
      expect(
        (await http().post('/api/category/create').set(bearer(t)).send({ name: 'Nope' })).status,
      ).toBe(403);
    }
    const categoryId = (
      await http().post('/api/category/create').set(bearer(admin)).send({ name: 'Ceramics' })
    ).body.data.id;
    const brandId = (
      await http().post('/api/brand/create').set(bearer(admin)).send({ name: 'Wadi Works' })
    ).body.data.id;
    const mk = async (name: string, priceCents: number, discountPercent: number, stock: number) => {
      const r = await http()
        .post('/api/product/create')
        .set(bearer(admin))
        .send({ ...product, name, priceCents, discountPercent, stock, categoryId, brandId });
      expect(r.status).toBe(201);
      return r.body.data.id as string;
    };
    productId = await mk('Dune Vase', 8000, 25, 10); // sale price 6000
    scarceId = await mk('Last Few Bowls', 2000, 0, 3);
    await mk('Amber Tumbler', 3200, 0, 0);

    const search = await http().get('/api/product?q=dune');
    expect(search.body.data.items.map((p: { name: string }) => p.name)).toEqual(['Dune Vase']);
    expect(search.body.data.items[0]).toMatchObject({
      priceCents: 8000,
      salePriceCents: 6000,
      inStock: true,
    });
    const sorted = await http().get(
      `/api/product?categoryId=${categoryId}&sort=price-asc&limit=2&page=1`,
    );
    expect(sorted.body.data).toMatchObject({ total: 3, totalPages: 2 });
    expect(sorted.body.data.items.map((p: { name: string }) => p.name)).toEqual([
      'Last Few Bowls',
      'Amber Tumbler',
    ]);
    expect((await http().get('/api/product?inStock=false')).body.data.items).toHaveLength(1);
    expect((await http().get('/api/product?sort=random')).status).toBe(400);
    expect((await http().get('/api/product/not-an-id')).status).toBe(400);
    expect((await http().get(`/api/product/${'f'.repeat(24)}`)).status).toBe(404);
    // A client cannot set the sale price; an unsafe image reference is refused.
    expect(
      (
        await http()
          .patch(`/api/product/${productId}`)
          .set(bearer(admin))
          .send({ salePriceCents: 1 })
      ).status,
    ).toBe(400);
    expect(
      (
        await http()
          .patch(`/api/product/${productId}`)
          .set(bearer(admin))
          .send({ images: ['javascript:alert(1)'] })
      ).status,
    ).toBe(400);
  });

  it('prices the cart on the server, validates quantities and stock, and applies a coupon', async () => {
    expect(
      (
        await http()
          .post('/api/cart')
          .set(bearer(customer))
          .send({ productId, quantity: 2, priceCents: 1 })
      ).status,
    ).toBe(400);
    expect(
      (await http().post('/api/cart').set(bearer(customer)).send({ productId, quantity: 0 }))
        .status,
    ).toBe(400);
    expect(
      (await http().post('/api/cart').set(bearer(customer)).send({ productId, quantity: 11 }))
        .status,
    ).toBe(409);
    expect(
      (await http().post('/api/cart').set(bearer(customer)).send({ productId, quantity: 2 }))
        .status,
    ).toBe(201);
    expect(
      (await http().patch(`/api/cart/${productId}`).set(bearer(customer)).send({ quantity: 3 }))
        .status,
    ).toBe(200);

    const coupon = await http()
      .post('/api/coupon')
      .set(bearer(admin))
      .send({
        code: 'e2e10',
        discountPercent: 10,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
    expect(coupon.status).toBe(201);
    couponId = coupon.body.data.id;
    expect(
      (
        await http()
          .post('/api/coupon')
          .set(bearer(admin))
          .send({
            code: 'E2E10',
            discountPercent: 5,
            expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          })
      ).status,
    ).toBe(409);
    expect(
      (
        await http()
          .post('/api/coupon')
          .set(bearer(customer))
          .send({
            code: 'MINE90',
            discountPercent: 90,
            expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          })
      ).status,
    ).toBe(403);
    expect(
      (await http().post('/api/cart/apply-coupon').set(bearer(customer)).send({ code: 'NOPE99' }))
        .status,
    ).toBe(400);
    const applied = await http()
      .post('/api/cart/apply-coupon')
      .set(bearer(customer))
      .send({ code: 'e2e10' });
    // 3 × 6000 = 18000; 10 % = 1800
    expect(applied.body.data).toMatchObject({
      subtotalCents: 18000,
      discountCents: 1800,
      totalCents: 16200,
    });
  });

  it('places an order, reserves stock, pays once (simulated), and refunds with stock restored', async () => {
    const placed = await http().post('/api/order').set(bearer(customer)).send(SHIP);
    expect(placed.status).toBe(201);
    expect(placed.body.data).toMatchObject({
      status: 'PENDING_PAYMENT',
      paymentStatus: 'SIMULATED_UNPAID',
      totalCents: 16200,
    });
    paidOrderId = placed.body.data.id;
    expect((await http().get(`/api/product/${productId}`)).body.data.stock).toBe(7);
    expect((await http().get('/api/cart').set(bearer(customer))).body.data.items).toHaveLength(0);
    // Card-like data is refused outright.
    expect(
      (
        await http()
          .post(`/api/order/${paidOrderId}/simulate-payment`)
          .set(bearer(customer))
          .send({ card: '4242424242424242' })
      ).status,
    ).toBe(400);
    // Another user cannot see or pay it.
    expect((await http().get(`/api/order/${paidOrderId}`).set(bearer(viewer))).status).toBe(404);

    const [a, b] = await Promise.all([
      http().post(`/api/order/${paidOrderId}/simulate-payment`).set(bearer(customer)).send({}),
      http().post(`/api/order/${paidOrderId}/simulate-payment`).set(bearer(customer)).send({}),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]); // exactly one payment wins
    const paid = (a.status === 200 ? a : b).body.data;
    expect(paid).toMatchObject({ status: 'PAID', paymentStatus: 'SIMULATED_PAID' });
    expect(JSON.stringify(paid.payment)).toMatch(/SIMULATED/);

    expect(
      (
        await http()
          .patch(`/api/order/${paidOrderId}/status`)
          .set(bearer(admin))
          .send({ status: 'DELIVERED' })
      ).status,
    ).toBe(409); // must ship first
    const refund = await http()
      .post(`/api/order/${paidOrderId}/refund`)
      .set(bearer(admin))
      .send({});
    expect(refund.body.data).toMatchObject({
      status: 'CANCELLED',
      paymentStatus: 'SIMULATED_REFUNDED',
    });
    expect((await http().get(`/api/product/${productId}`)).body.data.stock).toBe(10);
    expect(
      (await http().post(`/api/order/${paidOrderId}/refund`).set(bearer(admin)).send({})).status,
    ).toBe(409);
  });

  it('never oversells: six customers race for three units and exactly three orders succeed', async () => {
    const users = app.get(UsersService);
    const tokens: string[] = [];
    for (let i = 0; i < 6; i++) {
      const email = `e2e-racer-${i}@example.com`;
      await users.create({
        email,
        name: `Racer ${i}`,
        passwordHash: await hashPassword('E2e-Racer-Password-1'),
        role: Role.CUSTOMER,
        isDemo: false,
        emailVerified: true,
      });
      tokens.push((await login(email, 'E2e-Racer-Password-1')).accessToken);
    }
    for (const t of tokens) {
      expect(
        (await http().post('/api/cart').set(bearer(t)).send({ productId: scarceId, quantity: 1 }))
          .status,
      ).toBe(201);
    }
    const results = await Promise.all(
      tokens.map((t) => http().post('/api/order').set(bearer(t)).send(SHIP)),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(3);
    expect(statuses.filter((s) => s === 409)).toHaveLength(3);
    expect((await http().get(`/api/product/${scarceId}`)).body.data.stock).toBe(0);
  });

  it('keeps the demo viewer read-only and the admin figures derived from the database', async () => {
    expect((await http().get('/api/admin/stats').set(bearer(viewer))).status).toBe(200);
    for (const [method, path, body] of [
      ['patch', `/api/product/${productId}/stock`, { change: 5 }],
      ['delete', `/api/product/${productId}`, {}],
      ['patch', `/api/coupon/${couponId}`, { active: false }],
      ['patch', `/api/order/${paidOrderId}/status`, { status: 'SHIPPED' }],
    ] as const) {
      expect((await http()[method](path).set(bearer(viewer)).send(body)).status).toBe(403);
    }
    expect((await http().get('/api/admin/stats').set(bearer(customer))).status).toBe(403);
    const stats = (await http().get('/api/admin/stats').set(bearer(admin))).body.data;
    expect(stats.orders.total).toBe(4); // 1 refunded + 3 racers
    expect(stats.simulatedRefundedCents).toBe(16200);
    expect(stats.products).toMatchObject({ total: 3, outOfStock: 2 });
  });

  it('persists everything across an API restart', async () => {
    await app.close();
    await start(); // a brand-new application instance on the same database

    const order = await http().get(`/api/order/${paidOrderId}`).set(bearer(customer));
    expect(order.body.data).toMatchObject({
      status: 'CANCELLED',
      paymentStatus: 'SIMULATED_REFUNDED',
      totalCents: 16200,
    });
    expect((await http().get(`/api/product/${productId}`)).body.data).toMatchObject({
      name: 'Dune Vase',
      stock: 10,
    });
    const coupons = await http().get('/api/coupon').set(bearer(admin));
    expect(coupons.body.data[0]).toMatchObject({
      code: 'E2E10',
      ordersPlaced: 1,
      status: 'ACTIVE',
    });
    // The refresh token issued before the restart still rotates (sessions live in MongoDB).
    const refreshed = await http()
      .post('/api/auth/refresh')
      .send({ refreshToken: customerRefresh });
    expect(refreshed.status).toBe(200);
    // Every admin write was audited, and the log survived the restart.
    const audit = await http().get('/api/admin/audit?limit=50').set(bearer(admin));
    const actions = audit.body.data.items.map((e: { action: string }) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(['product.create', 'coupon.create', 'order.refund']),
    );
  });
});
