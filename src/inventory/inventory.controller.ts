import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodPipe } from '../catalogue/dto';
import { Role } from '../users/role';
import { InventoryService } from './inventory.service';
import { MOVEMENT_REASONS } from './movement.schema';

const movementsQuerySchema = z.strictObject({
  productId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, { error: 'must be a valid id' })
    .transform((s) => s.toLowerCase())
    .optional(),
  reason: z.enum(MOVEMENT_REASONS).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
type MovementsQuery = z.infer<typeof movementsQuerySchema>;

/** Stock history, newest first. Read-only; the demo viewer sees synthetic products only. */
@Roles(Role.ADMIN, Role.DEMO_VIEWER)
@Controller('admin/inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('movements')
  list(
    @Query(new ZodPipe(movementsQuerySchema)) query: MovementsQuery,
    @CurrentUser() viewer: AuthenticatedUser,
  ) {
    return this.inventory.list(query, viewer);
  }
}
