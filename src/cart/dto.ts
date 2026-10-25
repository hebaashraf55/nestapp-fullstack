import { z } from 'zod';

export const MAX_QUANTITY = 99;
export const MAX_LINES = 50;

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, { error: 'must be a valid id' });

/** Only a product reference and a quantity are accepted. A price, total or user id is an unknown field. */
export const addToCartSchema = z.strictObject({
  productId: objectId,
  quantity: z.number().int().min(1).max(MAX_QUANTITY),
});

/** Quantity 0 removes the line (kept from the original API). */
export const updateCartSchema = z.strictObject({
  quantity: z.number().int().min(0).max(MAX_QUANTITY),
});

export const applyCouponSchema = z.strictObject({
  code: z.string().trim().toUpperCase().min(1).max(64),
});

export type AddToCartDto = z.infer<typeof addToCartSchema>;
export type UpdateCartDto = z.infer<typeof updateCartSchema>;
export type ApplyCouponDto = z.infer<typeof applyCouponSchema>;
