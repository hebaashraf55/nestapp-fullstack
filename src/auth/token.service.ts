import { Inject, Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { ENV, Env } from '../config/env';

const ISSUER = 'nestapp-fullstack';
const ALGORITHM = 'HS256';

/**
 * Signs and verifies short-lived access tokens. The token carries only the user id: role and demo
 * flag are read from the database on every request, so a role change or deletion applies at once.
 * With no JWT_SECRET configured, verification always fails (the API fails closed).
 */
@Injectable()
export class TokenService {
  private readonly secret: string | undefined;
  private readonly ttlSeconds: number;

  constructor(@Inject(ENV) env: Env) {
    this.secret = env.JWT_SECRET;
    this.ttlSeconds = env.ACCESS_TOKEN_TTL_SECONDS;
  }

  sign(userId: string): string {
    if (!this.secret) throw new Error('JWT_SECRET is not configured');
    return jwt.sign({}, this.secret, {
      algorithm: ALGORITHM,
      subject: userId,
      issuer: ISSUER,
      expiresIn: this.ttlSeconds,
    });
  }

  /** Returns the user id, or null for any invalid, expired, tampered or foreign token. */
  verify(token: string): string | null {
    if (!this.secret) return null;
    try {
      // Pinning the algorithm list blocks the "alg: none" and algorithm-confusion attacks.
      const payload = jwt.verify(token, this.secret, { algorithms: [ALGORITHM], issuer: ISSUER });
      if (typeof payload === 'string') return null;
      return typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : null;
    } catch {
      return null;
    }
  }
}
