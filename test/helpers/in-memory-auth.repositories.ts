import { randomBytes } from 'node:crypto';
import { NewOtp, OtpPurpose, OtpRecord, OtpRepository } from '../../src/auth/otp.repository';
import {
  NewRefreshToken,
  RefreshTokenRecord,
  RefreshTokenRepository,
} from '../../src/auth/refresh-token.repository';

const newId = () => randomBytes(12).toString('hex');

/** Test-only fakes of the persistence ports. Never wired into the real application. */
export class InMemoryOtpRepository extends OtpRepository {
  readonly records = new Map<string, OtpRecord>();

  async replace(otp: NewOtp): Promise<OtpRecord> {
    for (const [id, r] of this.records) {
      if (r.userId === otp.userId && r.purpose === otp.purpose) this.records.delete(id);
    }
    const record: OtpRecord = { ...otp, id: newId(), attempts: 0 };
    this.records.set(record.id, record);
    return record;
  }

  async find(userId: string, purpose: OtpPurpose): Promise<OtpRecord | null> {
    return (
      [...this.records.values()].find((r) => r.userId === userId && r.purpose === purpose) ?? null
    );
  }

  async addAttempt(id: string): Promise<number> {
    const record = this.records.get(id);
    if (!record) return Number.MAX_SAFE_INTEGER;
    record.attempts += 1;
    return record.attempts;
  }

  async consume(id: string): Promise<boolean> {
    return this.records.delete(id);
  }

  async deleteForUser(userId: string): Promise<void> {
    for (const [id, r] of this.records) if (r.userId === userId) this.records.delete(id);
  }
}

export class InMemoryRefreshTokenRepository extends RefreshTokenRepository {
  readonly records = new Map<string, RefreshTokenRecord>();

  async create(token: NewRefreshToken): Promise<RefreshTokenRecord> {
    const record: RefreshTokenRecord = {
      ...token,
      id: newId(),
      revokedAt: null,
      createdAt: new Date(),
    };
    this.records.set(record.id, record);
    return record;
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    return [...this.records.values()].find((r) => r.tokenHash === tokenHash) ?? null;
  }

  async revoke(id: string): Promise<boolean> {
    const record = this.records.get(id);
    if (!record || record.revokedAt) return false;
    record.revokedAt = new Date();
    return true;
  }

  async revokeFamily(familyId: string): Promise<void> {
    for (const r of this.records.values())
      if (r.familyId === familyId && !r.revokedAt) r.revokedAt = new Date();
  }

  async revokeAllForUser(userId: string): Promise<void> {
    for (const r of this.records.values())
      if (r.userId === userId && !r.revokedAt) r.revokedAt = new Date();
  }
}
