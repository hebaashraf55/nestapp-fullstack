import { z } from 'zod';
import { imageRef } from '../catalogue/dto';

const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, { error: 'must be a valid id' })
  .transform((s) => s.toLowerCase());

const items = z
  .array(z.strictObject({ productId: objectId, quantity: z.number().int().min(1).max(5) }))
  .min(2)
  .max(6)
  .refine((list) => new Set(list.map((i) => i.productId)).size === list.length, {
    error: 'each product may appear only once',
  });

export const bundleCreateSchema = z.strictObject({
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().max(500).default(''),
  image: imageRef.nullable().default(null),
  items,
  discountPercent: z.number().int().min(1).max(50),
  active: z.boolean().default(true),
});
export type BundleCreateDto = z.infer<typeof bundleCreateSchema>;

export const bundleUpdateSchema = z
  .strictObject({
    name: z.string().trim().min(3).max(80).optional(),
    description: z.string().trim().max(500).optional(),
    image: imageRef.nullable().optional(),
    items: items.optional(),
    discountPercent: z.number().int().min(1).max(50).optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: 'provide at least one field to change' });
export type BundleUpdateDto = z.infer<typeof bundleUpdateSchema>;

export const bundleListQuerySchema = z.strictObject({
  productId: objectId.optional(),
  all: z.enum(['true']).optional(),
});
export type BundleListQuery = z.infer<typeof bundleListQuerySchema>;
