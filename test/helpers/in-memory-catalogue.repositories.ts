import { randomBytes } from 'node:crypto';
import {
  BrandsRepository,
  CategoriesRepository,
  DuplicateKeyError,
  NewProduct,
  NewTaxonomy,
  ProductFilter,
  ProductPatch,
  ProductRecord,
  ProductsRepository,
  TaxonomyPatch,
  TaxonomyRecord,
  TaxonomyRepository,
} from '../../src/catalogue/catalogue.repositories';

const newId = () => randomBytes(12).toString('hex');

/** Test-only fakes of the persistence ports. Never wired into the real application. */
class InMemoryTaxonomy extends TaxonomyRepository {
  readonly records = new Map<string, TaxonomyRecord>();
  failWith: Error | null = null;

  private check() {
    if (this.failWith) throw this.failWith;
  }

  async findById(id: string) {
    this.check();
    return this.records.get(id) ?? null;
  }
  async findBySlug(slug: string) {
    this.check();
    return [...this.records.values()].find((r) => r.slug === slug) ?? null;
  }
  async findAll(demoOnly: boolean) {
    this.check();
    return [...this.records.values()]
      .filter((r) => !demoOnly || r.isDemo)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  async findByIds(ids: string[]) {
    this.check();
    return ids.map((id) => this.records.get(id)).filter((r): r is TaxonomyRecord => !!r);
  }
  async create(record: NewTaxonomy) {
    this.check();
    if ([...this.records.values()].some((r) => r.slug === record.slug))
      throw new DuplicateKeyError();
    const created: TaxonomyRecord = { ...record, id: newId(), createdAt: new Date() };
    this.records.set(created.id, created);
    return created;
  }
  async update(id: string, patch: TaxonomyPatch) {
    this.check();
    const current = this.records.get(id);
    if (!current) return null;
    if (
      patch.slug &&
      [...this.records.values()].some((r) => r.slug === patch.slug && r.id !== id)
    ) {
      throw new DuplicateKeyError();
    }
    const next = { ...current, ...patch };
    this.records.set(id, next);
    return next;
  }
  async delete(id: string) {
    this.check();
    return this.records.delete(id);
  }
}
export class InMemoryBrandsRepository extends InMemoryTaxonomy implements BrandsRepository {}
export class InMemoryCategoriesRepository
  extends InMemoryTaxonomy
  implements CategoriesRepository {}

export class InMemoryProductsRepository extends ProductsRepository {
  readonly records = new Map<string, ProductRecord>();
  failWith: Error | null = null;
  private tick = 0;

  private check() {
    if (this.failWith) throw this.failWith;
  }

  async findById(id: string) {
    this.check();
    return this.records.get(id) ?? null;
  }
  async findByIds(ids: string[]) {
    this.check();
    return ids.map((id) => this.records.get(id)).filter((r): r is ProductRecord => !!r);
  }
  async findBySlug(slug: string) {
    this.check();
    return [...this.records.values()].find((r) => r.slug === slug) ?? null;
  }

  async findPage(filter: ProductFilter) {
    this.check();
    const q = filter.q?.toLowerCase();
    let items = [...this.records.values()].filter(
      (p) =>
        (!filter.demoOnly || p.isDemo) &&
        (!filter.categoryId || p.categoryId === filter.categoryId) &&
        (!filter.brandId || p.brandId === filter.brandId) &&
        (filter.inStock === undefined || (filter.inStock ? p.stock > 0 : p.stock === 0)) &&
        (filter.minPriceCents === undefined || p.salePriceCents >= filter.minPriceCents) &&
        (filter.maxPriceCents === undefined || p.salePriceCents <= filter.maxPriceCents) &&
        (!q || p.name.toLowerCase().includes(q)),
    );
    const order = {
      newest: (a: ProductRecord, b: ProductRecord) => b.createdAt.getTime() - a.createdAt.getTime(),
      'price-asc': (a: ProductRecord, b: ProductRecord) => a.salePriceCents - b.salePriceCents,
      'price-desc': (a: ProductRecord, b: ProductRecord) => b.salePriceCents - a.salePriceCents,
      name: (a: ProductRecord, b: ProductRecord) => a.name.localeCompare(b.name),
    }[filter.sort];
    items = items.sort(order);
    const total = items.length;
    const start = (filter.page - 1) * filter.limit;
    return { items: items.slice(start, start + filter.limit), total };
  }

  async create(record: NewProduct) {
    this.check();
    if ([...this.records.values()].some((r) => r.slug === record.slug))
      throw new DuplicateKeyError();
    // strictly increasing timestamps so "newest" ordering is deterministic in tests
    const created: ProductRecord = {
      ...record,
      id: newId(),
      createdAt: new Date(Date.now() + this.tick++),
    };
    this.records.set(created.id, created);
    return created;
  }
  async update(id: string, patch: ProductPatch) {
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
  async countByCategory(categoryId: string) {
    this.check();
    return [...this.records.values()].filter((p) => p.categoryId === categoryId).length;
  }
  async countByBrand(brandId: string) {
    this.check();
    return [...this.records.values()].filter((p) => p.brandId === brandId).length;
  }
  /** Number of upcoming reserveStock calls that succeed before one is refused (to test rollback). */
  reserveBudget: number | null = null;
  async reserveStock(productId: string, quantity: number) {
    this.check();
    const current = this.records.get(productId);
    if (!current || current.stock < quantity) return false;
    if (this.reserveBudget !== null) {
      if (this.reserveBudget <= 0) return false;
      this.reserveBudget -= 1;
    }
    this.records.set(productId, { ...current, stock: current.stock - quantity });
    return true;
  }
  async restoreStock(productId: string, quantity: number) {
    this.check();
    const current = this.records.get(productId);
    if (current) this.records.set(productId, { ...current, stock: current.stock + quantity });
  }
}
