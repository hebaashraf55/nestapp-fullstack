import { z } from 'zod';
import { imageRef } from '../catalogue/dto';

const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, { error: 'must be a valid id' })
  .transform((s) => s.toLowerCase());
const percent = z.number().min(0).max(100).nullable().default(null);

const spots = z
  .array(z.strictObject({ productId: objectId, x: percent, y: percent }))
  .min(1)
  .max(8)
  .refine((l) => new Set(l.map((s) => s.productId)).size === l.length, {
    error: 'each product may appear only once',
  })
  .refine((l) => l.every((s) => (s.x === null) === (s.y === null)), {
    error: 'give both x and y, or neither',
  });

export const lookCreateSchema = z.strictObject({
  title: z.string().trim().min(3).max(80),
  description: z.string().trim().max(500).default(''),
  image: imageRef,
  spots,
  active: z.boolean().default(true),
});
export type LookCreateDto = z.infer<typeof lookCreateSchema>;

export const lookUpdateSchema = z
  .strictObject({
    title: z.string().trim().min(3).max(80).optional(),
    description: z.string().trim().max(500).optional(),
    image: imageRef.optional(),
    spots: spots.optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: 'provide at least one field to change' });
export type LookUpdateDto = z.infer<typeof lookUpdateSchema>;

export const lookListQuerySchema = z.strictObject({
  productId: objectId.optional(),
  all: z.enum(['true']).optional(),
});
export type LookListQuery = z.infer<typeof lookListQuerySchema>;
