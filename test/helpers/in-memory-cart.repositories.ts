import { randomBytes } from 'node:crypto';
import { DuplicateKeyError } from '../../src/catalogue/catalogue.repositories';
import {
  CartData,
  CartRecord,
  CartsRepository,
  VersionConflictError,
} from '../../src/cart/cart.repository';
import {
  CouponPatch,
  CouponRecord,
  CouponsRepository,
  NewCoupon,
} from '../../src/coupons/coupons.repository';

const newId = () => randomBytes(12).toString('hex');

/** Test-only fakes of the persistence ports. Never wired into the real application. */
export class InMemoryCouponsRepository extends CouponsRepository {
  readonly records = new Map<string, CouponRecord>();
  failWith: Error | null = null;
  private check() {
    if (this.failWith) throw this.failWith;
  }
  async findById(id: string) {
    this.check();
    return this.records.get(id) ?? null;
  }
  async findByCode(code: string) {
    this.check();
    return [...this.records.values()].find((c) => c.code === code) ?? null;
  }
  async findAll() {
    this.check();
    return [...this.records.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  async create(record: NewCoupon) {
    this.check();
    if ([...this.records.values()].some((c) => c.code === record.code))
      throw new DuplicateKeyError();
    const created: CouponRecord = { ...record, id: newId(), createdAt: new Date() };
    this.records.set(created.id, created);
    return created;
  }
  async update(id: string, patch: CouponPatch) {
    this.check();
    const current = this.records.get(id);
    if (!current) return null;
    const next = { ...current, ...patch };
    this.records.set(id, next);
    return next;
  }
  async delete(id: string) {
    this.check();
    return this.records.delete(id);
  }
}

export class InMemoryCartsRepository extends CartsRepository {
  readonly records = new Map<string, CartRecord>();
  failWith: Error | null = null;
  /** Number of upcoming `save` calls that should fail as if another request won the race. */
  forceConflicts = 0;
  private check() {
    if (this.failWith) throw this.failWith;
  }
  async findByUser(userId: string) {
    this.check();
    const found = this.records.get(userId);
    return found ? { ...found, items: found.items.map((i) => ({ ...i })) } : null;
  }
  async save(userId: string, expectedVersion: number, data: CartData) {
    this.check();
    if (this.forceConflicts > 0) {
      this.forceConflicts -= 1;
      throw new VersionConflictError();
    }
    const current = this.records.get(userId);
    if ((current?.version ?? 0) !== expectedVersion) throw new VersionConflictError();
    this.records.set(userId, {
      userId,
      items: data.items.map((i) => ({ ...i })),
      couponId: data.couponId,
      version: expectedVersion + 1,
    });
  }
}
