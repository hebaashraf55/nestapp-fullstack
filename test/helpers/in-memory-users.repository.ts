import { randomBytes } from 'node:crypto';
import { Role } from '../../src/users/role';
import {
  DuplicateEmailError,
  NewUser,
  UserRecord,
  UsersRepository,
} from '../../src/users/users.repository';

/** Test-only fake of the persistence port. Never wired into the real application. */
export class InMemoryUsersRepository extends UsersRepository {
  readonly records = new Map<string, UserRecord>();
  failWith: Error | null = null;

  private check(): void {
    if (this.failWith) throw this.failWith;
  }

  async findById(id: string): Promise<UserRecord | null> {
    this.check();
    return this.records.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    this.check();
    return [...this.records.values()].find((u) => u.email === email) ?? null;
  }

  async create(user: NewUser): Promise<UserRecord> {
    this.check();
    if ([...this.records.values()].some((u) => u.email === user.email)) {
      throw new DuplicateEmailError();
    }
    const record: UserRecord = {
      ...user,
      id: randomBytes(12).toString('hex'),
      tokenVersion: 0,
      createdAt: new Date(),
    };
    this.records.set(record.id, record);
    return record;
  }

  async updateRoleAndDemo(id: string, role: Role, isDemo: boolean): Promise<void> {
    this.check();
    const record = this.records.get(id);
    if (record) this.records.set(id, { ...record, role, isDemo });
  }

  async markEmailVerified(id: string): Promise<void> {
    this.check();
    const record = this.records.get(id);
    if (record) this.records.set(id, { ...record, emailVerified: true });
  }

  async resetPassword(id: string, passwordHash: string): Promise<void> {
    this.check();
    const record = this.records.get(id);
    if (record) {
      this.records.set(id, {
        ...record,
        passwordHash,
        emailVerified: true,
        tokenVersion: record.tokenVersion + 1,
      });
    }
  }

  async bumpTokenVersion(id: string): Promise<void> {
    this.check();
    const record = this.records.get(id);
    if (record) this.records.set(id, { ...record, tokenVersion: record.tokenVersion + 1 });
  }
}
