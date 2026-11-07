import { randomBytes } from 'node:crypto';
import {
  BundlePatch,
  BundleRecord,
  BundlesRepository,
  DuplicateBundleError,
  NewBundle,
} from '../../src/bundles/bundles.repository';
import {
  DuplicateLookError,
  LookPatch,
  LookRecord,
  LooksRepository,
  NewLook,
} from '../../src/looks/looks.repository';
import { MOODBOARD_MAX_PRODUCTS } from '../../src/moodboards/moodboard.schema';
import { MoodboardRecord, MoodboardsRepository } from '../../src/moodboards/moodboards.repository';

const id = () => randomBytes(12).toString('hex');
let clock = 0;
const now = () => new Date(Date.UTC(2026, 0, 1) + ++clock * 1000);

/** Test-only fakes with the same rules as the Mongo repositories. */
export class InMemoryBundlesRepository extends BundlesRepository {
  readonly records = new Map<string, BundleRecord>();
  async findAll(f: { activeOnly: boolean; demoOnly: boolean; productId?: string }) {
    return [...this.records.values()]
      .filter(
        (b) =>
          (!f.activeOnly || b.active) &&
          (!f.demoOnly || b.isDemo) &&
          (!f.productId || b.items.some((i) => i.productId === f.productId)),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  async findActiveContaining(productIds: string[]) {
    return [...this.records.values()].filter(
      (b) => b.active && b.items.some((i) => productIds.includes(i.productId)),
    );
  }
  async findById(i: string) {
    return this.records.get(i) ?? null;
  }
  async findBySlug(slug: string) {
    return [...this.records.values()].find((b) => b.slug === slug) ?? null;
  }
  async create(b: NewBundle) {
    if (await this.findBySlug(b.slug)) throw new DuplicateBundleError();
    const r = { ...b, id: id(), createdAt: now() };
    this.records.set(r.id, r);
    return { ...r };
  }
  async update(i: string, patch: BundlePatch) {
    const r = this.records.get(i);
    if (!r) return null;
    Object.assign(r, patch);
    return { ...r };
  }
  async delete(i: string) {
    return this.records.delete(i);
  }
}

export class InMemoryLooksRepository extends LooksRepository {
  readonly records = new Map<string, LookRecord>();
  async findAll(f: { activeOnly: boolean; demoOnly: boolean; productId?: string }) {
    return [...this.records.values()]
      .filter(
        (l) =>
          (!f.activeOnly || l.active) &&
          (!f.demoOnly || l.isDemo) &&
          (!f.productId || l.spots.some((s) => s.productId === f.productId)),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  async findById(i: string) {
    return this.records.get(i) ?? null;
  }
  async findBySlug(slug: string) {
    return [...this.records.values()].find((l) => l.slug === slug) ?? null;
  }
  async create(l: NewLook) {
    if (await this.findBySlug(l.slug)) throw new DuplicateLookError();
    const r = { ...l, id: id(), createdAt: now() };
    this.records.set(r.id, r);
    return { ...r };
  }
  async update(i: string, patch: LookPatch) {
    const r = this.records.get(i);
    if (!r) return null;
    Object.assign(r, patch);
    return { ...r };
  }
  async delete(i: string) {
    return this.records.delete(i);
  }
}

export class InMemoryMoodboardsRepository extends MoodboardsRepository {
  readonly records = new Map<string, MoodboardRecord>();
  private owned(i: string, userId: string) {
    const r = this.records.get(i);
    return r && r.userId === userId ? r : null;
  }
  async listByUser(userId: string) {
    return [...this.records.values()].filter((b) => b.userId === userId);
  }
  async countByUser(userId: string) {
    return (await this.listByUser(userId)).length;
  }
  async findOwned(i: string, userId: string) {
    const r = this.owned(i, userId);
    return r ? { ...r } : null;
  }
  async findByShareToken(token: string) {
    return (
      [...this.records.values()].find((b) => b.shareToken !== null && b.shareToken === token) ??
      null
    );
  }
  async create(b: { userId: string; name: string; note: string }) {
    const at = now();
    const r: MoodboardRecord = {
      ...b,
      id: id(),
      productIds: [],
      shareToken: null,
      createdAt: at,
      updatedAt: at,
    };
    this.records.set(r.id, r);
    return { ...r };
  }
  private touch(r: MoodboardRecord) {
    r.updatedAt = now();
    return { ...r, productIds: [...r.productIds] };
  }
  async update(i: string, userId: string, patch: { name?: string; note?: string }) {
    const r = this.owned(i, userId);
    if (!r) return null;
    Object.assign(r, patch);
    return this.touch(r);
  }
  async addProduct(i: string, userId: string, productId: string) {
    const r = this.owned(i, userId);
    if (!r) return null;
    if (r.productIds.includes(productId)) return { ...r };
    if (r.productIds.length >= MOODBOARD_MAX_PRODUCTS) return null;
    r.productIds.push(productId);
    return this.touch(r);
  }
  async removeProduct(i: string, userId: string, productId: string) {
    const r = this.owned(i, userId);
    if (!r) return null;
    r.productIds = r.productIds.filter((p) => p !== productId);
    return this.touch(r);
  }
  async setShareToken(i: string, userId: string, token: string | null) {
    const r = this.owned(i, userId);
    if (!r) return null;
    r.shareToken = token;
    return this.touch(r);
  }
  async delete(i: string, userId: string) {
    return this.owned(i, userId) ? this.records.delete(i) : false;
  }
}
