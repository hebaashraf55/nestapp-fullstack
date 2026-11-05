import { Logger } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';

/** What NOMA trusts from Google, and only after the ID token's signature and claims are verified. */
export interface GoogleIdentity {
  /** Google's stable account id. Emails can change; `sub` cannot. */
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | undefined;
  nonce: string | undefined;
}

/** Google signs ID tokens with one of these issuers (both forms are documented). */
export const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

/** Port so tests can supply identities without calling Google. */
export abstract class GoogleIdTokenVerifier {
  /** False when GOOGLE_CLIENT_ID is not set: Google sign-in is then switched off (503). */
  abstract readonly configured: boolean;
  /** Returns the verified identity, or null for any invalid, expired, foreign or malformed token. */
  abstract verify(idToken: string): Promise<GoogleIdentity | null>;
}

/**
 * Verifies a Google ID token with Google's official library: RS256 signature against Google's
 * published keys, issuer, audience (our OAuth client id) and expiry (with the library's small clock
 * allowance). Profile data sent by a browser is never trusted; only these verified claims are used.
 */
export class OfficialGoogleIdTokenVerifier extends GoogleIdTokenVerifier {
  private readonly logger = new Logger('GoogleSignIn');
  readonly configured: boolean;

  constructor(
    private readonly clientId: string | undefined,
    protected readonly client: OAuth2Client = new OAuth2Client(),
  ) {
    super();
    this.configured = clientId !== undefined;
  }

  /** Google's current signing keys (the library caches them per their Cache-Control). Overridable in tests. */
  protected async signingKeys(): Promise<Record<string, string>> {
    const { certs } = await this.client.getFederatedSignonCertsAsync();
    return certs as Record<string, string>;
  }

  async verify(idToken: string): Promise<GoogleIdentity | null> {
    if (!this.clientId || typeof idToken !== 'string') return null;
    try {
      const ticket = await this.client.verifySignedJwtWithCertsAsync(
        idToken,
        await this.signingKeys(),
        this.clientId,
        GOOGLE_ISSUERS,
      );
      const p = ticket.getPayload();
      if (!p?.sub || !p.email) return null;
      return {
        sub: p.sub,
        email: p.email,
        emailVerified: p.email_verified === true,
        name: typeof p.name === 'string' ? p.name : undefined,
        nonce: typeof p.nonce === 'string' ? p.nonce : undefined,
      };
    } catch (error) {
      // The reason (expired, wrong audience, bad signature, ...) is logged without the token itself.
      this.logger.warn(
        `Rejected a Google ID token: ${error instanceof Error ? error.message.slice(0, 120) : 'unknown error'}`,
      );
      return null;
    }
  }
}
