import { Injectable } from '@nestjs/common';
import { demoScope } from '../auth/demo-scope';
import { AuthenticatedUser } from '../auth/auth.types';
import { ProductsRepository } from '../catalogue/catalogue.repositories';
import { ORDER_STATUSES, SIMULATION_NOTICE } from '../orders/order-status';
import { OrdersRepository } from '../orders/orders.repository';
import { toOrderView } from '../orders/orders.service';
import { Role } from '../users/role';
import { UsersRepository } from '../users/users.repository';
import type { AdminOrdersQuery, PageQuery } from './dto';
import { maskEmail, maskName } from './mask';

export const LOW_STOCK_AT = 5;

const pages = (total: number, limit: number) => Math.max(1, Math.ceil(total / limit));

/**
 * Read-only reporting for staff. The demo viewer is served the same shapes, but every query is limited
 * to synthetic (`isDemo`) records. Customer identities are always masked; password hashes never leave
 * the user repository projection used here.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly users: UsersRepository,
    private readonly orders: OrdersRepository,
    private readonly products: ProductsRepository,
  ) {}

  private demoOnly(viewer: AuthenticatedUser): boolean {
    return demoScope(viewer).isDemo === true;
  }

  async stats(viewer: AuthenticatedUser) {
    const demoOnly = this.demoOnly(viewer);
    const [customers, stock, orders] = await Promise.all([
      this.users.findPage({ roles: [Role.CUSTOMER], demoOnly, page: 1, limit: 1 }),
      this.products.summarizeStock(demoOnly, LOW_STOCK_AT),
      this.orders.summarize(demoOnly),
    ]);
    const byStatus = Object.fromEntries(
      ORDER_STATUSES.map((s) => [s, orders.countsByStatus[s] ?? 0]),
    );
    return {
      scope: demoOnly ? 'demo' : 'all',
      currency: 'USD',
      customers: customers.total,
      products: { ...stock, lowStockThreshold: LOW_STOCK_AT },
      orders: { total: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus },
      simulatedPaidCents: orders.paidCents,
      simulatedRefundedCents: orders.refundedCents,
      notice: SIMULATION_NOTICE,
    };
  }

  async customers(viewer: AuthenticatedUser, query: PageQuery) {
    const { items, total } = await this.users.findPage({
      roles: [Role.CUSTOMER],
      demoOnly: this.demoOnly(viewer),
      page: query.page,
      limit: query.limit,
    });
    return {
      items: items.map((u) => ({
        id: u.id,
        displayName: maskName(u.name),
        maskedEmail: maskEmail(u.email),
        emailVerified: u.emailVerified,
        isDemo: u.isDemo,
        createdAt: u.createdAt,
      })),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: pages(total, query.limit),
    };
  }

  async ordersPage(viewer: AuthenticatedUser, query: AdminOrdersQuery) {
    const { items, total } = await this.orders.findPage({
      status: query.status,
      demoOnly: this.demoOnly(viewer),
      page: query.page,
      limit: query.limit,
    });
    const owners = await this.users.findByIds([...new Set(items.map((o) => o.userId))]);
    const byId = new Map(owners.map((u) => [u.id, u]));
    return {
      items: items.map((o) => {
        const owner = byId.get(o.userId);
        return {
          ...toOrderView(o),
          customer: {
            id: o.userId,
            displayName: owner ? maskName(owner.name) : 'Deleted customer',
            maskedEmail: owner ? maskEmail(owner.email) : '***',
          },
        };
      }),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: pages(total, query.limit),
    };
  }
}
