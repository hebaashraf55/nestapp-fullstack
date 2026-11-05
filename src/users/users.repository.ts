import { Role } from './role';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
  /** True for synthetic demo data. The demo-viewer role can only ever see records with this flag. */
  isDemo: boolean;
  /** Set once the owner proves control of the address with an emailed code. Login requires it. */
  emailVerified: boolean;
  /** Embedded in access tokens; incrementing it invalidates every access token already issued. */
  tokenVersion: number;
  /** Google account id ("sub") once the user has signed in with Google; absent otherwise. */
  googleSub?: string;
  createdAt: Date;
}

export type NewUser = Omit<UserRecord, 'id' | 'createdAt' | 'tokenVersion'>;

export interface UserPageFilter {
  roles: Role[];
  /** True for the demo viewer: only synthetic accounts. */
  demoOnly: boolean;
  page: number;
  limit: number;
}

/** Thrown when an email is already registered. */
export class DuplicateEmailError extends Error {
  constructor() {
    super('Email already registered');
    this.name = 'DuplicateEmailError';
  }
}

/** Thrown when a Google account is already linked to a different user. */
export class DuplicateGoogleAccountError extends Error {
  constructor() {
    super('Google account already linked');
    this.name = 'DuplicateGoogleAccountError';
  }
}

/** Persistence port. The Mongoose implementation is production; tests use an in-memory fake. */
export abstract class UsersRepository {
  abstract findById(id: string): Promise<UserRecord | null>;
  abstract findByEmail(email: string): Promise<UserRecord | null>;
  abstract create(user: NewUser): Promise<UserRecord>;
  /** Newest first. Used by the admin customer list; callers must never expose `passwordHash`. */
  abstract findPage(filter: UserPageFilter): Promise<{ items: UserRecord[]; total: number }>;
  abstract findByIds(ids: string[]): Promise<UserRecord[]>;
  abstract updateRoleAndDemo(id: string, role: Role, isDemo: boolean): Promise<void>;
  abstract markEmailVerified(id: string): Promise<void>;
  /** Sets a new password hash, marks the email verified, and bumps tokenVersion (one atomic update). */
  abstract resetPassword(id: string, passwordHash: string): Promise<void>;
  /** Invalidates every access token already issued to this user. */
  abstract bumpTokenVersion(id: string): Promise<void>;
  abstract findByGoogleSub(sub: string): Promise<UserRecord | null>;
  /**
   * Links a Google account to a user that has none yet and marks the email verified (Google verified
   * it). With `replacePasswordHash`, also replaces the password and bumps tokenVersion, all in one
   * atomic update. Returns false if the user already had a Google account linked (or is gone);
   * throws DuplicateGoogleAccountError if that Google account belongs to someone else.
   */
  abstract linkGoogle(id: string, sub: string, replacePasswordHash?: string): Promise<boolean>;
}
