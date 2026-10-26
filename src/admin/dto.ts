import { z } from 'zod';
import { ORDER_STATUSES } from '../orders/order-status';

const page = z.coerce.number().int().min(1).max(10_000).default(1);
const limit = z.coerce.number().int().min(1).max(50).default(20);

export const pageQuerySchema = z.strictObject({ page, limit });
export const adminOrdersQuerySchema = z.strictObject({
  status: z.enum(ORDER_STATUSES).optional(),
  page,
  limit,
});

export type PageQuery = z.infer<typeof pageQuerySchema>;
export type AdminOrdersQuery = z.infer<typeof adminOrdersQuerySchema>;
