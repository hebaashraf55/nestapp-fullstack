import { Injectable } from '@nestjs/common';
import { Role } from './role';
import { NewUser, UserRecord, UsersRepository } from './users.repository';

/** Safe projection: never contains the password hash. */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  isDemo: boolean;
}

export function toPublicUser(user: UserRecord): PublicUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role, isDemo: user.isDemo };
}

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Role/demo invariants live here so no caller can break them:
 *  - DEMO_VIEWER accounts are always demo accounts (they may only see synthetic data);
 *  - ADMIN accounts are never demo accounts.
 */
export function assertRoleInvariants(role: Role, isDemo: boolean): void {
  if (role === Role.DEMO_VIEWER && !isDemo) {
    throw new Error('A DEMO_VIEWER account must be a demo account');
  }
  if (role === Role.ADMIN && isDemo) {
    throw new Error('An ADMIN account cannot be a demo account');
  }
}

@Injectable()
export class UsersService {
  constructor(private readonly users: UsersRepository) {}

  findById(id: string): Promise<UserRecord | null> {
    return this.users.findById(id);
  }

  findByEmail(email: string): Promise<UserRecord | null> {
    return this.users.findByEmail(normalizeEmail(email));
  }

  async create(user: NewUser): Promise<UserRecord> {
    assertRoleInvariants(user.role, user.isDemo);
    return this.users.create({ ...user, email: normalizeEmail(user.email) });
  }

  async setRole(id: string, role: Role, isDemo: boolean): Promise<void> {
    assertRoleInvariants(role, isDemo);
    await this.users.updateRoleAndDemo(id, role, isDemo);
  }

  markEmailVerified(id: string): Promise<void> {
    return this.users.markEmailVerified(id);
  }

  resetPassword(id: string, passwordHash: string): Promise<void> {
    return this.users.resetPassword(id, passwordHash);
  }

  bumpTokenVersion(id: string): Promise<void> {
    return this.users.bumpTokenVersion(id);
  }
}
