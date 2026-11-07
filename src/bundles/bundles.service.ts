import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { demoScope } from '../auth/demo-scope';
import { ProductsService, ProductView } from '../catalogue/catalogue.services';
import { uniqueSlug } from '../catalogue/slug';
import { Role } from '../users/role';
import { BundleCreateDto, BundleListQuery, BundleUpdateDto } from './dto';
import { BundleRecord, BundlesRepository, DuplicateBundleError } from './bundles.repository';

export interface BundleView {
  id: string;
  name: string;
  slug: string;
  description: string;
  image: string | null;
  discountPercent: number;
  active: boolean;
  items: { product: ProductView | null; quantity: number }[];
  /** Today's sale prices of the items, before the bundle discount. Computed by the server. */
  itemsTotalCents: number;
  priceCents: number;
  savingsCents: number;
  /** False when an item was removed, is hidden or lacks stock for a full set. */
  available: boolean;
  createdAt: Date;
}

const demoOnly = (user?: AuthenticatedUser) => (user ? demoScope(user).isDemo === true : false);

@Injectable()
export class BundlesService {
  constructor(
    private readonly bundles: BundlesRepository,
    private readonly products: ProductsService,
  ) {}

  async list(query: BundleListQuery, user?: AuthenticatedUser): Promise<BundleView[]> {
    const all = query.all === 'true' && user?.role === Role.ADMIN;
    const records = await this.bundles.findAll({
      activeOnly: !all,
      demoOnly: demoOnly(user),
      productId: query.productId,
    });
    const views = await this.toViews(records, user);
    // Shoppers only see sets they could actually buy.
    return all ? views : views.filter((v) => v.available);
  }

  async get(slugOrId: string, user?: AuthenticatedUser): Promise<BundleView> {
    const record =
      (await this.bundles.findBySlug(slugOrId.toLowerCase())) ??
      (/^[0-9a-f]{24}$/i.test(slugOrId)
        ? await this.bundles.findById(slugOrId.toLowerCase())
        : null);
    const isAdmin = user?.role === Role.ADMIN;
    if (!record || (!record.active && !isAdmin) || (demoOnly(user) && !record.isDemo))
      throw new NotFoundException('Bundle not found');
    return (await this.toViews([record], user))[0]!;
  }

  async create(dto: BundleCreateDto, admin: AuthenticatedUser): Promise<BundleView> {
    await this.assertProducts(
      dto.items.map((i) => i.productId),
      admin,
    );
    for (let attempt = 0; ; attempt++) {
      try {
        const slug = await uniqueSlug(
          dto.name,
          async (s) => (await this.bundles.findBySlug(s)) !== null,
        );
        const created = await this.bundles.create({
          ...dto,
          slug,
          isDemo: false,
          createdBy: admin.id,
        });
        return (await this.toViews([created], admin))[0]!;
      } catch (e) {
        if (!(e instanceof DuplicateBundleError) || attempt >= 2) throw e;
      }
    }
  }

  async update(id: string, dto: BundleUpdateDto, admin: AuthenticatedUser): Promise<BundleView> {
    const current = await this.bundles.findById(id);
    if (!current) throw new NotFoundException('Bundle not found');
    if (dto.items)
      await this.assertProducts(
        dto.items.map((i) => i.productId),
        admin,
      );
    let slug: string | undefined;
    if (dto.name !== undefined && dto.name !== current.name) {
      slug = await uniqueSlug(dto.name, async (s) => {
        const clash = await this.bundles.findBySlug(s);
        return clash !== null && clash.id !== id;
      });
    }
    try {
      const updated = await this.bundles.update(id, { ...dto, ...(slug ? { slug } : {}) });
      if (!updated) throw new NotFoundException('Bundle not found');
      return (await this.toViews([updated], admin))[0]!;
    } catch (e) {
      if (e instanceof DuplicateBundleError)
        throw new ConflictException('Bundle name conflicts, try again');
      throw e;
    }
  }

  async remove(id: string): Promise<{ deleted: true }> {
    if (!(await this.bundles.delete(id))) throw new NotFoundException('Bundle not found');
    return { deleted: true };
  }

  private async assertProducts(ids: string[], admin: AuthenticatedUser) {
    const found = await this.products.findVisible(ids, admin);
    if (found.length !== new Set(ids).size)
      throw new BadRequestException('Every bundled product must exist');
  }

  private async toViews(records: BundleRecord[], user?: AuthenticatedUser): Promise<BundleView[]> {
    const ids = [...new Set(records.flatMap((r) => r.items.map((i) => i.productId)))];
    const byId = new Map((await this.products.findVisible(ids, user)).map((p) => [p.id, p]));
    return records.map((r) => {
      const items = r.items.map((i) => ({
        product: byId.get(i.productId) ?? null,
        quantity: i.quantity,
      }));
      const itemsTotalCents = items.reduce(
        (sum, i) => sum + (i.product ? i.product.salePriceCents * i.quantity : 0),
        0,
      );
      const savingsCents = Math.round((itemsTotalCents * r.discountPercent) / 100);
      return {
        id: r.id,
        name: r.name,
        slug: r.slug,
        description: r.description,
        image: r.image,
        discountPercent: r.discountPercent,
        active: r.active,
        items,
        itemsTotalCents,
        priceCents: itemsTotalCents - savingsCents,
        savingsCents,
        available: items.every((i) => i.product !== null && i.product.stock >= i.quantity),
        createdAt: r.createdAt,
      };
    });
  }
}
