import request from 'supertest';
import { Role } from '../src/users/role';
import { AuthTestApp, createAuthApp } from './helpers/create-auth-app';
import { listRoutes } from './helpers/routes';

jest.setTimeout(30_000);

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const ID = 'a'.repeat(24);

/**
 * Write routes that a demo viewer may legitimately reach because they are PUBLIC: no identity is ever
 * attached to the request, so the read-only guard has nothing to act on. Each one needs a reason.
 * Everything else that writes MUST be forbidden for the demo viewer (the table below).
 */
const PUBLIC_WRITES: Record<string, string> = {
  'POST /api/auth/signup': 'public: creates a CUSTOMER account, never a demo or admin one',
  'POST /api/auth/verify-email': 'public: proves control of an inbox',
  'POST /api/auth/resend-otp': 'public, rate limited, answers identically for unknown emails',
  'POST /api/auth/login': 'public: how the demo viewer signs in at all',
  'POST /api/auth/refresh': 'public: keeps the viewer signed in',
  'POST /api/auth/logout': 'public: ends the viewer’s own session',
  'POST /api/auth/forgot-password': 'public, rate limited, answers identically for unknown emails',
  'POST /api/auth/reset-password': 'public: needs a mailed code',
};

/** Authenticated write routes → a body that would otherwise be valid, so only the guard can say 403. */
const FORBIDDEN_FOR_VIEWER: Record<string, object> = {
  'POST /api/auth/logout-all': {},
  'POST /api/brand/create': { name: 'Nope Brand' },
  'PATCH /api/brand/:id': { name: 'Nope Brand' },
  'DELETE /api/brand/:id': {},
  'POST /api/category/create': { name: 'Nope Category' },
  'PATCH /api/category/:id': { name: 'Nope Category' },
  'DELETE /api/category/:id': {},
  'POST /api/product/create': {
    name: 'Nope Product',
    images: ['/catalogue/x.svg'],
    priceCents: 1000,
    stock: 1,
    categoryId: ID,
    brandId: ID,
  },
  'PATCH /api/product/:id': { stock: 5 },
  'DELETE /api/product/:id': {},
  'POST /api/coupon': { code: 'NOPE10', discountPercent: 10, expiresAt: '2999-01-01T00:00:00Z' },
  'PATCH /api/coupon/:id': { discountPercent: 20 },
  'DELETE /api/coupon/:id': {},
  'POST /api/cart': { productId: ID, quantity: 1 },
  'PATCH /api/cart/:productId': { quantity: 1 },
  'DELETE /api/cart/:productId': {},
  'POST /api/cart/apply-coupon': { code: 'NOPE10' },
  'POST /api/order': { address: '12 Nile Corniche, Cairo', phone: '+20 100 123 4567' },
  'POST /api/order/:orderId/simulate-payment': {},
  'PATCH /api/order/:orderId/status': { status: 'SHIPPED' },
  'POST /api/order/:orderId/refund': {},
};

describe('demo viewer is read-only on every write route', () => {
  let t: AuthTestApp;
  let viewer: string;

  beforeAll(async () => {
    t = await createAuthApp();
    viewer = (await t.login(Role.DEMO_VIEWER)).token;
  });
  afterAll(async () => {
    await t.app.close();
  });

  const writes = () =>
    listRoutes(t.app)
      .filter((r) => !SAFE.has(r.method))
      .map((r) => `${r.method} ${r.path}`);

  it('classifies every write route the application registers (a new, uncovered one fails here)', () => {
    const known = new Set([...Object.keys(PUBLIC_WRITES), ...Object.keys(FORBIDDEN_FOR_VIEWER)]);
    const unclassified = writes().filter((r) => !known.has(r));
    expect(unclassified).toEqual([]);
  });

  it('has no stale entries for routes that no longer exist', () => {
    const live = new Set(writes());
    const stale = [...Object.keys(PUBLIC_WRITES), ...Object.keys(FORBIDDEN_FOR_VIEWER)].filter(
      (r) => !live.has(r),
    );
    expect(stale).toEqual([]);
  });

  it('never lists a route as both public and forbidden', () => {
    const overlap = Object.keys(PUBLIC_WRITES).filter((r) => r in FORBIDDEN_FOR_VIEWER);
    expect(overlap).toEqual([]);
  });

  it.each(Object.entries(FORBIDDEN_FOR_VIEWER))(
    '%s → 403 for the demo viewer',
    async (route, body) => {
      const [method, template] = route.split(' ') as [string, string];
      const path = template.replace(/:\w+/g, ID);
      const verb = method.toLowerCase() as 'post' | 'patch' | 'delete';
      const res = await request(t.app.getHttpServer())
        [verb](path)
        .set('Authorization', `Bearer ${viewer}`)
        .send(body);
      expect(res.status).toBe(403);
      // The read-only guard answered (not a role check further down, not a validation error).
      expect(res.body.error.message).toBe('Demo accounts are read-only');
    },
  );

  it('answers 401, not 403, when there is no token at all', async () => {
    const res = await request(t.app.getHttpServer()).post('/api/order').send({});
    expect(res.status).toBe(401);
  });

  it('changes nothing: the viewer’s rejected writes leave every store empty', () => {
    expect(t.brands.records.size).toBe(0);
    expect(t.categories.records.size).toBe(0);
    expect(t.products.records.size).toBe(0);
    expect(t.coupons.records.size).toBe(0);
    expect(t.orders.records.size).toBe(0);
    expect(t.audit.entries).toHaveLength(0);
  });
});
