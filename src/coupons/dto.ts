import { z } from 'zod';

const MAX_DISCOUNT = 90;
const MAX_CENTS = 10_000_000;
const FIVE_YEARS_MS = 5 * 365 * 24 * 3600 * 1000;

export const couponCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{2,31}$/, { error: 'use 3–32 letters, digits, "-" or "_"' });

const date = z.iso
  .datetime({ error: 'must be an ISO 8601 date-time' })
  .transform((v) => new Date(v))
  .refine((d) => d.getTime() <= Date.now() + FIVE_YEARS_MS, { error: 'must be within five years' });
const objectIds = z
  .array(
    z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, { error: 'must be a valid id' })
      .transform((s) => s.toLowerCase()),
  )
  .max(100);
const count = z.number().int().min(1).max(1_000_000);

const fields = {
  type: z.enum(['PERCENT', 'FIXED']),
  discountPercent: z.number().int().min(1).max(MAX_DISCOUNT),
  amountOffCents: z.number().int().min(1).max(MAX_CENTS),
  minSubtotalCents: z.number().int().min(0).max(MAX_CENTS),
  startsAt: date.nullable(),
  expiresAt: date,
  maxUses: count.nullable(),
  maxUsesPerCustomer: count.nullable(),
  scope: z.enum(['ALL', 'PRODUCTS', 'CATEGORIES']),
  productIds: objectIds,
  categoryIds: objectIds,
  automatic: z.boolean(),
  active: z.boolean(),
};

/** The rules that hold however a coupon was put together. */
const consistent = <T extends Record<string, unknown>>(v: T, ctx: z.RefinementCtx) => {
  if (v.type === 'PERCENT' && v.amountOffCents != null)
    ctx.addIssue({
      code: 'custom',
      path: ['amountOffCents'],
      message: 'only for fixed-amount coupons',
    });
  if (v.type === 'FIXED' && v.discountPercent != null)
    ctx.addIssue({
      code: 'custom',
      path: ['discountPercent'],
      message: 'only for percentage coupons',
    });
  if (v.scope === 'PRODUCTS' && !(v.productIds as string[] | undefined)?.length)
    ctx.addIssue({ code: 'custom', path: ['productIds'], message: 'choose at least one product' });
  if (v.scope === 'CATEGORIES' && !(v.categoryIds as string[] | undefined)?.length)
    ctx.addIssue({
      code: 'custom',
      path: ['categoryIds'],
      message: 'choose at least one category',
    });
  const starts = v.startsAt as Date | null | undefined;
  const ends = v.expiresAt as Date | undefined;
  if (starts && ends && starts.getTime() >= ends.getTime())
    ctx.addIssue({ code: 'custom', path: ['startsAt'], message: 'must be before the expiry date' });
  const per = v.maxUsesPerCustomer as number | null | undefined;
  const all = v.maxUses as number | null | undefined;
  if (per && all && per > all)
    ctx.addIssue({
      code: 'custom',
      path: ['maxUsesPerCustomer'],
      message: 'cannot exceed the total limit',
    });
};

export const couponCreateSchema = z
  .strictObject({
    code: couponCode,
    type: fields.type.default('PERCENT'),
    discountPercent: fields.discountPercent.optional(),
    amountOffCents: fields.amountOffCents.optional(),
    minSubtotalCents: fields.minSubtotalCents.default(0),
    startsAt: fields.startsAt.default(null),
    expiresAt: fields.expiresAt.refine((d) => d.getTime() > Date.now(), {
      error: 'must be in the future',
    }),
    maxUses: fields.maxUses.default(null),
    maxUsesPerCustomer: fields.maxUsesPerCustomer.default(null),
    scope: fields.scope.default('ALL'),
    productIds: fields.productIds.default([]),
    categoryIds: fields.categoryIds.default([]),
    automatic: fields.automatic.default(false),
    active: fields.active.default(true),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'PERCENT' && v.discountPercent === undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['discountPercent'],
        message: 'required for a percentage coupon',
      });
    if (v.type === 'FIXED' && v.amountOffCents === undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['amountOffCents'],
        message: 'required for a fixed-amount coupon',
      });
    consistent(v, ctx);
  });

/** The code and the type are immutable: carts and customers may already hold the coupon. */
export const couponUpdateSchema = z
  .strictObject({
    discountPercent: fields.discountPercent.optional(),
    amountOffCents: fields.amountOffCents.optional(),
    minSubtotalCents: fields.minSubtotalCents.optional(),
    startsAt: fields.startsAt.optional(),
    expiresAt: fields.expiresAt.optional(),
    maxUses: fields.maxUses.optional(),
    maxUsesPerCustomer: fields.maxUsesPerCustomer.optional(),
    scope: fields.scope.optional(),
    productIds: fields.productIds.optional(),
    categoryIds: fields.categoryIds.optional(),
    automatic: fields.automatic.optional(),
    active: fields.active.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: 'provide at least one field to change' });

export type CouponCreateDto = z.infer<typeof couponCreateSchema>;
export type CouponUpdateDto = z.infer<typeof couponUpdateSchema>;
