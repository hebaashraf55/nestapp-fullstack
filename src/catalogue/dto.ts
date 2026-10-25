import { BadRequestException, PipeTransform } from '@nestjs/common';
import { z } from 'zod';

/**
 * An image is either an https URL (no credentials, no fragments) or a site asset path such as
 * `/catalogue/vase.svg`. Anything else (http:, data:, javascript:, protocol-relative, `..`) is refused.
 */
export const imageRef = z
  .string()
  .max(500)
  .refine(
    (value) => {
      if (value.startsWith('/')) {
        return (
          /^\/[A-Za-z0-9][A-Za-z0-9_\-./]{0,300}\.(svg|png|jpe?g|webp|avif)$/.test(value) &&
          !value.includes('..') &&
          !value.includes('//')
        );
      }
      try {
        const url = new URL(value);
        return (
          url.protocol === 'https:' && url.username === '' && url.password === '' && url.hash === ''
        );
      } catch {
        return false;
      }
    },
    { error: 'must be an https URL or an asset path like /catalogue/name.svg' },
  );

const name = (min: number, max: number) => z.string().trim().min(min).max(max);
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, { error: 'must be a valid id' });

export const taxonomyCreateSchema = z.strictObject({
  name: name(2, 60),
  image: imageRef.optional(),
});
export const taxonomyUpdateSchema = z
  .strictObject({ name: name(2, 60).optional(), image: imageRef.nullable().optional() })
  .refine((v) => Object.keys(v).length > 0, { error: 'provide at least one field to change' });

const money = z.number().int().min(1).max(100_000_00);
const discount = z.number().int().min(0).max(90);
const stock = z.number().int().min(0).max(1_000_000);

export const productCreateSchema = z.strictObject({
  name: name(3, 100),
  description: z.string().trim().max(2000).default(''),
  images: z.array(imageRef).min(1).max(6),
  priceCents: money,
  discountPercent: discount.default(0),
  stock,
  categoryId: objectId,
  brandId: objectId,
});

export const productUpdateSchema = z
  .strictObject({
    name: name(3, 100).optional(),
    description: z.string().trim().max(2000).optional(),
    images: z.array(imageRef).min(1).max(6).optional(),
    priceCents: money.optional(),
    discountPercent: discount.optional(),
    stock: stock.optional(),
    categoryId: objectId.optional(),
    brandId: objectId.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: 'provide at least one field to change' });

const text = z.string().trim().min(1).max(80);
export const productQuerySchema = z
  .strictObject({
    q: text.optional(),
    categoryId: objectId.optional(),
    brandId: objectId.optional(),
    minPrice: z.coerce.number().int().min(0).max(100_000_00).optional(),
    maxPrice: z.coerce.number().int().min(0).max(100_000_00).optional(),
    inStock: z.enum(['true', 'false']).optional(),
    sort: z.enum(['newest', 'price-asc', 'price-desc', 'name']).default('newest'),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(12),
  })
  .refine((q) => q.minPrice === undefined || q.maxPrice === undefined || q.minPrice <= q.maxPrice, {
    error: 'minPrice must not exceed maxPrice',
    path: ['minPrice'],
  });

export type TaxonomyCreateDto = z.infer<typeof taxonomyCreateSchema>;
export type TaxonomyUpdateDto = z.infer<typeof taxonomyUpdateSchema>;
export type ProductCreateDto = z.infer<typeof productCreateSchema>;
export type ProductUpdateDto = z.infer<typeof productUpdateSchema>;
export type ProductQueryDto = z.infer<typeof productQuerySchema>;

/** Validates and normalizes a body or query. Error details name the field, never echo its value. */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw new BadRequestException(
        result.error.issues.map((issue) => ({
          field: issue.path.map(String).join('.') || '(request)',
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}
