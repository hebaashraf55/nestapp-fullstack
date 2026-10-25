import { Role } from './role';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
  /** True for synthetic demo data. The demo-viewer role can only ever see records with this flag. */
  isDemo: boolean;
  createdAt: Date;
}

export type NewUser = Omit<UserRecord, 'id' | 'createdAt'>;

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
}
