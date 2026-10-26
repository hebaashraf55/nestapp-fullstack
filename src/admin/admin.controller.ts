import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodPipe } from '../catalogue/dto';
import { Role } from '../users/role';
import { AdminService } from './admin.service';
import { AdminOrdersQuery, adminOrdersQuerySchema, PageQuery, pageQuerySchema } from './dto';

/*
 * Staff reporting. Read-only by design: the demo viewer may call these GET routes (limited to synthetic
 * records by AdminService); changing an order uses the existing admin-only /order routes. The audit log
 * contains actor ids, so it is ADMIN only.
 */
@Roles(Role.ADMIN, Role.DEMO_VIEWER)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly audit: AuditService,
  ) {}

  @Get('stats')
  stats(@CurrentUser() viewer: AuthenticatedUser) {
    return this.admin.stats(viewer);
  }

  @Get('customers')
  customers(
    @Query(new ZodPipe(pageQuerySchema)) query: PageQuery,
    @CurrentUser() viewer: AuthenticatedUser,
  ) {
    return this.admin.customers(viewer, query);
  }

  @Get('orders')
  orders(
    @Query(new ZodPipe(adminOrdersQuerySchema)) query: AdminOrdersQuery,
    @CurrentUser() viewer: AuthenticatedUser,
  ) {
    return this.admin.ordersPage(viewer, query);
  }

  @Roles(Role.ADMIN)
  @Get('audit')
  async auditLog(@Query(new ZodPipe(pageQuerySchema)) query: PageQuery) {
    const { items, total } = await this.audit.list(query.page, query.limit);
    return {
      items,
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }
}
