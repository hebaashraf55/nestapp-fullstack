import {
  InMemoryBrandsRepository,
  InMemoryCategoriesRepository,
  InMemoryProductsRepository,
} from '../../test/helpers/in-memory-catalogue.repositories';
import { computeSalePriceCents } from '../catalogue/catalogue.services';
import { imageRef } from '../catalogue/dto';
import { SEED_BRANDS, SEED_CATEGORIES, SEED_PRODUCTS } from './catalogue-data';
import { seedCatalogue } from './seed-catalogue';

const repos = () => ({
  brands: new InMemoryBrandsRepository(),
  categories: new InMemoryCategoriesRepository(),
  products: new InMemoryProductsRepository(),
});

describe('seedCatalogue', () => {
  it('creates synthetic, demo-flagged records with consistent prices', async () => {
    const r = repos();
    const result = await seedCatalogue(r.brands, r.categories, r.products);
    expect(result.products.created).toBe(SEED_PRODUCTS.length);
    expect(result.brands.created).toBe(SEED_BRANDS.length);
    expect(result.categories.created).toBe(SEED_CATEGORIES.length);
    for (const p of r.products.records.values()) {
      expect(p.isDemo).toBe(true);
      expect(p.salePriceCents).toBe(computeSalePriceCents(p.priceCents, p.discountPercent));
      expect(r.brands.records.has(p.brandId)).toBe(true);
      expect(r.categories.records.has(p.categoryId)).toBe(true);
      expect(p.images.every((i) => imageRef.safeParse(i).success)).toBe(true);
    }
    for (const x of [...r.brands.records.values(), ...r.categories.records.values()]) {
      expect(x.isDemo).toBe(true);
    }
  });

  it('is idempotent and does not overwrite an admin edit', async () => {
    const r = repos();
    await seedCatalogue(r.brands, r.categories, r.products);
    const first = [...r.products.records.values()][0]!;
    await r.products.update(first.id, { stock: 999 });
    const again = await seedCatalogue(r.brands, r.categories, r.products);
    expect(again.products).toEqual({ created: 0, existing: SEED_PRODUCTS.length });
    expect(r.products.records.size).toBe(SEED_PRODUCTS.length);
    expect(r.products.records.get(first.id)!.stock).toBe(999);
  });

  it('has unique product names and an out-of-stock example', () => {
    expect(new Set(SEED_PRODUCTS.map((p) => p.name)).size).toBe(SEED_PRODUCTS.length);
    expect(SEED_PRODUCTS.some((p) => p.stock === 0)).toBe(true);
  });
});
