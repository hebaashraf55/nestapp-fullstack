export interface RefreshTokenRecord {
  id: string;
  userId: string;
  /** All tokens descended from one login share a family, so a replayed token can kill the whole chain. */
  familyId: string;
  /** SHA-256 of the opaque token. The token itself is never stored. */
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export type NewRefreshToken = Omit<RefreshTokenRecord, 'id' | 'revokedAt' | 'createdAt'>;

export abstract class RefreshTokenRepository {
  abstract create(token: NewRefreshToken): Promise<RefreshTokenRecord>;
  abstract findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  /** Atomic: true for exactly one caller if the token was still active. Used to rotate safely. */
  abstract revoke(id: string): Promise<boolean>;
  abstract revokeFamily(familyId: string): Promise<void>;
  abstract revokeAllForUser(userId: string): Promise<void>;
}
