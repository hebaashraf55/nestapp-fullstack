import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  InMemoryBundlesRepository,
  InMemoryLooksRepository,
} from '../../test/helpers/in-memory-batch2.repositories';
import {
  InMemoryBrandsRepository,
  InMemoryCategoriesRepository,
  InMemoryProductsRepository,
} from '../../test/helpers/in-memory-catalogue.repositories';
import { slugify } from '../catalogue/slug';
import { SEED_PRODUCTS } from './catalogue-data';
import { seedCatalogue } from './seed-catalogue';
import { SEED_BUNDLES, SEED_LOOKS, seedCollections } from './seed-collections';

const setup = async () => {
  const products = new InMemoryProductsRepository();
  await seedCatalogue(new InMemoryBrandsRepository(), new InMemoryCategoriesRepository(), products);
  return {
    products,
    bundles: new InMemoryBundlesRepository(),
    looks: new InMemoryLooksRepository(),
  };
};

describe('seedCollections', () => {
  it('only names seeded products and existing photos', () => {
    const names = new Set(SEED_PRODUCTS.map((p) => p.name));
    for (const b of SEED_BUNDLES) for (const [n] of b.items) expect(names).toContain(n);
    for (const l of SEED_LOOKS) for (const n of l.products) expect(names).toContain(n);
    for (const img of [...SEED_BUNDLES.map((b) => b.image), ...SEED_LOOKS.map((l) => l.image)])
      expect(existsSync(join(__dirname, '../../web/public', img))).toBe(true);
  });

  it('creates synthetic bundles and list-only looks, then is idempotent', async () => {
    const r = await setup();
    expect(await seedCollections(r.products, r.bundles, r.looks)).toEqual({
      bundles: { created: 3, existing: 0 },
      looks: { created: 3, existing: 0 },
    });
    expect([...r.bundles.records.values()].every((b) => b.isDemo && b.active)).toBe(true);
    expect([...r.looks.records.values()].every((l) => l.spots.every((s) => s.x === null))).toBe(
      true,
    );
    const edited = [...r.bundles.records.values()][0]!;
    edited.discountPercent = 33; // an admin change survives a re-run
    expect(await seedCollections(r.products, r.bundles, r.looks)).toEqual({
      bundles: { created: 0, existing: 3 },
      looks: { created: 0, existing: 3 },
    });
    expect(r.bundles.records.get(edited.id)!.discountPercent).toBe(33);
  });

  it('skips a set whose product was deleted', async () => {
    const r = await setup();
    const gone = (await r.products.findBySlug(slugify('Beeswax Pillar Candles')))!;
    await r.products.delete(gone.id);
    const result = await seedCollections(r.products, r.bundles, r.looks);
    expect(result.bundles.created).toBe(2);
    expect(result.looks.created).toBe(2);
  });
});
