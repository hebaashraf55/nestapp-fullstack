import { Inject, Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { ENV, Env } from '../config/env';

const ISSUER = 'nestapp-fullstack:google-nonce'; // never accepted as an access token (different issuer)
export const NONCE_TTL_SECONDS = 10 * 60;

/**
 * Replay protection for Google's browser sign-in (Google Identity Services, popup mode): the server
 * issues a random nonce plus a signed, short-lived ticket for it. The browser hands the nonce to
 * Google, which embeds it in the ID token; on sign-in the server checks that the token's nonce is the
 * one in a valid ticket and that the ticket has not been used before. A stolen ID token therefore
 * cannot be replayed, and an ID token minted for another session cannot be injected.
 * Used tickets are remembered in memory until they expire (one API process, like the rate limiter).
 */
@Injectable()
export class GoogleNonceService {
  private readonly used = new Map<string, number>();
  private readonly secret: string;

  constructor(@Inject(ENV) env: Env) {
    this.secret = env.JWT_SECRET ?? '';
  }

  issue(): { nonce: string; nonceToken: string } {
    const nonce = randomBytes(24).toString('base64url');
    const nonceToken = jwt.sign({ nonce }, this.secret, {
      algorithm: 'HS256',
      issuer: ISSUER,
      expiresIn: NONCE_TTL_SECONDS,
      jwtid: randomBytes(12).toString('hex'),
    });
    return { nonce, nonceToken };
  }

  /** True once per ticket, and only if the ID token carries exactly the ticket's nonce. */
  consume(nonceToken: string, nonceFromIdToken: string | undefined): boolean {
    if (!this.secret || !nonceFromIdToken) return false;
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(nonceToken, this.secret, {
        algorithms: ['HS256'],
        issuer: ISSUER,
      }) as jwt.JwtPayload;
    } catch {
      return false;
    }
    if (typeof payload.jti !== 'string' || payload.nonce !== nonceFromIdToken) return false;
    this.sweep();
    if (this.used.has(payload.jti)) return false;
    this.used.set(payload.jti, (payload.exp ?? 0) * 1000);
    return true;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [jti, expiresAt] of this.used) if (expiresAt <= now) this.used.delete(jti);
  }
}
