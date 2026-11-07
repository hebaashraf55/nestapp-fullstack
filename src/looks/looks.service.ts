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
import { LookCreateDto, LookListQuery, LookUpdateDto } from './dto';
import { DuplicateLookError, LookRecord, LooksRepository } from './looks.repository';

export interface LookView {
  id: string;
  title: string;
  slug: string;
  description: string;
  image: string;
  active: boolean;
  /** Products removed from the catalogue are left out. */
  spots: { product: ProductView; x: number | null; y: number | null }[];
  /** Today's sale prices of every piece in the look, one of each. */
  totalCents: number;
  createdAt: Date;
}

const demoOnly = (user?: AuthenticatedUser) => (user ? demoScope(user).isDemo === true : false);

@Injectable()
export class LooksService {
  constructor(
    private readonly looks: LooksRepository,
    private readonly products: ProductsService,
  ) {}

  async list(query: LookListQuery, user?: AuthenticatedUser): Promise<LookView[]> {
    const all = query.all === 'true' && user?.role === Role.ADMIN;
    const records = await this.looks.findAll({
      activeOnly: !all,
      demoOnly: demoOnly(user),
      productId: query.productId,
    });
    return (await this.toViews(records, user)).filter((v) => all || v.spots.length > 0);
  }

  async get(slug: string, user?: AuthenticatedUser): Promise<LookView> {
    const record = /^[a-z0-9-]{1,100}$/.test(slug) ? await this.looks.findBySlug(slug) : null;
    if (
      !record ||
      (!record.active && user?.role !== Role.ADMIN) ||
      (demoOnly(user) && !record.isDemo)
    )
      throw new NotFoundException('Look not found');
    return (await this.toViews([record], user))[0]!;
  }

  async create(dto: LookCreateDto, admin: AuthenticatedUser): Promise<LookView> {
    await this.assertProducts(
      dto.spots.map((s) => s.productId),
      admin,
    );
    for (let attempt = 0; ; attempt++) {
      try {
        const slug = await uniqueSlug(
          dto.title,
          async (s) => (await this.looks.findBySlug(s)) !== null,
        );
        const created = await this.looks.create({
          ...dto,
          slug,
          isDemo: false,
          createdBy: admin.id,
        });
        return (await this.toViews([created], admin))[0]!;
      } catch (e) {
        if (!(e instanceof DuplicateLookError) || attempt >= 2) throw e;
      }
    }
  }

  async update(id: string, dto: LookUpdateDto, admin: AuthenticatedUser): Promise<LookView> {
    const current = await this.looks.findById(id);
    if (!current) throw new NotFoundException('Look not found');
    if (dto.spots)
      await this.assertProducts(
        dto.spots.map((s) => s.productId),
        admin,
      );
    let slug: string | undefined;
    if (dto.title !== undefined && dto.title !== current.title) {
      slug = await uniqueSlug(dto.title, async (s) => {
        const clash = await this.looks.findBySlug(s);
        return clash !== null && clash.id !== id;
      });
    }
    try {
      const updated = await this.looks.update(id, { ...dto, ...(slug ? { slug } : {}) });
      if (!updated) throw new NotFoundException('Look not found');
      return (await this.toViews([updated], admin))[0]!;
    } catch (e) {
      if (e instanceof DuplicateLookError)
        throw new ConflictException('Look title conflicts, try again');
      throw e;
    }
  }

  async remove(id: string): Promise<{ deleted: true }> {
    if (!(await this.looks.delete(id))) throw new NotFoundException('Look not found');
    return { deleted: true };
  }

  private async assertProducts(ids: string[], admin: AuthenticatedUser) {
    if ((await this.products.findVisible(ids, admin)).length !== new Set(ids).size)
      throw new BadRequestException('Every product in a look must exist');
  }

  private async toViews(records: LookRecord[], user?: AuthenticatedUser): Promise<LookView[]> {
    const ids = [...new Set(records.flatMap((r) => r.spots.map((s) => s.productId)))];
    const byId = new Map((await this.products.findVisible(ids, user)).map((p) => [p.id, p]));
    return records.map((r) => {
      const spots = r.spots
        .filter((s) => byId.has(s.productId))
        .map((s) => ({ product: byId.get(s.productId)!, x: s.x, y: s.y }));
      return {
        id: r.id,
        title: r.title,
        slug: r.slug,
        description: r.description,
        image: r.image,
        active: r.active,
        spots,
        totalCents: spots.reduce((sum, s) => sum + s.product.salePriceCents, 0),
        createdAt: r.createdAt,
      };
    });
  }
}
