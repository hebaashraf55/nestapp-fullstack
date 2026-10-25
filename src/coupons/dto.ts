import { z } from 'zod';

const MAX_DISCOUNT = 90;
const FIVE_YEARS_MS = 5 * 365 * 24 * 3600 * 1000;

export const couponCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{2,31}$/, { error: 'use 3–32 letters, digits, "-" or "_"' });

const expiry = z.iso
  .datetime({ error: 'must be an ISO 8601 date-time' })
  .transform((v) => new Date(v))
  .refine((d) => d.getTime() <= Date.now() + FIVE_YEARS_MS, { error: 'must be within five years' });

export const couponCreateSchema = z.strictObject({
  code: couponCode,
  discountPercent: z.number().int().min(1).max(MAX_DISCOUNT),
  expiresAt: expiry.refine((d) => d.getTime() > Date.now(), { error: 'must be in the future' }),
});

/** The code is immutable: carts and customers may already hold it. */
export const couponUpdateSchema = z
  .strictObject({
    discountPercent: z.number().int().min(1).max(MAX_DISCOUNT).optional(),
    expiresAt: expiry.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: 'provide at least one field to change' });

export type CouponCreateDto = z.infer<typeof couponCreateSchema>;
export type CouponUpdateDto = z.infer<typeof couponUpdateSchema>;
