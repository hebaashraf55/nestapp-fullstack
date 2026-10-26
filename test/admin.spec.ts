import { ModulesContainer, Reflector } from '@nestjs/core';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod, Type } from '@nestjs/common';
import request from 'supertest';
import { maskEmail, maskName } from '../src/admin/mask';
import { AUDITED, AuditedMeta } from '../src/audit/audited';
import { ROLES_KEY } from '../src/auth/decorators';
import type { OrderStatus, PaymentStatus } from '../src/orders/order-status';
import type { NewOrder } from '../src/orders/orders.repository';
import { Role } from '../src/users/role';
import { AuthTestApp, createAuthApp } from './helpers/create-auth-app';

jest.setTimeout(30_000);

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
interface Customer {
  id: string;
  displayName: string;
  maskedEmail: string;
  emailVerified: boolean;
  isDemo: boolean;
}
interface AdminOrder {
  id: string;
  status: string;
  isDemo: boolean;
  address: string;
  customer: { id: string; displayName: string; maskedEmail: string };
  payment: { mode: string; notice: string };
}
interface Stats {
  scope: string;
  customers: number;
  products: { total: number; outOfStock: number; lowStock: number; lowStockThreshold: number };
  orders: { total: number; byStatus: Record<string, number> };
  simulatedPaidCents: number;
  simulatedRefundedCents: number;
  notice: string;
}

describe('admin reporting and audit log', () => {
  let t: AuthTestApp;
  let admin: { id: string; token: string };
  let customer: { id: string; token: string };
  let viewer: { id: string; token: string };
  let demoCustomerId: string;

  const http = () => request(t.app.getHttpServer());
  const get = (path: string, token: string | null) => {
    const r = http().get(path);
    return token ? r.set(bearer(token)) : r;
  };

  const addUser = (email: string, name: string, role: Role, isDemo: boolean) =>
    t.users.create({
      email,
      name,
      passwordHash: 'unused-in-these-tests',
      role,
      isDemo,
      emailVerified: true,
    });

  let seq = 0;
  const order = (
    userId: string,
    over: Partial<NewOrder> & { status?: OrderStatus; paymentStatus?: PaymentStatus } = {},
  ) =>
    t.orders.create({
      userId,
      isDemo: false,
      items: [
        {
          productId: 'a'.repeat(24),
          name: 'Thing',
          unitPriceCents: 1000,
          quantity: 1,
          lineTotalCents: 1000,
        },
      ],
      subtotalCents: 1000,
      couponCode: null,
      couponPercent: null,
      discountCents: 0,
      totalCents: 1000,
      currency: 'USD',
      address: `${++seq} Nile Corniche, Cairo`,
      phone: '+20 100 123 4567',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'SIMULATED_UNPAID',
      expiresAt: new Date(Date.now() + 1_800_000),
      paidAt: null,
      refundedAt: null,
      cancelledAt: null,
      ...over,
    });

  beforeEach(async () => {
    t = await createAuthApp();
    admin = await t.login(Role.ADMIN);
    customer = await t.login(Role.CUSTOMER); // real (non-demo) customer user1@example.com
    viewer = await t.login(Role.DEMO_VIEWER);
    demoCustomerId = (
      await addUser('demo.shopper@example.com', 'Demo Shopper', Role.CUSTOMER, true)
    ).id;
  });
  afterEach(async () => {
    await t.app.close();
  });

  describe('access control (enforced on the server)', () => {
    const routes = ['/api/admin/stats', '/api/admin/customers', '/api/admin/orders'];

    it.each(routes)('%s: 401 anonymous, 403 customer, 200 admin and demo viewer', async (path) => {
      expect((await get(path, null)).status).toBe(401);
      expect((await get(path, 'not-a-token')).status).toBe(401);
      expect((await get(path, customer.token)).status).toBe(403);
      expect((await get(path, admin.token)).status).toBe(200);
      expect((await get(path, viewer.token)).status).toBe(200);
    });

    it('the audit log is admin-only: 401, 403 customer, 403 demo viewer, 200 admin', async () => {
      expect((await get('/api/admin/audit', null)).status).toBe(401);
      expect((await get('/api/admin/audit', customer.token)).status).toBe(403);
      expect((await get('/api/admin/audit', viewer.token)).status).toBe(403);
      expect((await get('/api/admin/audit', admin.token)).status).toBe(200);
    });

    it('a customer cannot reach admin data by guessing query strings or headers', async () => {
      const r = await get('/api/admin/customers?role=ADMIN', customer.token).set('X-Role', 'ADMIN');
      expect(r.status).toBe(403);
    });

    it('a token for a deleted user is a 401, never data', async () => {
      t.repo.records.delete(admin.id);
      expect((await get('/api/admin/stats', admin.token)).status).toBe(401);
    });

    it('rejects every non-GET method on the reporting routes', async () => {
      for (const path of [
        '/api/admin/stats',
        '/api/admin/customers',
        '/api/admin/orders',
        '/api/admin/audit',
      ]) {
        for (const method of ['post', 'patch', 'put', 'delete'] as const) {
          const res = await http()[method](path).set(bearer(admin.token)).send({});
          expect([404, 405]).toContain(res.status);
        }
      }
    });
  });

  describe('validation', () => {
    it.each([
      '/api/admin/customers?page=0',
      '/api/admin/customers?limit=51',
      '/api/admin/customers?limit=0',
      '/api/admin/customers?page=abc',
      '/api/admin/customers?page=1.5',
      '/api/admin/customers?extra=1',
      '/api/admin/customers?page[$ne]=1',
      '/api/admin/orders?status=PAID_FOR_REAL',
      '/api/admin/orders?status[$ne]=PAID',
      '/api/admin/orders?userId=abc',
      '/api/admin/audit?page=-1',
      '/api/admin/audit?limit=1000',
    ])('%s → 400', async (path) => {
      const res = await get(path, admin.token);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('applies defaults', async () => {
      const res = await get('/api/admin/customers', admin.token);
      expect(res.body.data).toMatchObject({ page: 1, limit: 20 });
    });
  });

  describe('customer list', () => {
    it('masks names and emails and never leaks hashes, roles or raw addresses', async () => {
      await addUser('heba.ashraf@example.com', 'Heba Ashraf Mohamed', Role.CUSTOMER, false);
      const res = await get('/api/admin/customers', admin.token);
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('heba.ashraf@example.com');
      expect(body).not.toContain('demo.shopper@example.com');
      expect(body).not.toMatch(/passwordHash|unused-in-these-tests|tokenVersion|"role"/);
      const items = (res.body.data as Page<Customer>).items;
      expect(items.map((c) => c.maskedEmail)).toEqual(
        expect.arrayContaining(['h***@e***.com', 'd***@e***.com']),
      );
      expect(items.find((c) => c.maskedEmail.startsWith('h'))?.displayName).toBe('Heba M.');
    });

    it('lists customers only: no admin, no demo viewer', async () => {
      const res = await get('/api/admin/customers', admin.token);
      const ids = (res.body.data as Page<Customer>).items.map((c) => c.id);
      expect(ids).toEqual(expect.arrayContaining([customer.id, demoCustomerId]));
      expect(ids).not.toContain(admin.id);
      expect(ids).not.toContain(viewer.id);
    });

    it('the demo viewer sees only synthetic customers', async () => {
      const res = await get('/api/admin/customers', viewer.token);
      const items = (res.body.data as Page<Customer>).items;
      expect(items.map((c) => c.id)).toEqual([demoCustomerId]);
      expect(items.every((c) => c.isDemo)).toBe(true);
      expect(res.body.data.total).toBe(1);
    });

    it('paginates newest first with correct totals', async () => {
      for (let i = 0; i < 5; i++)
        await addUser(`p${i}@example.com`, `P ${i}`, Role.CUSTOMER, false);
      const first = (await get('/api/admin/customers?limit=3', admin.token)).body
        .data as Page<Customer>;
      const second = (await get('/api/admin/customers?limit=3&page=2', admin.token)).body
        .data as Page<Customer>;
      expect(first).toMatchObject({ total: 7, totalPages: 3, page: 1, limit: 3 });
      expect(first.items).toHaveLength(3);
      expect(second.items).toHaveLength(3);
      expect(new Set([...first.items, ...second.items].map((c) => c.id)).size).toBe(6);
      const beyond = (await get('/api/admin/customers?page=99', admin.token)).body
        .data as Page<Customer>;
      expect(beyond.items).toEqual([]);
    });
  });

  describe('masking helpers', () => {
    it.each([
      ['heba@gmail.com', 'h***@g***.com'],
      ['a@b.co.uk', 'a***@b***.uk'],
      ['user@localhost', 'u***@l***'],
      ['ÉLODIE@exämple.fr', 'É***@e***.fr'],
      ['no-at-sign', '***'],
      ['@nodomain.com', '***'],
      ['trailing@', '***'],
      ['', '***'],
    ])('maskEmail(%j) → %j', (input, expected) => {
      expect(maskEmail(input)).toBe(expected);
    });

    it.each([
      ['Heba Ashraf', 'Heba A.'],
      ['  Heba   Ashraf   Mohamed ', 'Heba M.'],
      ['Madonna', 'Madonna'],
      ['هبة أشرف', 'هبة أ.'],
      ['', 'Customer'],
      ['   ', 'Customer'],
    ])('maskName(%j) → %j', (input, expected) => {
      expect(maskName(input)).toBe(expected);
    });
  });

  describe('dashboard stats', () => {
    beforeEach(async () => {
      const mk = (name: string, stock: number, isDemo: boolean) =>
        t.products.create({
          name,
          slug: name.toLowerCase().replace(/\W+/g, '-'),
          description: '',
          images: ['/catalogue/x.svg'],
          priceCents: 1000,
          discountPercent: 0,
          salePriceCents: 1000,
          stock,
          categoryId: 'c'.repeat(24),
          brandId: 'b'.repeat(24),
          isDemo,
          createdBy: 'seed',
        });
      await mk('Plenty', 50, false);
      await mk('Edge Low', 5, false);
      await mk('Just Above', 6, false);
      await mk('Sold Out', 0, false);
      await mk('Demo Low', 2, true);
      await mk('Demo Plenty', 40, true);

      await order(customer.id, { status: 'PENDING_PAYMENT' });
      await order(customer.id, {
        status: 'PAID',
        paymentStatus: 'SIMULATED_PAID',
        totalCents: 2500,
      });
      await order(customer.id, {
        status: 'SHIPPED',
        paymentStatus: 'SIMULATED_PAID',
        totalCents: 4000,
      });
      await order(customer.id, {
        status: 'CANCELLED',
        paymentStatus: 'SIMULATED_REFUNDED',
        totalCents: 700,
      });
      await order(customer.id, { status: 'EXPIRED' });
      await order(demoCustomerId, {
        isDemo: true,
        status: 'PAID',
        paymentStatus: 'SIMULATED_PAID',
        totalCents: 900,
      });
      await order(demoCustomerId, {
        isDemo: true,
        status: 'DELIVERED',
        paymentStatus: 'SIMULATED_PAID',
        totalCents: 100,
      });
    });

    it('reports exact figures for an admin', async () => {
      const res = await get('/api/admin/stats', admin.token);
      expect(res.status).toBe(200);
      const s = res.body.data as Stats;
      expect(s.scope).toBe('all');
      expect(s.customers).toBe(2);
      expect(s.products).toEqual({ total: 6, outOfStock: 1, lowStock: 2, lowStockThreshold: 5 });
      expect(s.orders.total).toBe(7);
      expect(s.orders.byStatus).toEqual({
        PENDING_PAYMENT: 1,
        PAID: 2,
        SHIPPED: 1,
        DELIVERED: 1,
        CANCELLED: 1,
        EXPIRED: 1,
      });
      expect(s.simulatedPaidCents).toBe(2500 + 4000 + 900 + 100);
      expect(s.simulatedRefundedCents).toBe(700);
      expect(s.notice).toMatch(/no payment was taken/i);
    });

    it('limits the demo viewer to synthetic records only', async () => {
      const s = (await get('/api/admin/stats', viewer.token)).body.data as Stats;
      expect(s.scope).toBe('demo');
      expect(s.customers).toBe(1);
      expect(s.products).toMatchObject({ total: 2, outOfStock: 0, lowStock: 1 });
      expect(s.orders.total).toBe(2);
      expect(s.orders.byStatus).toMatchObject({ PAID: 1, DELIVERED: 1, SHIPPED: 0 });
      expect(s.simulatedPaidCents).toBe(1000);
      expect(s.simulatedRefundedCents).toBe(0);
    });

    it('shows zeros, not errors, on an empty store', async () => {
      t.orders.records.clear();
      t.products.records.clear();
      const s = (await get('/api/admin/stats', admin.token)).body.data as Stats;
      expect(s.orders.total).toBe(0);
      expect(s.orders.byStatus.PAID).toBe(0);
      expect(s.products.total).toBe(0);
      expect(s.simulatedPaidCents).toBe(0);
    });
  });

  describe('admin order list', () => {
    it('lists every order with a masked customer and the simulated-payment notice', async () => {
      await order(customer.id, { status: 'PAID', paymentStatus: 'SIMULATED_PAID' });
      await order(demoCustomerId, { isDemo: true });
      const res = await get('/api/admin/orders', admin.token);
      expect(res.status).toBe(200);
      const items = (res.body.data as Page<AdminOrder>).items;
      expect(items).toHaveLength(2);
      expect(items.every((o) => o.payment.mode === 'SIMULATED')).toBe(true);
      expect(items.every((o) => o.customer.maskedEmail.includes('***'))).toBe(true);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('user1@example.com');
      expect(raw).not.toContain('demo.shopper@example.com');
      expect(raw).not.toMatch(/passwordHash/);
    });

    it('filters by status and rejects nothing else', async () => {
      await order(customer.id, { status: 'PAID', paymentStatus: 'SIMULATED_PAID' });
      await order(customer.id, { status: 'EXPIRED' });
      const res = await get('/api/admin/orders?status=PAID', admin.token);
      const items = (res.body.data as Page<AdminOrder>).items;
      expect(items.map((o) => o.status)).toEqual(['PAID']);
    });

    it('limits the demo viewer to synthetic orders, even when asking for a status that has real ones', async () => {
      const real = await order(customer.id, { status: 'PAID', paymentStatus: 'SIMULATED_PAID' });
      const synthetic = await order(demoCustomerId, {
        isDemo: true,
        status: 'PAID',
        paymentStatus: 'SIMULATED_PAID',
      });
      const res = await get('/api/admin/orders?status=PAID', viewer.token);
      const ids = (res.body.data as Page<AdminOrder>).items.map((o) => o.id);
      expect(ids).toEqual([synthetic.id]);
      expect(ids).not.toContain(real.id);
      expect(res.body.data.total).toBe(1);
    });

    it('does not show a real customer’s address to the demo viewer', async () => {
      await order(customer.id, { address: '99 Secret Street, Cairo' });
      const res = await get('/api/admin/orders', viewer.token);
      expect(JSON.stringify(res.body)).not.toContain('Secret Street');
    });

    it('copes with an order whose customer no longer exists', async () => {
      await order('f'.repeat(24));
      const res = await get('/api/admin/orders', admin.token);
      expect(res.status).toBe(200);
      expect((res.body.data as Page<AdminOrder>).items[0]?.customer).toMatchObject({
        displayName: 'Deleted customer',
        maskedEmail: '***',
      });
    });

    it('paginates newest first', async () => {
      for (let i = 0; i < 5; i++) await order(customer.id);
      const a = (await get('/api/admin/orders?limit=2', admin.token)).body.data as Page<AdminOrder>;
      const b = (await get('/api/admin/orders?limit=2&page=3', admin.token)).body
        .data as Page<AdminOrder>;
      expect(a).toMatchObject({ total: 5, totalPages: 3 });
      expect(a.items).toHaveLength(2);
      expect(b.items).toHaveLength(1);
    });
  });

  describe('failure handling', () => {
    it('a storage failure is a generic 500 that leaks nothing', async () => {
      t.orders.failWith = new Error('secret connection string mongodb://user:pw@host');
      for (const path of ['/api/admin/stats', '/api/admin/orders']) {
        const res = await get(path, admin.token);
        expect(res.status).toBe(500);
        expect(JSON.stringify(res.body)).not.toMatch(/mongodb|secret|pw@host/);
      }
    });

    it('an unavailable user store is a 503 (fail closed), never an empty list', async () => {
      t.repo.failWith = new Error('down');
      expect((await get('/api/admin/customers', admin.token)).status).toBe(503);
    });
  });

  describe('audit log', () => {
    const categoryBody = { name: 'Audit Category' };

    const entries = async () =>
      (
        (await get('/api/admin/audit', admin.token)).body.data as Page<{
          actorId: string;
          actorRole: string;
          action: string;
          targetId: string | null;
          detail: string | null;
          createdAt: string;
        }>
      ).items;

    it('starts empty', async () => {
      const res = await get('/api/admin/audit', admin.token);
      expect(res.body.data).toMatchObject({ items: [], total: 0, totalPages: 1 });
    });

    it('records who did what to which record, newest first', async () => {
      const c = await http()
        .post('/api/category/create')
        .set(bearer(admin.token))
        .send(categoryBody);
      expect(c.status).toBe(201);
      const id = c.body.data.id as string;
      await http()
        .patch(`/api/category/${id}`)
        .set(bearer(admin.token))
        .send({ name: 'Renamed Category' })
        .expect(200);
      await http().delete(`/api/category/${id}`).set(bearer(admin.token)).expect(200);
      const log = await entries();
      expect(log.map((e) => e.action)).toEqual([
        'category.delete',
        'category.update',
        'category.create',
      ]);
      expect(log.every((e) => e.actorId === admin.id && e.actorRole === Role.ADMIN)).toBe(true);
      expect(log.every((e) => e.targetId === id)).toBe(true);
    });

    it('records order status changes with the requested status and refunds', async () => {
      const paid = await order(customer.id, { status: 'PAID', paymentStatus: 'SIMULATED_PAID' });
      await http()
        .patch(`/api/order/${paid.id}/status`)
        .set(bearer(admin.token))
        .send({ status: 'SHIPPED' })
        .expect(200);
      const second = await order(customer.id, { status: 'PAID', paymentStatus: 'SIMULATED_PAID' });
      await http()
        .post(`/api/order/${second.id}/refund`)
        .set(bearer(admin.token))
        .send({})
        .expect(200);
      const log = await entries();
      expect(log).toEqual([
        expect.objectContaining({ action: 'order.refund', targetId: second.id, detail: null }),
        expect.objectContaining({ action: 'order.status', targetId: paid.id, detail: 'SHIPPED' }),
      ]);
    });

    it('records coupon changes', async () => {
      const r = await http()
        .post('/api/coupon')
        .set(bearer(admin.token))
        .send({
          code: 'AUDIT10',
          discountPercent: 10,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        });
      expect(r.status).toBe(201);
      const log = await entries();
      expect(log[0]).toMatchObject({ action: 'coupon.create', targetId: r.body.data.id });
    });

    it('records nothing for requests that fail, are forbidden, or are only reads', async () => {
      await http()
        .patch(`/api/order/${'a'.repeat(24)}/status`)
        .set(bearer(admin.token))
        .send({ status: 'SHIPPED' })
        .expect(404);
      await http()
        .patch('/api/order/not-an-id/status')
        .set(bearer(admin.token))
        .send({ status: 'SHIPPED' })
        .expect(400);
      await http()
        .post('/api/category/create')
        .set(bearer(admin.token))
        .send({ name: 'x' })
        .expect(400);
      await http()
        .post('/api/category/create')
        .set(bearer(customer.token))
        .send(categoryBody)
        .expect(403);
      await http()
        .post('/api/category/create')
        .set(bearer(viewer.token))
        .send(categoryBody)
        .expect(403);
      await http().post('/api/category/create').send(categoryBody).expect(401);
      await get('/api/admin/stats', admin.token);
      await get('/api/category', admin.token);
      expect(t.audit.entries).toHaveLength(0);
    });

    it('never stores request bodies or secrets, and caps the detail', async () => {
      const paid = await order(customer.id, { status: 'PAID', paymentStatus: 'SIMULATED_PAID' });
      await http()
        .patch(`/api/order/${paid.id}/status`)
        .set(bearer(admin.token))
        .send({ status: 'SHIPPED' })
        .expect(200);
      const stored = JSON.stringify(t.audit.entries);
      expect(stored).not.toMatch(/Nile Corniche|password|Bearer|\+20/i);
      expect(Object.keys(t.audit.entries[0] ?? {}).sort()).toEqual([
        'action',
        'actorId',
        'actorRole',
        'createdAt',
        'detail',
        'id',
        'targetId',
      ]);
    });

    it('a failed audit write is logged but does not undo or fail the completed action', async () => {
      t.audit.failWith = new Error('audit store down');
      const res = await http()
        .post('/api/category/create')
        .set(bearer(admin.token))
        .send(categoryBody);
      expect(res.status).toBe(201);
      expect(t.categories.records.size).toBe(1);
      expect(t.audit.entries).toHaveLength(0);
    });

    it('a storage failure reading the log is a generic 500', async () => {
      t.audit.failWith = new Error('secret');
      const res = await get('/api/admin/audit', admin.token);
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain('secret');
    });

    it('is append-only: there is no way to change or delete an entry over HTTP', async () => {
      await http()
        .post('/api/category/create')
        .set(bearer(admin.token))
        .send(categoryBody)
        .expect(201);
      const id = t.audit.entries[0]?.id;
      for (const method of ['patch', 'put', 'delete'] as const) {
        const res = await http()
          [method](`/api/admin/audit/${id}`)
          .set(bearer(admin.token))
          .send({});
        expect(res.status).toBe(404);
      }
      expect(t.audit.entries).toHaveLength(1);
    });
  });

  describe('every admin write route is audited', () => {
    it('finds @Roles(ADMIN) write handlers without @Audited (a new one fails here)', () => {
      const reflector = new Reflector();
      const missing: string[] = [];
      let checked = 0;
      for (const mod of t.app.get(ModulesContainer).values()) {
        for (const wrapper of mod.controllers.values()) {
          const controller = wrapper.metatype as Type<unknown> | null;
          if (!controller) continue;
          const proto = controller.prototype as Record<string, unknown>;
          for (const name of Object.getOwnPropertyNames(proto)) {
            const handler = proto[name];
            if (name === 'constructor' || typeof handler !== 'function') continue;
            const method = Reflect.getMetadata(METHOD_METADATA, handler) as
              RequestMethod | undefined;
            if (method === undefined || method === RequestMethod.GET) continue;
            const roles = reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
              handler,
              controller,
            ]);
            if (!roles?.includes(Role.ADMIN) || roles.includes(Role.CUSTOMER)) continue;
            checked++;
            const meta = reflector.get<AuditedMeta | undefined>(AUDITED, handler);
            if (!meta) missing.push(`${controller.name}.${name}`);
          }
        }
      }
      expect(missing).toEqual([]);
      expect(checked).toBeGreaterThanOrEqual(14);
    });
  });
});
