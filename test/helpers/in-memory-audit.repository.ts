import { randomBytes } from 'node:crypto';
import { AuditEntry, AuditRepository, NewAuditEntry } from '../../src/audit/audit.repository';

/** Test-only fake of the persistence port. Never wired into the real application. */
export class InMemoryAuditRepository extends AuditRepository {
  readonly entries: AuditEntry[] = [];
  failWith: Error | null = null;
  private tick = 0;

  async record(entry: NewAuditEntry): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.entries.push({
      ...entry,
      id: randomBytes(12).toString('hex'),
      createdAt: new Date(Date.now() + this.tick++),
    });
  }

  async findPage(page: number, limit: number) {
    if (this.failWith) throw this.failWith;
    const sorted = [...this.entries].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (page - 1) * limit;
    return { items: sorted.slice(start, start + limit), total: sorted.length };
  }
}
