import { randomBytes } from 'node:crypto';
import {
  AddressFields,
  AddressRecord,
  AddressesRepository,
} from '../../src/addresses/addresses.repository';
import {
  NewNotification,
  NotificationRecord,
  NotificationsRepository,
} from '../../src/notifications/notifications.repository';

const id = () => randomBytes(12).toString('hex');
let clock = 0;
const now = () => new Date(Date.UTC(2026, 0, 1) + ++clock * 1000);

/** Test-only fakes with the same rules as the Mongo repositories. */
export class InMemoryAddressesRepository extends AddressesRepository {
  readonly records = new Map<string, AddressRecord>();
  private owned(i: string, userId: string) {
    const r = this.records.get(i);
    return r && r.userId === userId ? r : null;
  }
  async list(userId: string) {
    return [...this.records.values()]
      .filter((a) => a.userId === userId)
      .sort(
        (a, b) =>
          Number(b.isDefault) - Number(a.isDefault) ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      )
      .map((a) => ({ ...a }));
  }
  async count(userId: string) {
    return (await this.list(userId)).length;
  }
  async findOwned(i: string, userId: string) {
    const r = this.owned(i, userId);
    return r ? { ...r } : null;
  }
  async create(userId: string, fields: AddressFields, isDefault: boolean) {
    if (isDefault)
      for (const a of this.records.values()) if (a.userId === userId) a.isDefault = false;
    const r: AddressRecord = { ...fields, id: id(), userId, isDefault, createdAt: now() };
    this.records.set(r.id, r);
    return { ...r };
  }
  async update(i: string, userId: string, fields: Partial<AddressFields>) {
    const r = this.owned(i, userId);
    if (!r) return null;
    Object.assign(r, fields);
    return { ...r };
  }
  async setDefault(i: string, userId: string) {
    const r = this.owned(i, userId);
    if (!r) return null;
    for (const a of this.records.values()) if (a.userId === userId) a.isDefault = a.id === i;
    return { ...r };
  }
  async delete(i: string, userId: string) {
    return this.owned(i, userId) ? this.records.delete(i) : false;
  }
}

export class InMemoryNotificationsRepository extends NotificationsRepository {
  readonly records = new Map<string, NotificationRecord>();
  async create(n: NewNotification) {
    const r: NotificationRecord = { ...n, id: id(), readAt: null, createdAt: now() };
    this.records.set(r.id, r);
    return { ...r };
  }
  async listByUser(userId: string, limit: number) {
    return [...this.records.values()]
      .filter((n) => n.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
  async countUnread(userId: string) {
    return [...this.records.values()].filter((n) => n.userId === userId && !n.readAt).length;
  }
  async markRead(i: string, userId: string, at: Date) {
    const r = this.records.get(i);
    if (!r || r.userId !== userId) return false;
    r.readAt ??= at;
    return true;
  }
  async markAllRead(userId: string, at: Date) {
    let n = 0;
    for (const r of this.records.values())
      if (r.userId === userId && !r.readAt) {
        r.readAt = at;
        n++;
      }
    return n;
  }
}
