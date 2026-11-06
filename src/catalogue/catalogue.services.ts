import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { canSee, demoScope } from '../auth/demo-scope';
import {
  BrandsRepository,
  CategoriesRepository,
  DuplicateKeyError,
  ProductRecord,
  ProductSpecs,
  ProductsRepository,
  TaxonomyRecord,
  TaxonomyRepository,
} from './catalogue.repositories';
import type {
  ProductCreateDto,
  ProductQueryDto,
  ProductUpdateDto,
  StockAdjustDto,
  TaxonomyCreateDto,
  TaxonomyUpdateDto,
} from './dto';
import { MAX_STOCK } from './dto';
import { OrdersRepository } from '../orders/orders.repository';
import { uniqueSlug } from './slug';

export const CURRENCY = 'USD';

/** A viewer restricted to synthetic data (demo viewer) must not see anything else. */
const demoOnly = (user?: AuthenticatedUser): boolean =>
  user ? demoScope(user).isDemo === true : false;
const visible = (user: AuthenticatedUser | undefined, record: { isDemo: boolean }): boolean =>
  user ? canSee(user, record) : true;

export interface TaxonomyView {
  id: string;
  name: string;
  slug: string;
  image: string | null;
  isDemo: boolean;
  createdAt: Date;
}
const taxonomyView = (r: TaxonomyRecord): TaxonomyView => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  image: r.image,
  isDemo: r.isDemo,
  createdAt: r.createdAt,
});

/** Shared behaviour of brands and categories. */
abstract class TaxonomyService {
  protected abstract readonly label: string;
  protected abstract readonly repo: TaxonomyRepository;
  protected abstract countUsage(id: string): Promise<number>;

  async list(user?: AuthenticatedUser): Promise<TaxonomyView[]> {
    return (await this.repo.findAll(demoOnly(user))).map(taxonomyView);
  }

  async get(id: string, user?: AuthenticatedUser): Promise<TaxonomyView> {
    return taxonomyView(await this.find(id, user));
  }

  async create(dto: TaxonomyCreateDto, adminId: string): Promise<TaxonomyView> {
    try {
      const slug = await uniqueSlug(dto.name, async () => false);
      // The slug doubles as the uniqueness key for the name: "Blue Vase" and "blue  vase" collide.
      if (await this.repo.findBySlug(slug)) throw new DuplicateKeyError();
      return taxonomyView(
        await this.repo.create({
          name: dto.name,
          slug,
          image: dto.image ?? null,
          isDemo: false,
          createdBy: adminId,
        }),
      );
    } catch (error) {
      throw this.translate(error);
    }
  }

  async update(id: string, dto: TaxonomyUpdateDto): Promise<TaxonomyView> {
    const current = await this.find(id);
    try {
      const patch: { name?: string; slug?: string; image?: string | null } = {};
      if (dto.image !== undefined) patch.image = dto.image;
      if (dto.name !== undefined && dto.name !== current.name) {
        const slug = await uniqueSlug(dto.name, async () => false);
        const clash = await this.repo.findBySlug(slug);
        if (clash && clash.id !== id) throw new DuplicateKeyError();
        patch.name = dto.name;
        patch.slug = slug;
      }
      const updated = await this.repo.update(id, patch);
      if (!updated) throw new NotFoundException(`${this.label} not found`);
      return taxonomyView(updated);
    } catch (error) {
      throw this.translate(error);
    }
  }

  async remove(id: string): Promise<{ deleted: true }> {
    await this.find(id);
    if ((await this.countUsage(id)) > 0) {
      throw new ConflictException(`${this.label} is used by products and cannot be deleted`);
    }
    if (!(await this.repo.delete(id))) throw new NotFoundException(`${this.label} not found`);
    return { deleted: true };
  }

  /** Not-found for a missing record AND for one the caller may not see (no existence leak). */
  protected async find(id: string, user?: AuthenticatedUser): Promise<TaxonomyRecord> {
    const record = await this.repo.findById(id);
    if (!record || !visible(user, record)) throw new NotFoundException(`${this.label} not found`);
    return record;
  }

  private translate(error: unknown): unknown {
    return error instanceof DuplicateKeyError
      ? new ConflictException(`A ${this.label.toLowerCase()} with this name already exists`)
      : error;
  }
}

@Injectable()
export class BrandsService extends TaxonomyService {
  protected readonly label = 'Brand';
  constructor(
    protected readonly repo: BrandsRepository,
    private readonly products: ProductsRepository,
  ) {
    super();
  }
  protected countUsage(id: string) {
    return this.products.countByBrand(id);
  }
}

@Injectable()
export class CategoriesService extends TaxonomyService {
  protected readonly label = 'Category';
  constructor(
    protected readonly repo: CategoriesRepository,
    private readonly products: ProductsRepository,
  ) {
    super();
  }
  protected countUsage(id: string) {
    return this.products.countByCategory(id);
  }
}

export interface ProductView {
  id: string;
  name: string;
  slug: string;
  description: string;
  images: string[];
  priceCents: number;
  discountPercent: number;
  salePriceCents: number;
  currency: string;
  stock: number;
  inStock: boolean;
  category: { id: string; name: string; slug: string } | null;
  brand: { id: string; name: string; slug: string } | null;
  specs: ProductSpecs;
  featured: boolean;
  isDemo: boolean;
  createdAt: Date;
}

export interface HomeView {
  categories: { id: string; name: string; slug: string; count: number; products: ProductView[] }[];
  featured: ProductView[];
  newArrivals: ProductView[];
  onSale: ProductView[];
  /** From real paid orders only; empty until something sells. */
  bestSellers: ProductView[];
}

export interface ProductPage {
  items: ProductView[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** The only place a sale price is computed. Clients can never send one. */
export function computeSalePriceCents(priceCents: number, discountPercent: number): number {
  return Math.max(1, Math.round((priceCents * (100 - discountPercent)) / 100));
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly products: ProductsRepository,
    private readonly brands: BrandsRepository,
    private readonly categories: CategoriesRepository,
    private readonly orders: OrdersRepository,
  ) {}

  async list(query: ProductQueryDto, user?: AuthenticatedUser): Promise<ProductPage> {
    const { items, total } = await this.products.findPage({
      q: query.q,
      matchTaxonomyIds: query.q
        ? await this.taxonomyIdsMatching(query.q, demoOnly(user))
        : undefined,
      featured: query.featured === 'true' ? true : undefined,
      onSale: query.onSale === 'true' ? true : undefined,
      categoryId: query.categoryId?.toLowerCase(),
      brandId: query.brandId?.toLowerCase(),
      minPriceCents: query.minPrice,
      maxPriceCents: query.maxPrice,
      inStock: query.inStock === undefined ? undefined : query.inStock === 'true',
      demoOnly: demoOnly(user),
      sort: query.sort,
      page: query.page,
      limit: query.limit,
    });
    return {
      items: await this.toViews(items),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  /** Products by id that exist and the caller may see, in no particular order. Unknown ids are skipped. */
  async findVisible(ids: string[], user?: AuthenticatedUser): Promise<ProductView[]> {
    const unique = [...new Set(ids.map((i) => i.toLowerCase()))];
    if (unique.length === 0) return [];
    const found = (await this.products.findByIds(unique)).filter((p) => visible(user, p));
    return this.toViews(found);
  }

  /** Side-by-side comparison of 2–4 products, in the order requested. Missing specs stay empty. */
  async compare(ids: string[], user?: AuthenticatedUser): Promise<ProductView[]> {
    const views = await this.findVisible(ids, user);
    const byId = new Map(views.map((v) => [v.id, v]));
    return ids.map((id) => byId.get(id.toLowerCase())).filter((v): v is ProductView => !!v);
  }

  /**
   * Everything the homepage needs in one call: each category with its count and first eight
   * products, plus featured, new, on-sale and best-selling rows. Best sellers come only from real
   * paid orders; the row is empty (and hidden) until something has sold.
   */
  async home(user?: AuthenticatedUser): Promise<HomeView> {
    const scope = demoOnly(user);
    const page = (extra: Partial<Parameters<ProductsRepository['findPage']>[0]>) =>
      this.products.findPage({ demoOnly: scope, sort: 'newest', page: 1, limit: 8, ...extra });
    const cats = (await this.categories.findAll(scope)).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const [perCategory, featured, newest, onSale, sold] = await Promise.all([
      Promise.all(cats.map((c) => page({ categoryId: c.id }))),
      page({ featured: true }),
      page({}),
      page({ onSale: true, sort: 'price-asc' }),
      this.orders.bestSellers(8, scope),
    ]);
    const soldRecords = (await this.products.findByIds(sold.map((s) => s.productId))).filter((p) =>
      visible(user, p),
    );
    const soldById = new Map(soldRecords.map((p) => [p.id, p]));
    const bestSellers = sold
      .map((s) => soldById.get(s.productId))
      .filter((p): p is ProductRecord => !!p);
    const [featuredV, newestV, saleV, bestV, ...catViews] = await Promise.all([
      this.toViews(featured.items),
      this.toViews(newest.items),
      this.toViews(onSale.items),
      this.toViews(bestSellers),
      ...perCategory.map((r) => this.toViews(r.items)),
    ]);
    return {
      categories: cats.map((c, i) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        count: perCategory[i]!.total,
        products: catViews[i]!,
      })),
      featured: featuredV,
      newArrivals: newestV,
      onSale: saleV,
      bestSellers: bestV,
    };
  }

  async get(id: string, user?: AuthenticatedUser): Promise<ProductView> {
    const product = await this.products.findById(id);
    if (!product || !visible(user, product)) throw new NotFoundException('Product not found');
    return (await this.toViews([product]))[0] as ProductView;
  }

  async create(dto: ProductCreateDto, adminId: string): Promise<ProductView> {
    await this.assertTaxonomy(dto.categoryId, dto.brandId);
    const base = {
      name: dto.name,
      description: dto.description,
      images: dto.images,
      priceCents: dto.priceCents,
      discountPercent: dto.discountPercent,
      salePriceCents: computeSalePriceCents(dto.priceCents, dto.discountPercent),
      stock: dto.stock,
      categoryId: dto.categoryId.toLowerCase(),
      brandId: dto.brandId.toLowerCase(),
      specs: dto.specs,
      featured: dto.featured,
      isDemo: false, // clients can never create synthetic-flagged records
      createdBy: adminId,
    };
    // A concurrent insert with the same name can still win the slug; retry once with a fresh one.
    for (let attempt = 0; ; attempt++) {
      try {
        const slug = await uniqueSlug(
          dto.name,
          async (s) => (await this.products.findBySlug(s)) !== null,
        );
        const created = await this.products.create({ ...base, slug });
        return (await this.toViews([created]))[0] as ProductView;
      } catch (error) {
        if (!(error instanceof DuplicateKeyError) || attempt >= 2) throw error;
      }
    }
  }

  async update(id: string, dto: ProductUpdateDto): Promise<ProductView> {
    const current = await this.products.findById(id);
    if (!current) throw new NotFoundException('Product not found');
    if (dto.categoryId || dto.brandId) {
      await this.assertTaxonomy(
        dto.categoryId ?? current.categoryId,
        dto.brandId ?? current.brandId,
      );
    }
    const priceCents = dto.priceCents ?? current.priceCents;
    const discountPercent = dto.discountPercent ?? current.discountPercent;
    const patch = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.images !== undefined ? { images: dto.images } : {}),
      ...(dto.stock !== undefined ? { stock: dto.stock } : {}),
      ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId.toLowerCase() } : {}),
      ...(dto.brandId !== undefined ? { brandId: dto.brandId.toLowerCase() } : {}),
      ...(dto.specs !== undefined ? { specs: dto.specs } : {}),
      ...(dto.featured !== undefined ? { featured: dto.featured } : {}),
      priceCents,
      discountPercent,
      salePriceCents: computeSalePriceCents(priceCents, discountPercent),
    };
    let slugPatch = {};
    if (dto.name !== undefined && dto.name !== current.name) {
      slugPatch = {
        slug: await uniqueSlug(dto.name, async (s) => {
          const clash = await this.products.findBySlug(s);
          return clash !== null && clash.id !== id;
        }),
      };
    }
    try {
      const updated = await this.products.update(id, { ...patch, ...slugPatch });
      if (!updated) throw new NotFoundException('Product not found');
      return (await this.toViews([updated]))[0] as ProductView;
    } catch (error) {
      if (error instanceof DuplicateKeyError)
        throw new ConflictException('Product name conflicts, try again');
      throw error;
    }
  }

  /**
   * Receive or write off stock without overwriting it: uses the same atomic operations as order
   * reservations, so a concurrent order can never be lost and stock can never go below zero.
   */
  async adjustStock(id: string, dto: StockAdjustDto): Promise<ProductView> {
    const current = await this.products.findById(id);
    if (!current) throw new NotFoundException('Product not found');
    if (dto.change < 0) {
      if (!(await this.products.reserveStock(id, -dto.change))) {
        throw new ConflictException(`Only ${current.stock} in stock; stock cannot go below zero`);
      }
    } else {
      if (current.stock + dto.change > MAX_STOCK) {
        throw new BadRequestException(`Stock cannot exceed ${MAX_STOCK}`);
      }
      await this.products.restoreStock(id, dto.change);
    }
    const updated = await this.products.findById(id);
    if (!updated) throw new NotFoundException('Product not found');
    return (await this.toViews([updated]))[0] as ProductView;
  }

  /**
   * Placed orders keep their own copy of each line (name, price), so history survives a deletion.
   * A product still held by an unpaid or paid order is refused: a later cancel, expiry or refund
   * would have no product to return the stock to.
   */
  async remove(id: string): Promise<{ deleted: true }> {
    if (!(await this.products.findById(id))) throw new NotFoundException('Product not found');
    const holding = await this.orders.countStockHoldingWithProduct(id);
    if (holding > 0) {
      throw new ConflictException(
        `This product is in ${holding} open order${holding === 1 ? '' : 's'}. Set its stock to 0 to stop sales, and delete it once those orders are settled.`,
      );
    }
    if (!(await this.products.delete(id))) throw new NotFoundException('Product not found');
    return { deleted: true };
  }

  private async assertTaxonomy(categoryId: string, brandId: string): Promise<void> {
    if (!(await this.categories.findById(categoryId.toLowerCase()))) {
      throw new BadRequestException([{ field: 'categoryId', message: 'unknown category' }]);
    }
    if (!(await this.brands.findById(brandId.toLowerCase()))) {
      throw new BadRequestException([{ field: 'brandId', message: 'unknown brand' }]);
    }
  }

  /** Category and brand ids whose name contains the search text (small collections, filtered in memory). */
  private async taxonomyIdsMatching(q: string, demoOnlyScope: boolean): Promise<string[]> {
    const needle = q.toLowerCase();
    const [cats, brands] = await Promise.all([
      this.categories.findAll(demoOnlyScope),
      this.brands.findAll(demoOnlyScope),
    ]);
    return [...cats, ...brands]
      .filter((t) => t.name.toLowerCase().includes(needle))
      .map((t) => t.id);
  }

  private async toViews(items: ProductRecord[]): Promise<ProductView[]> {
    if (items.length === 0) return [];
    const [cats, brands] = await Promise.all([
      this.categories.findByIds([...new Set(items.map((p) => p.categoryId))]),
      this.brands.findByIds([...new Set(items.map((p) => p.brandId))]),
    ]);
    const catMap = new Map(cats.map((c) => [c.id, c]));
    const brandMap = new Map(brands.map((b) => [b.id, b]));
    const ref = (r: TaxonomyRecord | undefined) =>
      r ? { id: r.id, name: r.name, slug: r.slug } : null;
    return items.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      images: p.images,
      priceCents: p.priceCents,
      discountPercent: p.discountPercent,
      salePriceCents: p.salePriceCents,
      currency: CURRENCY,
      stock: p.stock,
      inStock: p.stock > 0,
      category: ref(catMap.get(p.categoryId)),
      brand: ref(brandMap.get(p.brandId)),
      specs: p.specs ?? {},
      featured: p.featured === true,
      isDemo: p.isDemo,
      createdAt: p.createdAt,
    }));
  }
}
