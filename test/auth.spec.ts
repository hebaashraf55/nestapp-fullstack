import { Controller, Delete, Get, Patch, Post, Put } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { AuthenticatedUser } from '../src/auth/auth.types';
import { demoScope } from '../src/auth/demo-scope';
import { CurrentUser, Public, Roles } from '../src/auth/decorators';
import { Role } from '../src/users/role';
import { AuthTestApp, createAuthApp, TEST_SECRET } from './helpers/create-auth-app';

const DATASET = [
  { id: 'real-1', isDemo: false },
  { id: 'demo-1', isDemo: true },
];

@Controller('t')
class TestController {
  @Public() @Get('open') open() {
    return { open: true };
  }
  @Get('me') me(@CurrentUser() user: AuthenticatedUser) {
    return { id: user.id, role: user.role };
  }
  @Roles(Role.ADMIN) @Get('admin') admin() {
    return { admin: true };
  }
  @Roles(Role.ADMIN, Role.CUSTOMER) @Get('shop') shop() {
    return { shop: true };
  }
  @Get('data') data(@CurrentUser() user: AuthenticatedUser) {
    const scope = demoScope(user);
    return DATASET.filter((r) => scope.isDemo === undefined || r.isDemo === scope.isDemo).map(
      (r) => r.id,
    );
  }
  // Misconfiguration on purpose: public AND role-restricted must deny, not allow.
  @Public() @Roles(Role.ADMIN) @Get('misconfigured') misconfigured() {
    return { leaked: true };
  }
  @Post('write') post() {
    return { ok: true };
  }
  @Put('write') put() {
    return { ok: true };
  }
  @Patch('write') patch() {
    return { ok: true };
  }
  @Delete('write') del() {
    return { ok: true };
  }
}

describe('server-side authentication and authorization', () => {
  let ctx: AuthTestApp;
  const http = () => request(ctx.app.getHttpServer());

  beforeEach(async () => {
    ctx = await createAuthApp([TestController]);
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  describe('authentication (always 401, never 500)', () => {
    it('public routes need no token', async () => {
      await http().get('/api/t/open').expect(200);
      await http().get('/api/health').expect(200);
    });

    it('a protected route without credentials is 401 with the standard envelope', async () => {
      const res = await http().get('/api/t/me').expect(401);
      expect(res.body).toMatchObject({
        success: false,
        error: { statusCode: 401, error: 'Unauthorized' },
      });
    });

    it.each([
      ['wrong scheme', 'Basic abc'],
      ['empty bearer', 'Bearer '],
      ['bearer with spaces', 'Bearer a b'],
      ['garbage token', 'Bearer not.a.jwt'],
      ['token with injection characters', "Bearer ' OR 1=1 --"],
      ['no scheme', 'abc.def.ghi'],
    ])('rejects %s', async (_label, header) => {
      const res = await http().get('/api/t/me').set('Authorization', header).expect(401);
      expect(JSON.stringify(res.body)).not.toMatch(/jwt|signature|malformed|stack/i);
    });

    it('rejects a tampered, expired, foreign-secret or alg:none token', async () => {
      const { id } = await ctx.login(Role.ADMIN);
      const expired = jwt.sign({}, TEST_SECRET, {
        subject: id,
        issuer: 'nestapp-fullstack',
        expiresIn: -5,
      });
      const foreign = jwt.sign({}, 'y'.repeat(48), { subject: id, issuer: 'nestapp-fullstack' });
      const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const none = `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: id, iss: 'nestapp-fullstack' })}.`;
      for (const token of [expired, foreign, none]) {
        await http().get('/api/t/me').set('Authorization', `Bearer ${token}`).expect(401);
      }
    });

    it('a valid token for a user that no longer exists is 401', async () => {
      const { id, token } = await ctx.login(Role.CUSTOMER);
      ctx.repo.records.delete(id);
      await http().get('/api/t/me').set('Authorization', `Bearer ${token}`).expect(401);
    });

    it('a storage outage is a generic 503 that leaks nothing', async () => {
      const { token } = await ctx.login(Role.CUSTOMER);
      ctx.repo.failWith = new Error('connect ECONNREFUSED mongodb://admin:pa55@10.0.0.9');
      const res = await http().get('/api/t/me').set('Authorization', `Bearer ${token}`).expect(503);
      expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|pa55|10\.0\.0\.9|mongodb/);
    });

    it('fails closed when the server has no JWT_SECRET', async () => {
      const closed = await createAuthApp([TestController], {});
      try {
        const { token } = await ctx.login(Role.ADMIN);
        await request(closed.app.getHttpServer())
          .get('/api/t/me')
          .set('Authorization', `Bearer ${token}`)
          .expect(401);
        await request(closed.app.getHttpServer()).get('/api/t/open').expect(200);
      } finally {
        await closed.app.close();
      }
    });
  });

  describe('role checks come from the database, not the token', () => {
    it('lets the user through to their own data', async () => {
      const { id, token } = await ctx.login(Role.CUSTOMER);
      const res = await http().get('/api/t/me').set('Authorization', `Bearer ${token}`).expect(200);
      expect(res.body.data).toEqual({ id, role: Role.CUSTOMER });
    });

    it('customer is 403 on an admin route; admin is allowed', async () => {
      const customer = await ctx.login(Role.CUSTOMER);
      const admin = await ctx.login(Role.ADMIN);
      const denied = await http()
        .get('/api/t/admin')
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(403);
      expect(denied.body).toMatchObject({ success: false, error: { statusCode: 403 } });
      await http().get('/api/t/admin').set('Authorization', `Bearer ${admin.token}`).expect(200);
    });

    it('demo viewer is 403 on admin and on routes not granting its role', async () => {
      const viewer = await ctx.login(Role.DEMO_VIEWER);
      await http().get('/api/t/admin').set('Authorization', `Bearer ${viewer.token}`).expect(403);
      await http().get('/api/t/shop').set('Authorization', `Bearer ${viewer.token}`).expect(403);
    });

    it('a demotion applies to an already-issued token immediately', async () => {
      const { id, token } = await ctx.login(Role.ADMIN);
      await http().get('/api/t/admin').set('Authorization', `Bearer ${token}`).expect(200);
      ctx.repo.records.set(id, { ...ctx.repo.records.get(id)!, role: Role.CUSTOMER });
      await http().get('/api/t/admin').set('Authorization', `Bearer ${token}`).expect(403);
    });

    it('a route that is both @Public and @Roles denies instead of leaking', async () => {
      await http().get('/api/t/misconfigured').expect(403);
    });
  });

  describe('demo viewer is read-only and sees only synthetic data', () => {
    it('can read', async () => {
      const { token } = await ctx.login(Role.DEMO_VIEWER);
      await http().get('/api/t/me').set('Authorization', `Bearer ${token}`).expect(200);
    });

    it.each(['post', 'put', 'patch', 'delete'] as const)('%s is 403', async (method) => {
      const { token } = await ctx.login(Role.DEMO_VIEWER);
      const res = await http()
        [method]('/api/t/write')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(res.body.error.message).toBe('Demo accounts are read-only');
    });

    it('other roles can write', async () => {
      for (const role of [Role.CUSTOMER, Role.ADMIN]) {
        const { token } = await ctx.login(role);
        await http().post('/api/t/write').set('Authorization', `Bearer ${token}`).expect(201);
      }
    });

    it('the demo scope hides real records from the demo viewer only', async () => {
      const viewer = await ctx.login(Role.DEMO_VIEWER);
      const customer = await ctx.login(Role.CUSTOMER);
      const asViewer = await http()
        .get('/api/t/data')
        .set('Authorization', `Bearer ${viewer.token}`)
        .expect(200);
      const asCustomer = await http()
        .get('/api/t/data')
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(200);
      expect(asViewer.body.data).toEqual(['demo-1']);
      expect(asCustomer.body.data).toEqual(['real-1', 'demo-1']);
    });
  });
});
