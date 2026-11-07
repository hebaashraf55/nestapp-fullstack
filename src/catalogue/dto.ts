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
export const MAX_STOCK = 1_000_000;
const stock = z.number().int().min(0).max(MAX_STOCK);

const specText = (max: number) => z.string().trim().min(1).max(max);
export const specsSchema = z.strictObject({
  material: specText(120).optional(),
  color: specText(120).optional(),
  dimensions: specText(120).optional(),
  care: specText(200).optional(),
});

/** A short key shared by the variants of one product, for example "linen-throw". */
const variantGroup = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { error: 'use lower-case letters, digits and dashes' })
  .min(2)
  .max(60);
const variantLabel = z.string().trim().min(1).max(40);

export const productCreateSchema = z.strictObject({
  name: name(3, 100),
  description: z.string().trim().max(2000).default(''),
  images: z.array(imageRef).min(1).max(6),
  priceCents: money,
  discountPercent: discount.default(0),
  stock,
  categoryId: objectId,
  brandId: objectId,
  specs: specsSchema.default({}),
  featured: z.boolean().default(false),
  variantGroup: variantGroup.nullable().default(null),
  variantLabel: variantLabel.nullable().default(null),
});

/** A relative stock change (receive goods: positive; write off: negative). Applied atomically. */
export const stockAdjustSchema = z.strictObject({
  change: z
    .number()
    .int()
    .min(-MAX_STOCK)
    .max(MAX_STOCK)
    .refine((v) => v !== 0, { error: 'must not be zero' }),
});
export type StockAdjustDto = z.infer<typeof stockAdjustSchema>;

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
    specs: specsSchema.optional(),
    featured: z.boolean().optional(),
    variantGroup: variantGroup.nullable().optional(),
    variantLabel: variantLabel.nullable().optional(),
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
    featured: z.enum(['true']).optional(),
    onSale: z.enum(['true']).optional(),
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

/** `ids=a,b,c`: two to four distinct product ids. */
export const compareQuerySchema = z.strictObject({
  ids: z
    .string()
    .transform((v) => [
      ...new Set(
        v
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      ),
    ])
    .pipe(
      z
        .array(objectId)
        .min(2, { error: 'compare at least two products' })
        .max(4, { error: 'compare at most four products' }),
    ),
});
export type CompareQueryDto = z.infer<typeof compareQuerySchema>;

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
