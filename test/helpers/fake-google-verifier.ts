import { GoogleIdentity, GoogleIdTokenVerifier } from '../../src/auth/google-id-token.verifier';

/**
 * Test-only stand-in for Google: a "credential" is accepted only if a test registered it, so tests
 * control exactly which identity (and nonce) Google would vouch for. The real signature, issuer,
 * audience and expiry checks are covered against Google's own library in
 * src/auth/google-id-token.verifier.spec.ts.
 */
export class FakeGoogleVerifier extends GoogleIdTokenVerifier {
  configured = true;
  private readonly tokens = new Map<string, GoogleIdentity>();
  private counter = 0;

  /** Registers an identity and returns the credential string that stands for its ID token. */
  issue(identity: Partial<GoogleIdentity> & { email: string }, nonce: string): string {
    this.counter += 1;
    const credential = `fake-google-id-token-${this.counter}-`.padEnd(120, 'x');
    this.tokens.set(credential, {
      sub: identity.sub ?? `google-sub-${this.counter}`,
      email: identity.email,
      emailVerified: identity.emailVerified ?? true,
      name: identity.name,
      nonce,
    });
    return credential;
  }

  async verify(idToken: string): Promise<GoogleIdentity | null> {
    return this.configured ? (this.tokens.get(idToken) ?? null) : null;
  }
}
