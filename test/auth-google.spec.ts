import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { LIMITS } from '../src/auth/auth.service';
import { hashPassword } from '../src/auth/password';
import { Role } from '../src/users/role';
import { AuthTestApp, createAuthApp } from './helpers/create-auth-app';

jest.setTimeout(30_000);

const PASSWORD = 'correct horse battery staple';

describe('Google sign-in', () => {
  let t: AuthTestApp;
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const nonce = async () =>
    (await http().get('/api/auth/google/nonce').expect(200)).body.data as {
      nonce: string;
      nonceToken: string;
    };
  /** One complete browser round trip: get a nonce, "Google" signs a token containing it, post it. */
  const signIn = async (identity: {
    email: string;
    sub?: string;
    emailVerified?: boolean;
    name?: string;
  }) => {
    const n = await nonce();
    const credential = t.google.issue(identity, n.nonce);
    return http().post('/api/auth/google').send({ credential, nonceToken: n.nonceToken });
  };
  const registerAndVerify = async (email: string) => {
    await http()
      .post('/api/auth/signup')
      .send({ email, password: PASSWORD, name: 'Local' })
      .expect(202);
    await http()
      .post('/api/auth/verify-email')
      .send({ email, code: t.mail.lastCodeFor(email) })
      .expect(200);
  };

  beforeEach(async () => {
    t = await createAuthApp();
    app = t.app;
  });
  afterEach(() => app.close());

  it('creates a verified, non-demo CUSTOMER for a new Google user and signs them in', async () => {
    const res = await signIn({ email: 'Ada@Example.com', sub: 'g-ada', name: 'Ada Lovelace' });
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      role: 'CUSTOMER',
      isDemo: false,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|googleSub|g-ada/);
    const stored = await t.repo.findByEmail('ada@example.com');
    expect(stored).toMatchObject({
      role: Role.CUSTOMER,
      isDemo: false,
      emailVerified: true,
      googleSub: 'g-ada',
    });
    // The existing JWT + refresh-token session works like any login.
    const { accessToken, refreshToken } = res.body.data.Credentials;
    await http().get('/api/auth/profile').set('Authorization', `Bearer ${accessToken}`).expect(200);
    await http().post('/api/auth/refresh').send({ refreshToken }).expect(200);
  });

  it('signs the same Google account in again without creating a duplicate', async () => {
    await signIn({ email: 'ada@example.com', sub: 'g-ada' });
    const again = await signIn({ email: 'ada@example.com', sub: 'g-ada' });
    expect(again.status).toBe(200);
    expect([...t.repo.records.values()].filter((u) => u.email === 'ada@example.com')).toHaveLength(
      1,
    );
  });

  it('links Google to an existing verified customer and keeps their password working', async () => {
    await registerAndVerify('grace@example.com');
    const before = await t.repo.findByEmail('grace@example.com');
    const res = await signIn({ email: 'grace@example.com', sub: 'g-grace' });
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(before!.id);
    expect((await t.repo.findByEmail('grace@example.com'))!.googleSub).toBe('g-grace');
    await http()
      .post('/api/auth/login')
      .send({ email: 'grace@example.com', password: PASSWORD })
      .expect(200);
  });

  it('defeats pre-hijacking: linking an UNVERIFIED account replaces its password and ends its sessions', async () => {
    // Someone registers the victim's address with their own password but cannot verify it.
    await http()
      .post('/api/auth/signup')
      .send({ email: 'victim@example.com', password: PASSWORD, name: 'Attacker' })
      .expect(202);
    const res = await signIn({ email: 'victim@example.com', sub: 'g-victim' });
    expect(res.status).toBe(200);
    const stored = await t.repo.findByEmail('victim@example.com');
    expect(stored).toMatchObject({ emailVerified: true, googleSub: 'g-victim', tokenVersion: 1 });
    // The attacker's chosen password no longer works.
    expect(
      (
        await http()
          .post('/api/auth/login')
          .send({ email: 'victim@example.com', password: PASSWORD })
      ).status,
    ).toBe(401);
  });

  it('never signs in to, or links, an admin or a demo account', async () => {
    for (const [email, role, isDemo] of [
      ['owner@example.com', Role.ADMIN, false],
      ['demo-viewer@example.com', Role.DEMO_VIEWER, true],
      ['demo-customer@example.com', Role.CUSTOMER, true],
    ] as const) {
      await t.users.create({
        email,
        name: 'Staff',
        passwordHash: await hashPassword(PASSWORD),
        role,
        isDemo,
        emailVerified: true,
      });
      const res = await signIn({ email, sub: `g-${email}` });
      expect(res.status).toBe(403);
      expect(res.body.error.message).toBe('This account signs in with its email and password.');
      expect((await t.repo.findByEmail(email))!.googleSub).toBeUndefined();
    }
  });

  it('refuses a second Google account for an email that is already linked (409, no duplicate)', async () => {
    await signIn({ email: 'ada@example.com', sub: 'g-ada' });
    const other = await signIn({ email: 'ada@example.com', sub: 'g-someone-else' });
    expect(other.status).toBe(409);
    expect([...t.repo.records.values()]).toHaveLength(1);
  });

  it('refuses a Google account whose email Google has not verified', async () => {
    const res = await signIn({ email: 'new@example.com', emailVerified: false });
    expect(res.status).toBe(403);
    expect(t.repo.records.size).toBe(0);
  });

  it('rejects an ID token Google would not vouch for (invalid, expired, wrong audience) with one 401', async () => {
    const n = await nonce();
    const res = await http()
      .post('/api/auth/google')
      .send({ credential: 'forged-'.padEnd(150, 'x'), nonceToken: n.nonceToken });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Google sign-in could not be verified. Please try again.');
  });

  it('rejects a replayed nonce ticket, a mismatched nonce and a tampered ticket', async () => {
    const n = await nonce();
    const credential = t.google.issue({ email: 'ada@example.com' }, n.nonce);
    await http()
      .post('/api/auth/google')
      .send({ credential, nonceToken: n.nonceToken })
      .expect(200);
    // Replay of the same ID token + ticket.
    expect(
      (await http().post('/api/auth/google').send({ credential, nonceToken: n.nonceToken })).status,
    ).toBe(401);
    // A token minted for another session's nonce.
    const other = await nonce();
    const foreign = t.google.issue({ email: 'bob@example.com' }, 'some-other-nonce');
    expect(
      (
        await http()
          .post('/api/auth/google')
          .send({ credential: foreign, nonceToken: other.nonceToken })
      ).status,
    ).toBe(401);
    // A tampered ticket.
    const fresh = await nonce();
    const cred = t.google.issue({ email: 'carol@example.com' }, fresh.nonce);
    expect(
      (
        await http()
          .post('/api/auth/google')
          .send({ credential: cred, nonceToken: `${fresh.nonceToken}x` })
      ).status,
    ).toBe(401);
  });

  it('validates the body strictly: no role, no profile fields from the browser', async () => {
    const n = await nonce();
    const credential = t.google.issue({ email: 'ada@example.com' }, n.nonce);
    for (const body of [
      { credential, nonceToken: n.nonceToken, role: 'ADMIN' },
      { credential, nonceToken: n.nonceToken, email: 'someone@else.com' },
      { credential },
      {},
    ]) {
      expect((await http().post('/api/auth/google').send(body)).status).toBe(400);
    }
    expect(t.repo.records.size).toBe(0);
  });

  it('a Google customer gets the normal customer rights and nothing more', async () => {
    const token = (await signIn({ email: 'ada@example.com' })).body.data.Credentials.accessToken;
    await http().get('/api/cart').set('Authorization', `Bearer ${token}`).expect(200);
    await http().get('/api/admin/stats').set('Authorization', `Bearer ${token}`).expect(403);
    await http().post('/api/coupon').set('Authorization', `Bearer ${token}`).send({}).expect(403);
  });

  it('is rate limited per client address', async () => {
    for (let i = 0; i < LIMITS.googlePerIp; i++)
      await http()
        .post('/api/auth/google')
        .send({ credential: 'x'.repeat(150), nonceToken: 'y'.repeat(30) });
    const blocked = await http()
      .post('/api/auth/google')
      .send({ credential: 'x'.repeat(150), nonceToken: 'y'.repeat(30) });
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('is switched off (503) when GOOGLE_CLIENT_ID is not configured', async () => {
    t.google.configured = false;
    expect((await http().get('/api/auth/google/nonce')).status).toBe(503);
    expect(
      (
        await http()
          .post('/api/auth/google')
          .send({ credential: 'x'.repeat(150), nonceToken: 'y'.repeat(30) })
      ).status,
    ).toBe(503);
  });
});

describe('password reset hardening', () => {
  let t: AuthTestApp;
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  beforeEach(async () => {
    t = await createAuthApp();
    app = t.app;
  });
  afterEach(() => app.close());

  const verifiedUser = async (email: string) => {
    await http()
      .post('/api/auth/signup')
      .send({ email, password: PASSWORD, name: 'R' })
      .expect(202);
    await http()
      .post('/api/auth/verify-email')
      .send({ email, code: t.mail.lastCodeFor(email) })
      .expect(200);
    return (await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200))
      .body.data.Credentials as { accessToken: string; refreshToken: string };
  };

  it('rejects an expired reset code', async () => {
    await verifiedUser('reset@example.com');
    await http().post('/api/auth/forgot-password').send({ email: 'reset@example.com' }).expect(202);
    const code = t.mail.lastCodeFor('reset@example.com');
    for (const otp of t.otps.records.values()) otp.expiresAt = new Date(Date.now() - 1000);
    const res = await http()
      .post('/api/auth/reset-password')
      .send({ email: 'reset@example.com', code, newPassword: 'a brand new long password' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Invalid or expired code');
  });

  it('a successful reset ends every existing session, access tokens included', async () => {
    const before = await verifiedUser('reset@example.com');
    await http().post('/api/auth/forgot-password').send({ email: 'reset@example.com' }).expect(202);
    await http()
      .post('/api/auth/reset-password')
      .send({
        email: 'reset@example.com',
        code: t.mail.lastCodeFor('reset@example.com'),
        newPassword: 'a brand new long password',
      })
      .expect(200);
    expect(
      (await http().get('/api/auth/profile').set('Authorization', `Bearer ${before.accessToken}`))
        .status,
    ).toBe(401);
    expect(
      (await http().post('/api/auth/refresh').send({ refreshToken: before.refreshToken })).status,
    ).toBe(401);
    expect(
      (
        await http()
          .post('/api/auth/login')
          .send({ email: 'reset@example.com', password: PASSWORD })
      ).status,
    ).toBe(401);
    await http()
      .post('/api/auth/login')
      .send({ email: 'reset@example.com', password: 'a brand new long password' })
      .expect(200);
  });

  it('forgot-password answers identically whether or not the email exists, and never returns the code', async () => {
    await verifiedUser('known@example.com');
    const known = await http()
      .post('/api/auth/forgot-password')
      .send({ email: 'known@example.com' });
    const unknown = await http()
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' });
    expect(known.status).toBe(unknown.status);
    expect(known.body.data).toEqual(unknown.body.data);
    expect(JSON.stringify(known.body)).not.toMatch(/\b\d{6}\b/);
  });
});
