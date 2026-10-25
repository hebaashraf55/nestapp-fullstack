import request from 'supertest';
import jwt from 'jsonwebtoken';
import { OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_MS, OTP_TTL_MS } from '../src/auth/auth.service';
import { hashPassword } from '../src/auth/password';
import { Role } from '../src/users/role';
import { AuthTestApp, createAuthApp, TEST_SECRET } from './helpers/create-auth-app';

const PASSWORD = 'correct horse battery staple';
const EMAIL = 'heba@example.com';

describe('authentication flows over HTTP', () => {
  let ctx: AuthTestApp;
  const http = () => request(ctx.app.getHttpServer());
  const post = (path: string, body: unknown) =>
    http()
      .post(`/api/auth${path}`)
      .send(body as object);

  async function signupAndVerify(email = EMAIL, password = PASSWORD) {
    await post('/signup', { email, password, name: 'Heba' }).expect(202);
    await post('/verify-email', { email, code: ctx.mail.lastCodeFor(email) }).expect(200);
  }
  async function loginOk(email = EMAIL, password = PASSWORD) {
    const res = await post('/login', { email, password }).expect(200);
    return res.body.data as {
      Credentials: { accessToken: string; refreshToken: string };
      user: Record<string, unknown>;
    };
  }

  beforeEach(async () => {
    ctx = await createAuthApp();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  describe('signup', () => {
    it('creates an unverified, non-demo CUSTOMER and mails a code', async () => {
      const res = await post('/signup', { email: EMAIL, password: PASSWORD, name: 'Heba' }).expect(
        202,
      );
      expect(res.body.success).toBe(true);
      const user = await ctx.users.findByEmail(EMAIL);
      expect(user).toMatchObject({
        role: Role.CUSTOMER,
        isDemo: false,
        emailVerified: false,
        name: 'Heba',
      });
      expect(ctx.mail.sent).toHaveLength(1);
      expect(ctx.mail.sent[0]).toMatchObject({ to: EMAIL });
    });

    it('stores a salted hash, never the password, and never returns a hash', async () => {
      const res = await post('/signup', { email: EMAIL, password: PASSWORD, name: 'Heba' }).expect(
        202,
      );
      const user = await ctx.users.findByEmail(EMAIL);
      expect(user?.passwordHash).toMatch(/^scrypt\$/);
      expect(JSON.stringify(res.body)).not.toMatch(/scrypt|password/i);
    });

    it.each([
      ['role', { role: 'ADMIN' }],
      ['isDemo', { isDemo: true }],
      ['emailVerified', { emailVerified: true }],
      ['an unknown field', { extra: 1 }],
    ])('rejects a request that includes %s (no privilege escalation)', async (_label, extra) => {
      const res = await post('/signup', {
        email: EMAIL,
        password: PASSWORD,
        name: 'H',
        ...extra,
      }).expect(400);
      expect(res.body.error.details).toEqual([
        expect.objectContaining({ message: expect.stringMatching(/unrecognized/i) }),
      ]);
      expect(await ctx.users.findByEmail(EMAIL)).toBeNull();
    });

    it.each([
      ['a short password', { email: EMAIL, password: 'short', name: 'H' }],
      ['an over-long password', { email: EMAIL, password: 'x'.repeat(129), name: 'H' }],
      ['a bad email', { email: 'not-an-email', password: PASSWORD, name: 'H' }],
      ['an empty name', { email: EMAIL, password: PASSWORD, name: '  ' }],
      ['a non-string password', { email: EMAIL, password: 123456789012, name: 'H' }],
      ['an object as email', { email: { $ne: '' }, password: PASSWORD, name: 'H' }],
      ['a missing body', undefined],
    ])('rejects %s with 400 and does not echo the input', async (_label, body) => {
      const res = await post('/signup', body).expect(400);
      expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
      expect(JSON.stringify(res.body)).not.toMatch(/stack/i);
    });

    it('normalizes the email (case and whitespace)', async () => {
      await post('/signup', { email: '  Heba@EXAMPLE.com ', password: PASSWORD, name: 'H' }).expect(
        202,
      );
      expect(await ctx.users.findByEmail('heba@example.com')).not.toBeNull();
    });

    it('answers identically for a new and an already-verified email (no enumeration)', async () => {
      await signupAndVerify();
      const fresh = await post('/signup', {
        email: 'new@example.com',
        password: PASSWORD,
        name: 'N',
      });
      const existing = await post('/signup', { email: EMAIL, password: PASSWORD, name: 'Other' });
      expect(existing.status).toBe(fresh.status);
      const strip = (b: { data: unknown }) => b.data;
      expect(strip(existing.body)).toEqual(strip(fresh.body));
    });

    it('does not let a second signup change an existing account (no pre-hijacking)', async () => {
      await post('/signup', { email: EMAIL, password: PASSWORD, name: 'Victim' }).expect(202);
      const before = (await ctx.users.findByEmail(EMAIL))!.passwordHash;
      await post('/signup', {
        email: EMAIL,
        password: 'attacker-chosen-password',
        name: 'Mallory',
      }).expect(202);
      const after = await ctx.users.findByEmail(EMAIL);
      expect(after?.passwordHash).toBe(before);
      expect(after?.name).toBe('Victim');
    });

    it('cannot be used to take over a demo account', async () => {
      await ctx.users.create({
        email: 'demo-viewer@example.com',
        name: 'Demo',
        passwordHash: await hashPassword('demo-password-1'),
        role: Role.DEMO_VIEWER,
        isDemo: true,
        emailVerified: true,
      });
      await post('/signup', {
        email: 'demo-viewer@example.com',
        password: PASSWORD,
        name: 'X',
      }).expect(202);
      expect(ctx.mail.sent).toHaveLength(0);
    });

    it('still answers 202 if the mail transport fails, and logs nothing sensitive', async () => {
      ctx.mail.failWith = new Error('smtp auth failed for user:pw@host');
      await post('/signup', { email: EMAIL, password: PASSWORD, name: 'H' }).expect(202);
    });
  });

  describe('email verification', () => {
    beforeEach(async () => {
      await post('/signup', { email: EMAIL, password: PASSWORD, name: 'H' }).expect(202);
    });

    it('stores the code only as a hash', () => {
      const code = ctx.mail.lastCodeFor(EMAIL);
      const stored = [...ctx.otps.records.values()][0]!;
      expect(JSON.stringify(stored)).not.toContain(code);
      expect(stored.codeHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('verifies with the right code, once', async () => {
      const code = ctx.mail.lastCodeFor(EMAIL);
      await post('/verify-email', { email: EMAIL, code }).expect(200);
      expect((await ctx.users.findByEmail(EMAIL))?.emailVerified).toBe(true);
      await post('/verify-email', { email: EMAIL, code }).expect(400); // single use
    });

    it('rejects a wrong code, an unknown email and a malformed code identically', async () => {
      const right = ctx.mail.lastCodeFor(EMAIL);
      const wrong = right === '000000' ? '000001' : '000000';
      const bodies = [
        (await post('/verify-email', { email: EMAIL, code: wrong }).expect(400)).body.error,
        (await post('/verify-email', { email: 'nobody@example.com', code: wrong }).expect(400)).body
          .error,
      ];
      expect(bodies[0].message).toBe('Invalid or expired code');
      expect(bodies[1].message).toBe('Invalid or expired code');
      await post('/verify-email', { email: EMAIL, code: '12ab56' }).expect(400);
    });

    it('locks the code after too many wrong attempts, even for the right code', async () => {
      const right = ctx.mail.lastCodeFor(EMAIL);
      const wrong = right === '000000' ? '000001' : '000000';
      for (let i = 0; i < OTP_MAX_ATTEMPTS; i++)
        await post('/verify-email', { email: EMAIL, code: wrong }).expect(400);
      await post('/verify-email', { email: EMAIL, code: right }).expect(400);
      expect((await ctx.users.findByEmail(EMAIL))?.emailVerified).toBe(false);
    });

    it('rejects an expired code', async () => {
      const code = ctx.mail.lastCodeFor(EMAIL);
      const record = [...ctx.otps.records.values()][0]!;
      record.expiresAt = new Date(Date.now() - 1);
      await post('/verify-email', { email: EMAIL, code }).expect(400);
      expect(OTP_TTL_MS).toBe(600_000);
    });

    it('resend respects a cooldown, then issues a fresh code that replaces the old one', async () => {
      const first = ctx.mail.lastCodeFor(EMAIL);
      await post('/resend-otp', { email: EMAIL }).expect(202);
      expect(ctx.mail.sent).toHaveLength(1); // cooldown: no second email yet
      [...ctx.otps.records.values()][0]!.sentAt = new Date(Date.now() - OTP_RESEND_COOLDOWN_MS - 1);
      await post('/resend-otp', { email: EMAIL }).expect(202);
      expect(ctx.mail.sent).toHaveLength(2);
      const second = ctx.mail.lastCodeFor(EMAIL);
      expect(ctx.otps.records.size).toBe(1);
      if (second !== first) await post('/verify-email', { email: EMAIL, code: first }).expect(400);
      await post('/verify-email', { email: EMAIL, code: second }).expect(200);
    });

    it('resend for an unknown email looks identical and sends nothing', async () => {
      const res = await post('/resend-otp', { email: 'ghost@example.com' }).expect(202);
      expect(res.body.data.message).toBeDefined();
      expect(ctx.mail.sent).toHaveLength(1); // only the signup mail
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      await signupAndVerify();
    });

    it('returns the original Credentials shape plus a safe user, and the token works', async () => {
      const { Credentials, user } = await loginOk();
      expect(Object.keys(Credentials).sort()).toEqual(['accessToken', 'refreshToken']);
      expect(user).toMatchObject({ email: EMAIL, role: Role.CUSTOMER, isDemo: false });
      expect(JSON.stringify(user)).not.toMatch(/scrypt|passwordHash/);
      const me = await http()
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${Credentials.accessToken}`)
        .expect(200);
      expect(me.body.data).toMatchObject({ email: EMAIL, role: Role.CUSTOMER });
      expect(JSON.stringify(me.body)).not.toMatch(/scrypt|passwordHash/);
    });

    it('stores only a hash of the refresh token', async () => {
      const { Credentials } = await loginOk();
      expect(JSON.stringify([...ctx.refreshTokens.records.values()])).not.toContain(
        Credentials.refreshToken,
      );
    });

    it('accepts the email in any case', async () => {
      await post('/login', { email: 'HEBA@Example.com', password: PASSWORD }).expect(200);
    });

    it('gives the same generic 401 for a wrong password and an unknown email', async () => {
      const wrong = await post('/login', { email: EMAIL, password: 'wrong-password-123' }).expect(
        401,
      );
      const unknown = await post('/login', {
        email: 'nobody@example.com',
        password: 'wrong-password-123',
      }).expect(401);
      expect(wrong.body.error).toEqual(unknown.body.error);
      expect(wrong.body.error.message).toBe('Invalid email or password');
    });

    it('rejects malformed input with 400 and injection-style input safely', async () => {
      await post('/login', { email: EMAIL }).expect(400);
      await post('/login', { email: { $gt: '' }, password: { $gt: '' } }).expect(400);
      await post('/login', { email: EMAIL, password: PASSWORD, role: 'ADMIN' }).expect(400);
      await post('/login', { email: EMAIL, password: 'x'.repeat(5000) }).expect(400);
    });

    it('refuses an unverified account only after the password is right', async () => {
      await post('/signup', { email: 'new@example.com', password: PASSWORD, name: 'N' }).expect(
        202,
      );
      await post('/login', { email: 'new@example.com', password: 'wrong-password-123' }).expect(
        401,
      );
      const res = await post('/login', { email: 'new@example.com', password: PASSWORD }).expect(
        403,
      );
      expect(res.body.error.message).toBe('Email not verified');
    });

    it('throttles repeated failures per account with 429 and Retry-After, and even blocks the right password', async () => {
      for (let i = 0; i < 5; i++)
        await post('/login', { email: EMAIL, password: 'wrong-password-123' }).expect(401);
      const blocked = await post('/login', { email: EMAIL, password: PASSWORD }).expect(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect(blocked.body.error.message).toBe('Too many attempts. Please try again later.');
      // another account is unaffected
      await signupAndVerify('other@example.com');
      await post('/login', { email: 'other@example.com', password: PASSWORD }).expect(200);
    });

    it('lets the account back in once the window passes', async () => {
      for (let i = 0; i < 5; i++)
        await post('/login', { email: EMAIL, password: 'wrong-password-123' }).expect(401);
      await post('/login', { email: EMAIL, password: PASSWORD }).expect(429);
      const start = Date.now();
      ctx.limiter.now = () => start + 16 * 60_000;
      await post('/login', { email: EMAIL, password: PASSWORD }).expect(200);
    });

    it('a successful login clears the failure count', async () => {
      for (let i = 0; i < 4; i++)
        await post('/login', { email: EMAIL, password: 'wrong-password-123' }).expect(401);
      await post('/login', { email: EMAIL, password: PASSWORD }).expect(200);
      for (let i = 0; i < 4; i++)
        await post('/login', { email: EMAIL, password: 'wrong-password-123' }).expect(401);
    });

    it('throttles one address spraying many accounts', async () => {
      for (let i = 0; i < 30; i++) {
        await post('/login', {
          email: `user${i}@example.com`,
          password: 'wrong-password-123',
        }).expect(401);
      }
      await post('/login', { email: 'user31@example.com', password: 'wrong-password-123' }).expect(
        429,
      );
    }, 90_000);
  });

  describe('refresh tokens', () => {
    beforeEach(async () => {
      await signupAndVerify();
    });

    it('rotates: the new token works, the old one is revoked', async () => {
      const { Credentials } = await loginOk();
      const refreshed = await post('/refresh', { refreshToken: Credentials.refreshToken }).expect(
        200,
      );
      const next = refreshed.body.data.Credentials as { accessToken: string; refreshToken: string };
      expect(next.refreshToken).not.toBe(Credentials.refreshToken);
      await http()
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${next.accessToken}`)
        .expect(200);
    });

    it('replaying an already-used refresh token ends the whole session family', async () => {
      const { Credentials } = await loginOk();
      const next = (await post('/refresh', { refreshToken: Credentials.refreshToken }).expect(200))
        .body.data.Credentials as { refreshToken: string };
      await post('/refresh', { refreshToken: Credentials.refreshToken }).expect(401); // replay
      await post('/refresh', { refreshToken: next.refreshToken }).expect(401); // family revoked
    });

    it('rejects unknown, expired and malformed refresh tokens with one generic 401', async () => {
      const { Credentials } = await loginOk();
      [...ctx.refreshTokens.records.values()][0]!.expiresAt = new Date(Date.now() - 1);
      const expired = await post('/refresh', { refreshToken: Credentials.refreshToken }).expect(
        401,
      );
      const unknown = await post('/refresh', { refreshToken: 'x'.repeat(43) }).expect(401);
      expect(expired.body.error.message).toBe('Invalid refresh token');
      expect(unknown.body.error.message).toBe('Invalid refresh token');
      await post('/refresh', { refreshToken: 'short' }).expect(400);
    });

    it('two simultaneous refreshes with one token: exactly one wins', async () => {
      const { Credentials } = await loginOk();
      const results = await Promise.all([
        post('/refresh', { refreshToken: Credentials.refreshToken }),
        post('/refresh', { refreshToken: Credentials.refreshToken }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    });

    it('an access token is not accepted as a refresh token and vice versa', async () => {
      const { Credentials } = await loginOk();
      // A JWT is longer than any refresh token, so validation (400) or the lookup (401) rejects it.
      const asRefresh = await post('/refresh', { refreshToken: Credentials.accessToken });
      expect([400, 401]).toContain(asRefresh.status);
      await http()
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${Credentials.refreshToken}`)
        .expect(401);
    });
  });

  describe('logout', () => {
    beforeEach(async () => {
      await signupAndVerify();
    });

    it('revokes only the presented session; other sessions keep working', async () => {
      const a = await loginOk();
      const b = await loginOk();
      await post('/logout', { refreshToken: a.Credentials.refreshToken }).expect(200);
      await post('/refresh', { refreshToken: a.Credentials.refreshToken }).expect(401);
      await post('/refresh', { refreshToken: b.Credentials.refreshToken }).expect(200);
    });

    it('is idempotent and reveals nothing about unknown tokens', async () => {
      const res = await post('/logout', { refreshToken: 'x'.repeat(43) }).expect(200);
      expect(res.body.data).toEqual({ loggedOut: true });
    });

    it('logout-all invalidates access tokens and every refresh token at once', async () => {
      const a = await loginOk();
      const b = await loginOk();
      await http()
        .post('/api/auth/logout-all')
        .set('Authorization', `Bearer ${a.Credentials.accessToken}`)
        .expect(200);
      await http()
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${a.Credentials.accessToken}`)
        .expect(401);
      await http()
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${b.Credentials.accessToken}`)
        .expect(401);
      await post('/refresh', { refreshToken: b.Credentials.refreshToken }).expect(401);
    });

    it('logout-all requires authentication', async () => {
      await http().post('/api/auth/logout-all').expect(401);
    });
  });

  describe('password recovery', () => {
    beforeEach(async () => {
      await signupAndVerify();
    });

    async function requestReset() {
      await post('/forgot-password', { email: EMAIL }).expect(202);
      return ctx.mail.lastCodeFor(EMAIL);
    }

    it('answers identically for known and unknown emails', async () => {
      const known = await post('/forgot-password', { email: EMAIL });
      const unknown = await post('/forgot-password', { email: 'ghost@example.com' });
      expect(known.status).toBe(unknown.status);
      expect(known.body.data).toEqual(unknown.body.data);
    });

    it('resets the password, invalidates old sessions, and the code is single use', async () => {
      const session = await loginOk();
      const code = await requestReset();
      await post('/reset-password', {
        email: EMAIL,
        code,
        newPassword: 'a brand new long password',
      }).expect(200);
      await post('/login', { email: EMAIL, password: PASSWORD }).expect(401);
      await post('/login', { email: EMAIL, password: 'a brand new long password' }).expect(200);
      await http()
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${session.Credentials.accessToken}`)
        .expect(401);
      await post('/refresh', { refreshToken: session.Credentials.refreshToken }).expect(401);
      await post('/reset-password', {
        email: EMAIL,
        code,
        newPassword: 'another long password!',
      }).expect(400);
    });

    it('rejects a wrong code, enforces the attempt limit and a minimum new-password length', async () => {
      const right = await requestReset();
      const wrong = right === '000000' ? '000001' : '000000';
      await post('/reset-password', { email: EMAIL, code: right, newPassword: 'short' }).expect(
        400,
      );
      for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
        await post('/reset-password', {
          email: EMAIL,
          code: wrong,
          newPassword: 'a brand new long password',
        }).expect(400);
      }
      await post('/reset-password', {
        email: EMAIL,
        code: right,
        newPassword: 'a brand new long password',
      }).expect(400);
      await post('/login', { email: EMAIL, password: PASSWORD }).expect(200); // password unchanged
    });

    it('a verify-email code cannot be used to reset a password, and vice versa', async () => {
      await post('/signup', { email: 'x@example.com', password: PASSWORD, name: 'X' }).expect(202);
      const verifyCode = ctx.mail.lastCodeFor('x@example.com');
      await post('/reset-password', {
        email: 'x@example.com',
        code: verifyCode,
        newPassword: 'a brand new long password',
      }).expect(400);
    });

    it('never works for demo accounts: no email, no reset', async () => {
      await ctx.users.create({
        email: 'demo-customer@example.com',
        name: 'Demo',
        passwordHash: await hashPassword('demo-password-1'),
        role: Role.CUSTOMER,
        isDemo: true,
        emailVerified: true,
      });
      const before = ctx.mail.sent.length;
      await post('/forgot-password', { email: 'demo-customer@example.com' }).expect(202);
      expect(ctx.mail.sent.length).toBe(before);
      await post('/reset-password', {
        email: 'demo-customer@example.com',
        code: '123456',
        newPassword: 'a brand new long password',
      }).expect(400);
    });

    it('a reset also verifies an unverified account (the code proved mailbox control)', async () => {
      await post('/signup', { email: 'late@example.com', password: PASSWORD, name: 'L' }).expect(
        202,
      );
      await post('/forgot-password', { email: 'late@example.com' }).expect(202);
      // issued within the cooldown for a different purpose: separate record, so it was sent
      const code = ctx.mail.lastCodeFor('late@example.com');
      await post('/reset-password', {
        email: 'late@example.com',
        code,
        newPassword: 'a brand new long password',
      }).expect(200);
      await post('/login', {
        email: 'late@example.com',
        password: 'a brand new long password',
      }).expect(200);
    });
  });

  describe('role boundaries', () => {
    it('demo viewer can log in, read, and log out its own session, but nothing else', async () => {
      const password = 'demo-password-12';
      await ctx.users.create({
        email: 'demo-viewer@example.com',
        name: 'Demo Viewer',
        passwordHash: await hashPassword(password),
        role: Role.DEMO_VIEWER,
        isDemo: true,
        emailVerified: true,
      });
      const { Credentials, user } = (
        await post('/login', { email: 'demo-viewer@example.com', password }).expect(200)
      ).body.data;
      expect(user).toMatchObject({ role: Role.DEMO_VIEWER, isDemo: true });
      const auth = { Authorization: `Bearer ${Credentials.accessToken}` };

      await http().get('/api/auth/profile').set(auth).expect(200);
      // every other write is still refused:
      const denied = await http().post('/api/auth/logout-all').set(auth).expect(403);
      expect(denied.body.error.message).toBe('Demo accounts are read-only');
      // but ending its own session works, and only affects that session:
      await post('/logout', { refreshToken: Credentials.refreshToken }).expect(200);
      await post('/refresh', { refreshToken: Credentials.refreshToken }).expect(401);
      // the access token for the shared demo user keeps working until it expires (no global kick-out)
      await http().get('/api/auth/profile').set(auth).expect(200);
    });

    it('a role change in the database applies to the next request on an existing token', async () => {
      await signupAndVerify();
      const { Credentials } = await loginOk();
      const me = (await ctx.users.findByEmail(EMAIL))!;
      await http()
        .post('/api/auth/logout-all')
        .set('Authorization', `Bearer ${Credentials.accessToken}`)
        .expect(200);
      // a fresh login after demotion to demo viewer is read-only immediately
      await ctx.users.setRole(me.id, Role.DEMO_VIEWER, true);
      const again = await loginOk();
      await http()
        .post('/api/auth/logout-all')
        .set('Authorization', `Bearer ${again.Credentials.accessToken}`)
        .expect(403);
      await http()
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${again.Credentials.accessToken}`)
        .expect(200);
    });

    it('a token whose version no longer matches is rejected even if everything else is valid', async () => {
      await signupAndVerify();
      const { Credentials } = await loginOk();
      const me = (await ctx.users.findByEmail(EMAIL))!;
      await ctx.users.bumpTokenVersion(me.id);
      await http()
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${Credentials.accessToken}`)
        .expect(401);
    });

    it('an expired access token is rejected', async () => {
      await signupAndVerify();
      const me = (await ctx.users.findByEmail(EMAIL))!;
      const expired = jwt.sign({ ver: 0 }, TEST_SECRET, {
        subject: me.id,
        issuer: 'nestapp-fullstack',
        expiresIn: -1,
      });
      await http().get('/api/auth/profile').set('Authorization', `Bearer ${expired}`).expect(401);
    });

    it('the public auth routes work with no token, and profile does not', async () => {
      await http().get('/api/auth/profile').expect(401);
      await post('/forgot-password', { email: EMAIL }).expect(202);
    });
  });

  describe('storage failures', () => {
    it('are generic 503s that leak nothing', async () => {
      ctx.repo.failWith = new Error('connect ECONNREFUSED mongodb://root:pa55word@10.1.1.1');
      const res = await post('/login', { email: EMAIL, password: PASSWORD }).expect(500);
      expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|pa55word|10\.1\.1\.1|mongodb/);
    });
  });
});
