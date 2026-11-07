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

export const analyticsQuerySchema = z.strictObject({
  days: z.coerce
    .number()
    .pipe(z.union([z.literal(7), z.literal(30), z.literal(90)]))
    .default(30),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export type PageQuery = z.infer<typeof pageQuerySchema>;
export type AdminOrdersQuery = z.infer<typeof adminOrdersQuerySchema>;
