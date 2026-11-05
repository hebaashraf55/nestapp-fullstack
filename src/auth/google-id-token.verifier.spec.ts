import jwt from 'jsonwebtoken';
import { generateKeyPairSync } from 'node:crypto';
import { OfficialGoogleIdTokenVerifier } from './google-id-token.verifier';

/*
 * Exercises Google's official verification code (google-auth-library) with a locally generated RSA
 * key standing in for Google's published keys, so signature, issuer, audience and expiry checks are
 * the library's real ones. No network.
 */
const CLIENT_ID = '1234567890-abc.apps.googleusercontent.com';
const KID = 'test-key-1';
const google = generateKeyPairSync('rsa', { modulusLength: 2048 });
const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = (k: typeof google) => k.publicKey.export({ type: 'spki', format: 'pem' }).toString();

class LocalKeysVerifier extends OfficialGoogleIdTokenVerifier {
  protected override async signingKeys() {
    return { [KID]: pem(google) };
  }
}

const now = () => Math.floor(Date.now() / 1000);
const idToken = (claims: Record<string, unknown> = {}, key = google, kid = KID) =>
  jwt.sign(
    {
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: '109876543210',
      email: 'Ada@Example.com',
      email_verified: true,
      name: 'Ada Lovelace',
      nonce: 'n-123',
      iat: now() - 10,
      exp: now() + 3600,
      ...claims,
    },
    key.privateKey,
    { algorithm: 'RS256', keyid: kid },
  );

describe('OfficialGoogleIdTokenVerifier', () => {
  const verifier = new LocalKeysVerifier(CLIENT_ID);
  beforeAll(() => jest.spyOn(console, 'warn').mockImplementation(() => undefined));

  it('accepts a correctly signed token for our client and returns only verified claims', async () => {
    await expect(verifier.verify(idToken())).resolves.toEqual({
      sub: '109876543210',
      email: 'Ada@Example.com',
      emailVerified: true,
      name: 'Ada Lovelace',
      nonce: 'n-123',
    });
    // The short issuer form is also one Google uses.
    expect(await verifier.verify(idToken({ iss: 'accounts.google.com' }))).not.toBeNull();
  });

  it.each([
    ['signed by another key', () => idToken({}, attacker)],
    [
      'issued for another client (audience)',
      () => idToken({ aud: 'other.apps.googleusercontent.com' }),
    ],
    ['from another issuer', () => idToken({ iss: 'https://evil.example.com' })],
    ['expired', () => idToken({ iat: now() - 7200, exp: now() - 3600 })],
    ['with an unknown key id', () => idToken({}, google, 'unknown-kid')],
    ['without a subject', () => idToken({ sub: undefined })],
    ['not a JWT at all', () => 'not-a-token'],
    [
      'an unsigned alg:none token',
      () => {
        const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
        return `${enc({ alg: 'none', kid: KID })}.${enc({ iss: 'accounts.google.com', aud: CLIENT_ID, sub: '1', email: 'a@b.c', exp: now() + 60 })}.`;
      },
    ],
  ])('rejects a token %s', async (_label, make) => {
    await expect(verifier.verify(make())).resolves.toBeNull();
  });

  it('reports an unverified Google email instead of hiding it', async () => {
    expect((await verifier.verify(idToken({ email_verified: false })))?.emailVerified).toBe(false);
  });

  it('is switched off without a client id', async () => {
    const off = new LocalKeysVerifier(undefined);
    expect(off.configured).toBe(false);
    await expect(off.verify(idToken())).resolves.toBeNull();
  });
});
