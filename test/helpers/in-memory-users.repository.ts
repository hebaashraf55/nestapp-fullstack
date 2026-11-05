import { randomBytes } from 'node:crypto';
import { Role } from '../../src/users/role';
import {
  DuplicateEmailError,
  DuplicateGoogleAccountError,
  NewUser,
  UserPageFilter,
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
    if (user.googleSub && [...this.records.values()].some((u) => u.googleSub === user.googleSub)) {
      throw new DuplicateGoogleAccountError();
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

  async findPage(filter: UserPageFilter): Promise<{ items: UserRecord[]; total: number }> {
    this.check();
    const all = [...this.records.values()]
      .filter((u) => filter.roles.includes(u.role) && (!filter.demoOnly || u.isDemo))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (filter.page - 1) * filter.limit;
    return { items: all.slice(start, start + filter.limit), total: all.length };
  }

  async findByIds(ids: string[]): Promise<UserRecord[]> {
    this.check();
    return ids.map((id) => this.records.get(id)).filter((u): u is UserRecord => !!u);
  }

  async updateRoleAndDemo(id: string, role: Role, isDemo: boolean): Promise<void> {
    this.check();
    const record = this.records.get(id);
    if (record) this.records.set(id, { ...record, role, isDemo });
  }

  async findByGoogleSub(sub: string): Promise<UserRecord | null> {
    this.check();
    return [...this.records.values()].find((u) => u.googleSub === sub) ?? null;
  }

  async linkGoogle(id: string, sub: string, replacePasswordHash?: string): Promise<boolean> {
    this.check();
    const record = this.records.get(id);
    if (!record || record.googleSub) return false;
    if ([...this.records.values()].some((u) => u.googleSub === sub)) {
      throw new DuplicateGoogleAccountError();
    }
    this.records.set(id, {
      ...record,
      googleSub: sub,
      emailVerified: true,
      ...(replacePasswordHash
        ? { passwordHash: replacePasswordHash, tokenVersion: record.tokenVersion + 1 }
        : {}),
    });
    return true;
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
