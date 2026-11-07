import { ModulesContainer } from '@nestjs/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { loadEnv, openApiEnabled } from '../src/config/env';
import { buildOpenApi, OpenApiDocument } from '../src/openapi/openapi';
import { ROUTE_DOCS } from '../src/openapi/route-docs';
import { Role } from '../src/users/role';
import { AuthTestApp, createAuthApp, TEST_SECRET } from './helpers/create-auth-app';
import { listRoutes } from './helpers/routes';

jest.setTimeout(30_000);

type Operation = Record<string, unknown> & {
  summary: string;
  'x-access': string;
  responses: Record<string, unknown>;
  requestBody?: { content: { 'application/json': { schema: Record<string, unknown> } } };
  parameters?: { name: string; in: string; required: boolean; schema: Record<string, unknown> }[];
};

describe('OpenAPI description', () => {
  let t: AuthTestApp;
  let doc: OpenApiDocument;
  const ops = () =>
    Object.entries(doc.paths).flatMap(([path, item]) =>
      Object.entries(item).map(([method, op]) => ({
        key: `${method.toUpperCase()} ${path}`,
        path,
        method,
        op: op as Operation,
      })),
    );

  beforeAll(async () => {
    t = await createAuthApp([], { JWT_SECRET: TEST_SECRET });
    doc = buildOpenApi(t.app.get(ModulesContainer));
  });
  afterAll(async () => {
    await t.app.close();
  });

  describe('it cannot drift from the running application', () => {
    const template = (path: string) => path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

    it('describes every registered route, and nothing else', () => {
      const live = listRoutes(t.app)
        .map((r) => `${r.method} ${template(r.path)}`)
        .sort();
      expect(
        ops()
          .map((o) => o.key)
          .sort(),
      ).toEqual(live);
    });

    it('has a human summary for every route, and no summary for a route that no longer exists', () => {
      const live = new Set(ops().map((o) => o.key));
      expect(
        ops()
          .filter((o) => o.op.summary === '(undocumented)')
          .map((o) => o.key),
      ).toEqual([]);
      expect(Object.keys(ROUTE_DOCS).filter((k) => !live.has(k))).toEqual([]);
    });

    it('matches the committed docs/openapi.json (regenerate with `npm run docs:openapi`)', () => {
      const committed = JSON.parse(
        readFileSync(join(__dirname, '..', 'docs', 'openapi.json'), 'utf8'),
      ) as unknown;
      expect(JSON.parse(JSON.stringify(doc))).toEqual(committed);
    });
  });

  describe('it states the access rules the guards enforce', () => {
    it('every operation that is not public documents a 401, and every role-restricted one a 403', () => {
      for (const { key, op } of ops()) {
        const access = op['x-access'];
        if (!access.startsWith('public'))
          expect({ key, has401: '401' in op.responses }).toEqual({ key, has401: true });
        if (/ADMIN/.test(access))
          expect({ key, has403: '403' in op.responses }).toEqual({ key, has403: true });
        expect({ key, has429: '429' in op.responses }).toEqual({ key, has429: true });
      }
    });

    it('marks the audit log, coupons and order changes admin-only and the reporting reads staff-only', () => {
      const access = Object.fromEntries(ops().map((o) => [o.key, o.op['x-access']]));
      expect(access['GET /api/admin/audit']).toBe('ADMIN');
      expect(access['GET /api/coupon']).toBe('ADMIN');
      expect(access['PATCH /api/order/{orderId}/status']).toBe('ADMIN');
      expect(access['POST /api/order/{orderId}/refund']).toBe('ADMIN');
      expect(access['GET /api/admin/stats']).toBe('ADMIN or DEMO_VIEWER');
      expect(access['POST /api/auth/login']).toBe('public');
      expect(access['POST /api/order/{orderId}/simulate-payment']).toBe('any signed-in user');
    });

    it('agrees with the server: every ADMIN-only operation really answers 403 to a customer', async () => {
      const customer = (await t.login(Role.CUSTOMER)).token;
      const id = 'a'.repeat(24);
      for (const { method, path, op } of ops().filter((o) => o.op['x-access'] === 'ADMIN')) {
        const url = path.replace(/\{[^}]+\}/g, id);
        const res = await (
          request(t.app.getHttpServer()) as unknown as Record<string, (u: string) => request.Test>
        )[method]!(url)
          .set('Authorization', `Bearer ${customer}`)
          .send({});
        expect({ route: `${method} ${path}`, status: res.status }).toEqual({
          route: `${method} ${path}`,
          status: 403,
        });
        expect(op.summary).not.toBe('');
      }
    });

    it('agrees with the server: every public operation answers without a token (never 401)', async () => {
      const id = 'a'.repeat(24);
      for (const { method, path } of ops().filter((o) => o.op['x-access'].startsWith('public'))) {
        const url = path.replace(/\{[^}]+\}/g, id);
        const res = await (
          request(t.app.getHttpServer()) as unknown as Record<string, (u: string) => request.Test>
        )[method]!(url).send({});
        expect({ route: `${method} ${path}`, unauthorized: res.status === 401 }).toEqual({
          route: `${method} ${path}`,
          unauthorized: false,
        });
      }
    });
  });

  describe('it describes inputs from the real validators', () => {
    const body = (key: string) =>
      ops().find((o) => o.key === key)?.op.requestBody?.content['application/json']
        .schema as Record<string, unknown>;

    it('signup rejects unknown fields and offers no role field', () => {
      const schema = body('POST /api/auth/signup') as {
        additionalProperties: unknown;
        properties: Record<string, unknown>;
      };
      expect(schema.additionalProperties).toBe(false);
      expect(Object.keys(schema.properties).sort()).toEqual(['email', 'name', 'password']);
    });

    it('placing an order takes an address and phone or a saved address id only, and payment routes take no body fields', () => {
      const create = body('POST /api/order') as {
        anyOf: { properties: Record<string, unknown>; additionalProperties: unknown }[];
      };
      expect(create.anyOf.map((o) => Object.keys(o.properties).sort())).toEqual([
        ['address', 'phone'],
        ['addressId'],
      ]);
      expect(create.anyOf.every((o) => o.additionalProperties === false)).toBe(true);
      const pay = body('POST /api/order/{orderId}/simulate-payment') as {
        properties: Record<string, unknown>;
        additionalProperties: unknown;
      };
      expect(pay.properties).toEqual({});
      expect(pay.additionalProperties).toBe(false);
    });

    it('lists the product query parameters with their limits', () => {
      const params = ops().find((o) => o.key === 'GET /api/product')?.op.parameters ?? [];
      const limit = params.find((p) => p.name === 'limit');
      expect(limit?.schema).toMatchObject({ minimum: 1, maximum: 50, default: 12 });
      expect(params.map((p) => p.name)).toEqual(
        expect.arrayContaining(['q', 'sort', 'page', 'minPrice', 'maxPrice']),
      );
    });

    it('documents id path parameters as 24-hex ObjectIds', () => {
      const param = ops().find((o) => o.key === 'GET /api/order/{orderId}')?.op.parameters?.[0];
      expect(param).toMatchObject({
        name: 'orderId',
        in: 'path',
        required: true,
        schema: { pattern: '^[0-9a-fA-F]{24}$' },
      });
    });

    it('never mentions a payment gateway or card fields anywhere', () => {
      const text = JSON.stringify(doc).toLowerCase();
      for (const word of ['stripe', 'paypal', 'cardnumber', 'card_number', 'cvv', 'cvc', 'iban']) {
        expect(text).not.toContain(word);
      }
      expect(JSON.stringify(doc.info)).toMatch(/simulated/i);
    });
  });

  describe('serving it', () => {
    it('GET /api/openapi.json is public and returns the same document', async () => {
      const res = await request(t.app.getHttpServer()).get('/api/openapi.json');
      expect(res.status).toBe(200);
      expect(res.body.data.openapi).toBe('3.1.0');
      expect(res.body.data.paths['/api/order'].post['x-access']).toBe('any signed-in user');
    });

    it('is switched off in production unless explicitly enabled, and can be switched off elsewhere', async () => {
      expect(openApiEnabled(loadEnv({ NODE_ENV: 'development' }))).toBe(true);
      expect(
        openApiEnabled(
          loadEnv({
            NODE_ENV: 'production',
            MAIL_TRANSPORT: 'smtp',
            SMTP_URL: 'smtps://u:p@h:465',
            MAIL_FROM: 'a@b.co',
          }),
        ),
      ).toBe(false);
      expect(
        openApiEnabled(
          loadEnv({
            NODE_ENV: 'production',
            OPENAPI_ENABLED: 'true',
            MAIL_TRANSPORT: 'smtp',
            SMTP_URL: 'smtps://u:p@h:465',
            MAIL_FROM: 'a@b.co',
          }),
        ),
      ).toBe(true);
      expect(openApiEnabled(loadEnv({ NODE_ENV: 'test', OPENAPI_ENABLED: 'false' }))).toBe(false);
      expect(() => loadEnv({ OPENAPI_ENABLED: 'yes' })).toThrow(/OPENAPI_ENABLED/);

      const off = await createAuthApp([], { JWT_SECRET: TEST_SECRET, OPENAPI_ENABLED: 'false' });
      try {
        const res = await request(off.app.getHttpServer()).get('/api/openapi.json');
        expect(res.status).toBe(404);
      } finally {
        await off.app.close();
      }
    });
  });
});
