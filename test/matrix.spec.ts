import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { Role } from '../src/users/role';
import { AuthTestApp, createAuthApp, TEST_SECRET } from './helpers/create-auth-app';

/**
 * Generic, spec-driven probes. Every operation in the generated OpenAPI description is exercised for the
 * cross-cutting behaviour that must hold on EVERY route (authentication, role checks, demo read-only,
 * input validation). Test names start with `MATRIX|<case>|<METHOD path>`; tools/generate-test-matrix.mjs
 * reads the Jest results by that prefix, so a case shows as EXECUTED only if it really ran and passed.
 */
jest.setTimeout(30_000);

interface Op {
  method: string;
  path: string;
  access: string;
  params: { name: string; in: string }[];
  hasBody: boolean;
}

const OBJECT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';

// Registered at load time from the committed spec so each operation gets its own named test.
const committed = JSON.parse(
  readFileSync(join(__dirname, '..', 'docs', 'openapi.json'), 'utf8'),
) as {
  paths: Record<
    string,
    Record<
      string,
      { 'x-access': string; parameters?: { name: string; in: string }[]; requestBody?: unknown }
    >
  >;
};
const cases: Op[] = Object.entries(committed.paths).flatMap(([path, item]) =>
  Object.entries(item).map(([method, op]) => ({
    method: method.toUpperCase(),
    path,
    access: op['x-access'],
    params: op.parameters ?? [],
    hasBody: op.requestBody !== undefined,
  })),
);

describe('route matrix: per-operation probes', () => {
  let t: AuthTestApp;
  let tokens: Record<'customer' | 'admin' | 'viewer', string>;

  beforeAll(async () => {
    // Every probe comes from one client address; lift the per-address throttle for this sweep only
    // (throttling itself is covered by throttle.spec).
    t = await createAuthApp([], { JWT_SECRET: TEST_SECRET, THROTTLE_LIMIT: '100000' });
    tokens = {
      customer: (await t.login(Role.CUSTOMER)).token,
      admin: (await t.login(Role.ADMIN)).token,
      viewer: (await t.login(Role.DEMO_VIEWER)).token,
    };
  });
  afterAll(async () => {
    await t.app.close();
  });

  const target = (op: Op, id = OBJECT_ID) => op.path.replace(/\{[^}]+\}/g, id);
  const call = (op: Op, id = OBJECT_ID) => {
    const agent = request(t.app.getHttpServer());
    const path = target(op, id);
    switch (op.method) {
      case 'POST':
        return agent.post(path);
      case 'PUT':
        return agent.put(path);
      case 'PATCH':
        return agent.patch(path);
      case 'DELETE':
        return agent.delete(path);
      default:
        return agent.get(path);
    }
  };
  const isPublic = (op: Op) => op.access.startsWith('public');
  const tokenFor = (op: Op) => (op.access.includes('ADMIN') ? tokens.admin : tokens.customer);
  const name = (c: string, op: Op) => `MATRIX|${c}|${op.method} ${op.path}`;

  const needsAuth = cases.filter((o) => !isPublic(o));
  const adminOnly = cases.filter((o) => o.access === 'ADMIN');
  const writesNeedingAuth = needsAuth.filter((o) => o.method !== 'GET');
  // Slugs and share tokens are not object ids: a malformed one is simply "not found" (covered per feature).
  const SLUG_ROUTES = [
    '/api/bundles/{slug}',
    '/api/looks/{slug}',
    '/api/moodboards/shared/{token}',
  ];
  const withId = cases.filter(
    (o) => o.params.some((p) => p.in === 'path') && !SLUG_ROUTES.includes(o.path),
  );
  const withBody = cases.filter((o) => o.hasBody);
  const withLimit = cases.filter((o) =>
    o.params.some((p) => p.in === 'query' && p.name === 'limit'),
  );

  it.each(needsAuth.map((o) => [name('no-token-401', o), o] as const))('%s', async (_n, op) => {
    const res = await call(op);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it.each(needsAuth.map((o) => [name('bad-token-401', o), o] as const))('%s', async (_n, op) => {
    const res = await call(op).set('Authorization', 'Bearer not.a.token');
    expect(res.status).toBe(401);
  });

  it.each(adminOnly.map((o) => [name('customer-403', o), o] as const))('%s', async (_n, op) => {
    const res = await call(op).set('Authorization', `Bearer ${tokens.customer}`);
    expect(res.status).toBe(403);
  });

  it.each(adminOnly.map((o) => [name('viewer-403', o), o] as const))('%s', async (_n, op) => {
    const res = await call(op).set('Authorization', `Bearer ${tokens.viewer}`);
    expect(res.status).toBe(403);
  });

  it.each(writesNeedingAuth.map((o) => [name('demo-write-403', o), o] as const))(
    '%s',
    async (_n, op) => {
      const res = await call(op).set('Authorization', `Bearer ${tokens.viewer}`).send({});
      expect(res.status).toBe(403);
    },
  );

  it.each(withId.map((o) => [name('bad-id-400', o), o] as const))('%s', async (_n, op) => {
    const req = call(op, 'not-an-object-id');
    const res = await (
      isPublic(op) ? req : req.set('Authorization', `Bearer ${tokenFor(op)}`)
    ).send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it.each(withBody.map((o) => [name('unknown-field-400', o), o] as const))('%s', async (_n, op) => {
    const req = call(op).send({ __unexpected__: 'x' });
    const res = await (isPublic(op) ? req : req.set('Authorization', `Bearer ${tokenFor(op)}`));
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it.each(withBody.map((o) => [name('bad-json-400', o), o] as const))('%s', async (_n, op) => {
    const req = call(op).set('Content-Type', 'application/json').send('{"broken":');
    const res = await (isPublic(op) ? req : req.set('Authorization', `Bearer ${tokenFor(op)}`));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/SyntaxError|at JSON|node_modules/);
  });

  it.each(withLimit.map((o) => [name('bad-query-400', o), o] as const))('%s', async (_n, op) => {
    const req = call(op).query({ limit: 'abc' });
    const res = await (isPublic(op) ? req : req.set('Authorization', `Bearer ${tokenFor(op)}`));
    expect(res.status).toBe(400);
  });
});

describe('route matrix: original endpoints that were deliberately removed', () => {
  let t: AuthTestApp;
  beforeAll(async () => {
    t = await createAuthApp([], { JWT_SECRET: TEST_SECRET });
  });
  afterAll(async () => {
    await t.app.close();
  });

  const original = JSON.parse(
    readFileSync(join(__dirname, '..', 'docs', 'original-endpoints.json'), 'utf8'),
  ) as {
    n: number;
    original: string;
    fate: string;
    probe?: string | null;
    expectStatus?: number;
  }[];
  const probes = original.filter((e) => e.probe);

  it.each(probes.map((e) => [`MATRIX|removed-404|${e.original}`, e] as const))(
    '%s',
    async (_n, e) => {
      const [method, path] = (e.probe as string).split(' ');
      const agent = request(t.app.getHttpServer());
      const res = await (method === 'POST' ? agent.post(path) : agent.get(path));
      expect(res.status).toBe(e.expectStatus ?? 404);
      expect(res.body?.success).not.toBe(true);
    },
  );

  it('MATRIX|removed-dependency|no file-upload, Stripe or WebSocket package is installed', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(
      names.filter((n) =>
        /^(stripe|socket\.io|ws|@nestjs\/websockets|@nestjs\/platform-socket\.io|multer|@nestjs\/serve-static)$/.test(
          n,
        ),
      ),
    ).toEqual([]);
  });
});
