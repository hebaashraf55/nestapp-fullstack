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
  createdAt: Date;
}

export type NewUser = Omit<UserRecord, 'id' | 'createdAt' | 'tokenVersion'>;

/** Thrown when an email is already registered. */
export class DuplicateEmailError extends Error {
  constructor() {
    super('Email already registered');
    this.name = 'DuplicateEmailError';
  }
}

/** Persistence port. The Mongoose implementation is production; tests use an in-memory fake. */
export abstract class UsersRepository {
  abstract findById(id: string): Promise<UserRecord | null>;
  abstract findByEmail(email: string): Promise<UserRecord | null>;
  abstract create(user: NewUser): Promise<UserRecord>;
  abstract updateRoleAndDemo(id: string, role: Role, isDemo: boolean): Promise<void>;
  abstract markEmailVerified(id: string): Promise<void>;
  /** Sets a new password hash, marks the email verified, and bumps tokenVersion (one atomic update). */
  abstract resetPassword(id: string, passwordHash: string): Promise<void>;
  /** Invalidates every access token already issued to this user. */
  abstract bumpTokenVersion(id: string): Promise<void>;
}
