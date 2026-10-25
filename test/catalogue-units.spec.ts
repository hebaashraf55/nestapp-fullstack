import { BadRequestException } from '@nestjs/common';
import { computeSalePriceCents } from '../src/catalogue/catalogue.services';
import {
  imageRef,
  productCreateSchema,
  productQuerySchema,
  productUpdateSchema,
  taxonomyUpdateSchema,
} from '../src/catalogue/dto';
import { ParseObjectIdPipe } from '../src/catalogue/object-id.pipe';
import { slugify, uniqueSlug } from '../src/catalogue/slug';

const oid = 'a'.repeat(24);
const valid = {
  name: 'Clay Vase',
  images: ['/catalogue/clay-vase.svg'],
  priceCents: 4500,
  stock: 3,
  categoryId: oid,
  brandId: oid,
};

describe('slug', () => {
  it('lowercases, strips accents and punctuation', () => {
    expect(slugify('  Crème Brûlée Bowl!! ')).toBe('creme-brulee-bowl');
  });
  it('falls back for names with no latin letters', () => {
    expect(slugify('مزهرية')).toBe('item');
  });
  it('caps the length without a trailing dash', () => {
    const s = slugify(`${'a'.repeat(59)} bbbbb`);
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith('-')).toBe(false);
  });
  it('finds the first free suffix', async () => {
    const taken = new Set(['vase', 'vase-2']);
    expect(await uniqueSlug('Vase', async (s) => taken.has(s))).toBe('vase-3');
  });
});

describe('ParseObjectIdPipe', () => {
  const pipe = new ParseObjectIdPipe();
  it('accepts and lower-cases a valid id', () => {
    expect(pipe.transform('A'.repeat(24))).toBe('a'.repeat(24));
  });
  it.each(['', 'abc', 'g'.repeat(24), `${oid}0`, '{"$ne":null}'])('rejects %j', (bad) => {
    expect(() => pipe.transform(bad)).toThrow(BadRequestException);
  });
});

describe('image references', () => {
  it.each(['/catalogue/a.svg', 'https://cdn.example.com/a.png', 'https://cdn.example.com/p?x=1'])(
    'accepts %s',
    (v) => expect(imageRef.safeParse(v).success).toBe(true),
  );
  it.each([
    'javascript:alert(1)',
    'data:image/svg+xml;base64,AAAA',
    'http://example.com/a.png',
    '//evil.example.com/a.png',
    '/catalogue/../secret.png',
    '/a//b.png',
    '/catalogue/a.html',
    'https://user:pw@example.com/a.png',
    'https://example.com/a.png#frag',
    'not a url',
    '',
  ])('rejects %j', (v) => expect(imageRef.safeParse(v).success).toBe(false));
});

describe('product schemas', () => {
  it('applies defaults', () => {
    const r = productCreateSchema.parse(valid);
    expect(r.discountPercent).toBe(0);
    expect(r.description).toBe('');
  });
  it.each([
    ['unknown/privileged field', { isDemo: true }],
    ['client sale price', { salePriceCents: 1 }],
    ['float price', { priceCents: 10.5 }],
    ['zero price', { priceCents: 0 }],
    ['negative stock', { stock: -1 }],
    ['discount over 90', { discountPercent: 91 }],
    ['no images', { images: [] }],
    ['seven images', { images: Array(7).fill('/catalogue/a.svg') }],
    ['bad category id', { categoryId: 'nope' }],
    ['price as string', { priceCents: '100' }],
  ])('rejects %s', (_label, patch) => {
    expect(productCreateSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
  it('requires at least one field to update', () => {
    expect(productUpdateSchema.safeParse({}).success).toBe(false);
    expect(taxonomyUpdateSchema.safeParse({}).success).toBe(false);
    expect(productUpdateSchema.safeParse({ stock: 0 }).success).toBe(true);
  });
});

describe('product query schema', () => {
  it('defaults and coerces', () => {
    expect(productQuerySchema.parse({ page: '2', minPrice: '100' })).toMatchObject({
      page: 2,
      limit: 12,
      sort: 'newest',
      minPrice: 100,
    });
  });
  it.each([
    { limit: '51' },
    { page: '0' },
    { sort: 'cheapest' },
    { minPrice: '10', maxPrice: '5' },
    { inStock: 'yes' },
    { q: 'x'.repeat(81) },
    { minPrice: '1.5' },
    { categoryId: '{"$ne":1}' },
  ])('rejects %j', (q) => expect(productQuerySchema.safeParse(q).success).toBe(false));
});

describe('computeSalePriceCents', () => {
  it.each([
    [10000, 0, 10000],
    [10000, 25, 7500],
    [999, 10, 899],
    [1, 90, 1],
  ])('%i cents at %i%% -> %i', (price, pct, expected) => {
    expect(computeSalePriceCents(price, pct)).toBe(expected);
  });
});
