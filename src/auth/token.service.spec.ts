import jwt from 'jsonwebtoken';
import { loadEnv } from '../config/env';
import { TokenService } from './token.service';

const secret = 's'.repeat(40);
const make = (env: NodeJS.ProcessEnv = { JWT_SECRET: secret }) => new TokenService(loadEnv(env));

describe('TokenService', () => {
  it('round-trips a user id', () => {
    const tokens = make();
    expect(tokens.verify(tokens.sign('user-1', 3))).toEqual({ userId: 'user-1', tokenVersion: 3 });
  });

  it('carries no role or personal data, only the subject', () => {
    const payload = jwt.decode(make().sign('user-1')) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'iss', 'sub', 'ver']);
  });

  it('rejects a token signed with another secret', () => {
    const forged = jwt.sign({}, 'z'.repeat(40), { subject: 'u', issuer: 'nestapp-fullstack' });
    expect(make().verify(forged)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const [h, , s] = make().sign('user-1').split('.') as [string, string, string];
    const evil = Buffer.from(JSON.stringify({ sub: 'admin', iss: 'nestapp-fullstack' })).toString(
      'base64url',
    );
    expect(make().verify(`${h}.${evil}.${s}`)).toBeNull();
  });

  it('rejects an unsigned "alg: none" token', () => {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: 'admin', iss: 'nestapp-fullstack' })}.`;
    expect(make().verify(none)).toBeNull();
  });

  it('rejects a different HMAC algorithm even with the right secret', () => {
    const hs512 = jwt.sign({}, secret, {
      algorithm: 'HS512',
      subject: 'u',
      issuer: 'nestapp-fullstack',
    });
    expect(make().verify(hs512)).toBeNull();
  });

  it('rejects an expired token, a foreign issuer, and a token with no subject', () => {
    const expired = jwt.sign({}, secret, {
      subject: 'u',
      issuer: 'nestapp-fullstack',
      expiresIn: -10,
    });
    const foreign = jwt.sign({}, secret, { subject: 'u', issuer: 'someone-else' });
    const noSub = jwt.sign({}, secret, { issuer: 'nestapp-fullstack' });
    for (const t of [expired, foreign, noSub]) expect(make().verify(t)).toBeNull();
  });

  it('rejects a validly signed token that has no usable version claim', () => {
    const sign = (claims: object) =>
      jwt.sign(claims, secret, { subject: 'u', issuer: 'nestapp-fullstack' });
    for (const claims of [{}, { ver: -1 }, { ver: 1.5 }, { ver: '1' }]) {
      expect(make().verify(sign(claims))).toBeNull();
    }
  });

  it('rejects garbage', () => {
    for (const t of ['', 'abc', 'a.b.c', 'Bearer x']) expect(make().verify(t)).toBeNull();
  });

  it('fails closed when no secret is configured', () => {
    const tokens = make({});
    expect(tokens.verify(make().sign('u'))).toBeNull();
    expect(() => tokens.sign('u')).toThrow('JWT_SECRET is not configured');
  });
});
