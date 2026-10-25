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
  ProductsRepository,
  TaxonomyRecord,
  TaxonomyRepository,
} from './catalogue.repositories';
import type {
  ProductCreateDto,
  ProductQueryDto,
  ProductUpdateDto,
  TaxonomyCreateDto,
  TaxonomyUpdateDto,
} from './dto';
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
  isDemo: boolean;
  createdAt: Date;
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
  ) {}

  async list(query: ProductQueryDto, user?: AuthenticatedUser): Promise<ProductPage> {
    const { items, total } = await this.products.findPage({
      q: query.q,
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

  async remove(id: string): Promise<{ deleted: true }> {
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
      isDemo: p.isDemo,
      createdAt: p.createdAt,
    }));
  }
}
