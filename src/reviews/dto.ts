import { z } from 'zod';
import { REVIEW_STATUSES } from './review.schema';

/** Plain text only: control characters are refused, surrounding space trimmed. */
const text = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    // eslint-disable-next-line no-control-regex
    .refine((s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s), {
      error: 'must not contain control characters',
    });

export const reviewWriteSchema = z.strictObject({
  rating: z.number().int().min(1).max(5),
  title: text(120, 2),
  body: text(2000, 10),
});
export type ReviewWriteDto = z.infer<typeof reviewWriteSchema>;

export const reviewListQuerySchema = z.strictObject({
  sort: z.enum(['newest', 'highest', 'lowest']).default('newest'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type ReviewListQuery = z.infer<typeof reviewListQuerySchema>;

export const moderationQuerySchema = z.strictObject({
  status: z.enum(REVIEW_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ModerationQuery = z.infer<typeof moderationQuerySchema>;

export const moderateSchema = z.strictObject({
  status: z.enum(['APPROVED', 'REJECTED']),
  note: text(300).nullable().optional(),
});
export type ModerateDto = z.infer<typeof moderateSchema>;
