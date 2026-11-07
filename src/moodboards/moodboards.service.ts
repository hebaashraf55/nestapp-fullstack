import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AuthenticatedUser } from '../auth/auth.types';
import { ProductsService, ProductView } from '../catalogue/catalogue.services';
import { MoodboardCreateDto, MoodboardUpdateDto } from './dto';
import { MOODBOARD_MAX_PRODUCTS, MOODBOARDS_PER_USER } from './moodboard.schema';
import { MoodboardRecord, MoodboardsRepository } from './moodboards.repository';

export interface MoodboardView {
  id: string;
  name: string;
  note: string;
  productIds: string[];
  /** Only products that still exist; removed ones are left out. */
  products: ProductView[];
  /** Present while the board is shared: the path of its public, read-only page. */
  sharePath: string | null;
  createdAt: Date;
  updatedAt: Date;
}
/** What anyone with the link sees: no owner, no ids of the owner, nothing to change. */
export interface SharedMoodboardView {
  name: string;
  note: string;
  products: ProductView[];
  updatedAt: Date;
}

const notFound = () => new NotFoundException('Moodboard not found');

@Injectable()
export class MoodboardsService {
  constructor(
    private readonly boards: MoodboardsRepository,
    private readonly products: ProductsService,
  ) {}

  async list(user: AuthenticatedUser): Promise<MoodboardView[]> {
    return Promise.all((await this.boards.listByUser(user.id)).map((b) => this.view(b, user)));
  }

  async get(id: string, user: AuthenticatedUser): Promise<MoodboardView> {
    const board = await this.boards.findOwned(id, user.id);
    if (!board) throw notFound();
    return this.view(board, user);
  }

  async create(dto: MoodboardCreateDto, user: AuthenticatedUser): Promise<MoodboardView> {
    if ((await this.boards.countByUser(user.id)) >= MOODBOARDS_PER_USER)
      throw new ConflictException(`You can keep up to ${MOODBOARDS_PER_USER} moodboards`);
    return this.view(await this.boards.create({ userId: user.id, ...dto }), user);
  }

  async update(
    id: string,
    dto: MoodboardUpdateDto,
    user: AuthenticatedUser,
  ): Promise<MoodboardView> {
    const board = await this.boards.update(id, user.id, dto);
    if (!board) throw notFound();
    return this.view(board, user);
  }

  async remove(id: string, user: AuthenticatedUser): Promise<{ deleted: true }> {
    if (!(await this.boards.delete(id, user.id))) throw notFound();
    return { deleted: true };
  }

  async addProduct(id: string, productId: string, user: AuthenticatedUser): Promise<MoodboardView> {
    if (!(await this.boards.findOwned(id, user.id))) throw notFound();
    await this.products.get(productId, user); // 404 for unknown or hidden products
    const board = await this.boards.addProduct(id, user.id, productId);
    if (!board)
      throw new ConflictException(`A moodboard holds up to ${MOODBOARD_MAX_PRODUCTS} pieces`);
    return this.view(board, user);
  }

  async removeProduct(
    id: string,
    productId: string,
    user: AuthenticatedUser,
  ): Promise<MoodboardView> {
    const board = await this.boards.removeProduct(id, user.id, productId);
    if (!board) throw notFound();
    return this.view(board, user);
  }

  /** Creates a new random link; any earlier link stops working. */
  async share(id: string, user: AuthenticatedUser): Promise<MoodboardView> {
    const board = await this.boards.setShareToken(id, user.id, randomBytes(16).toString('hex'));
    if (!board) throw notFound();
    return this.view(board, user);
  }

  async unshare(id: string, user: AuthenticatedUser): Promise<MoodboardView> {
    const board = await this.boards.setShareToken(id, user.id, null);
    if (!board) throw notFound();
    return this.view(board, user);
  }

  async shared(token: string): Promise<SharedMoodboardView> {
    const board = await this.boards.findByShareToken(token);
    if (!board) throw notFound();
    // Shown as a signed-out visitor would see the products.
    const products = await this.ordered(board.productIds);
    return { name: board.name, note: board.note, products, updatedAt: board.updatedAt };
  }

  private async ordered(ids: string[], user?: AuthenticatedUser) {
    const byId = new Map((await this.products.findVisible(ids, user)).map((p) => [p.id, p]));
    return ids.map((i) => byId.get(i)).filter((p): p is ProductView => p !== undefined);
  }

  private async view(b: MoodboardRecord, user: AuthenticatedUser): Promise<MoodboardView> {
    return {
      id: b.id,
      name: b.name,
      note: b.note,
      productIds: b.productIds,
      products: await this.ordered(b.productIds, user),
      sharePath: b.shareToken ? `/moodboards/shared/${b.shareToken}` : null,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    };
  }
}
