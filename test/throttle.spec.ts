import request from 'supertest';
import { loadEnv } from '../src/config/env';
import { Role } from '../src/users/role';
import { AuthTestApp, createAuthApp, TEST_SECRET } from './helpers/create-auth-app';

jest.setTimeout(30_000);

const env = (extra: NodeJS.ProcessEnv = {}) => ({ JWT_SECRET: TEST_SECRET, ...extra });

describe('throttle and trust-proxy configuration', () => {
  it('has safe defaults: no proxy trusted, 300 requests per minute', () => {
    expect(loadEnv({ NODE_ENV: 'test' })).toMatchObject({
      TRUST_PROXY: 0,
      THROTTLE_LIMIT: 300,
      THROTTLE_WINDOW_SECONDS: 60,
    });
  });

  it.each([
    ['TRUST_PROXY', 'true'],
    ['TRUST_PROXY', '-1'],
    ['TRUST_PROXY', '6'],
    ['TRUST_PROXY', '1.5'],
    ['TRUST_PROXY', 'loopback'],
    ['THROTTLE_LIMIT', '0'],
    ['THROTTLE_LIMIT', '-5'],
    ['THROTTLE_LIMIT', 'lots'],
    ['THROTTLE_LIMIT', '100001'],
    ['THROTTLE_WINDOW_SECONDS', '0'],
    ['THROTTLE_WINDOW_SECONDS', '3601'],
  ])('refuses %s=%s at startup without echoing the value', (name, value) => {
    expect(() => loadEnv({ NODE_ENV: 'test', [name]: value })).toThrow(new RegExp(name));
    try {
      loadEnv({ NODE_ENV: 'test', [name]: value });
    } catch (error) {
      expect((error as Error).message).not.toContain(`=${value}`);
    }
  });
});

describe('request throttle', () => {
  let t: AuthTestApp;
  afterEach(async () => {
    await t.app.close();
  });
  const get = (path: string, headers: Record<string, string> = {}) =>
    request(t.app.getHttpServer()).get(path).set(headers);

  it('answers 429 with Retry-After and a generic envelope once the limit is used up', async () => {
    t = await createAuthApp([], env({ THROTTLE_LIMIT: '5', THROTTLE_WINDOW_SECONDS: '60' }));
    for (let i = 0; i < 5; i++) expect((await get('/api/product')).status).toBe(200);
    const blocked = await get('/api/product');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(blocked.body).toMatchObject({
      success: false,
      error: { statusCode: 429, error: 'Too Many Requests' },
    });
    expect(JSON.stringify(blocked.body)).not.toMatch(/127\.0\.0\.1|::1|ip:/);
  });

  it('counts everything, including unknown routes, malformed bodies and failed logins', async () => {
    t = await createAuthApp([], env({ THROTTLE_LIMIT: '4' }));
    await get('/api/nothing-here').expect(404);
    await request(t.app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{not json')
      .expect(400);
    await request(t.app.getHttpServer()).post('/api/auth/login').send({}).expect(400);
    await get('/api/cart').expect(401);
    await get('/api/product').expect(429);
  });

  it('throttles before authentication: an anonymous flood on a protected route ends in 429, not endless 401', async () => {
    t = await createAuthApp([], env({ THROTTLE_LIMIT: '3' }));
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await get('/api/admin/stats')).status);
    expect(statuses).toEqual([401, 401, 401, 429, 429]);
  });

  it('also limits signed-in users of every role', async () => {
    t = await createAuthApp([], env({ THROTTLE_LIMIT: '2' }));
    const { token } = await t.login(Role.ADMIN);
    await get('/api/admin/stats', { Authorization: `Bearer ${token}` }).expect(200);
    await get('/api/admin/stats', { Authorization: `Bearer ${token}` }).expect(200);
    await get('/api/admin/stats', { Authorization: `Bearer ${token}` }).expect(429);
  });

  it('never throttles /api/health, so load-balancer probes cannot lock the service out', async () => {
    t = await createAuthApp([], env({ THROTTLE_LIMIT: '1' }));
    for (let i = 0; i < 10; i++) await get('/api/health').expect(200);
    await get('/api/product').expect(200);
    await get('/api/product').expect(429);
    await get('/api/health').expect(200);
  });

  it('lets traffic through again when the window has passed', async () => {
    t = await createAuthApp([], env({ THROTTLE_LIMIT: '2', THROTTLE_WINDOW_SECONDS: '30' }));
    let now = 1_000_000;
    t.throttler.now = () => now;
    await get('/api/product').expect(200);
    await get('/api/product').expect(200);
    await get('/api/product').expect(429);
    now += 29_000;
    await get('/api/product').expect(429);
    now += 2_000;
    await get('/api/product').expect(200);
  });

  describe('client address and X-Forwarded-For', () => {
    it('ignores forwarding headers by default, so rotating them does not evade the limit', async () => {
      t = await createAuthApp([], env({ THROTTLE_LIMIT: '3' }));
      for (let i = 0; i < 3; i++)
        await get('/api/product', { 'X-Forwarded-For': `10.0.0.${i}` }).expect(200);
      await get('/api/product', { 'X-Forwarded-For': '10.9.9.9' }).expect(429);
    });

    it('with one trusted proxy, separates clients by the address that proxy reports', async () => {
      t = await createAuthApp([], env({ THROTTLE_LIMIT: '2', TRUST_PROXY: '1' }));
      const a = { 'X-Forwarded-For': '203.0.113.10' };
      const b = { 'X-Forwarded-For': '203.0.113.20' };
      await get('/api/product', a).expect(200);
      await get('/api/product', a).expect(200);
      await get('/api/product', a).expect(429);
      await get('/api/product', b).expect(200); // a different real client is unaffected
    });

    it('with one trusted proxy, a client-supplied extra hop cannot pick its own address', async () => {
      t = await createAuthApp([], env({ THROTTLE_LIMIT: '2', TRUST_PROXY: '1' }));
      // The proxy appends the real peer last; everything before it is attacker-controlled.
      for (let i = 0; i < 2; i++) {
        await get('/api/product', { 'X-Forwarded-For': `198.51.100.${i}, 203.0.113.50` }).expect(
          200,
        );
      }
      await get('/api/product', { 'X-Forwarded-For': '192.0.2.77, 203.0.113.50' }).expect(429);
    });

    it('with no forwarding header and a trusted proxy it falls back to the socket address', async () => {
      t = await createAuthApp([], env({ THROTTLE_LIMIT: '1', TRUST_PROXY: '1' }));
      await get('/api/product').expect(200);
      await get('/api/product').expect(429);
    });

    it('feeds the same address to the login limiter (5 failed logins per account stay per account)', async () => {
      t = await createAuthApp([], env({ TRUST_PROXY: '1' }));
      for (let i = 0; i < 30; i++) {
        await request(t.app.getHttpServer())
          .post('/api/auth/login')
          .set('X-Forwarded-For', '203.0.113.5')
          .send({ email: `nobody${i}@example.com`, password: 'wrong-password-123' })
          .expect(401);
      }
      // 30 failures from one address: the per-IP login limiter now refuses that address...
      const same = await request(t.app.getHttpServer())
        .post('/api/auth/login')
        .set('X-Forwarded-For', '203.0.113.5')
        .send({ email: 'someone@example.com', password: 'wrong-password-123' });
      expect(same.status).toBe(429);
      // ...but not a different client behind the same proxy.
      const other = await request(t.app.getHttpServer())
        .post('/api/auth/login')
        .set('X-Forwarded-For', '203.0.113.6')
        .send({ email: 'someone@example.com', password: 'wrong-password-123' });
      expect(other.status).toBe(401);
    });
  });
});
