export type OtpPurpose = 'verify-email' | 'reset-password';

export interface OtpRecord {
  id: string;
  userId: string;
  purpose: OtpPurpose;
  /** Keyed hash of the code. The code itself is never stored. */
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  sentAt: Date;
}

export type NewOtp = Omit<OtpRecord, 'id' | 'attempts'>;

/** One active code per (user, purpose): issuing a new one replaces the old one and resets attempts. */
export abstract class OtpRepository {
  abstract replace(otp: NewOtp): Promise<OtpRecord>;
  abstract find(userId: string, purpose: OtpPurpose): Promise<OtpRecord | null>;
  /** Atomically adds one failed attempt and returns the new total. */
  abstract addAttempt(id: string): Promise<number>;
  /** Atomic single use: true for exactly one caller, false if it was already consumed or removed. */
  abstract consume(id: string): Promise<boolean>;
  abstract deleteForUser(userId: string): Promise<void>;
}
