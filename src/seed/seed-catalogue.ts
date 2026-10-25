import { computeSalePriceCents } from '../catalogue/catalogue.services';
import {
  BrandsRepository,
  CategoriesRepository,
  ProductsRepository,
  TaxonomyRecord,
  TaxonomyRepository,
} from '../catalogue/catalogue.repositories';
import { slugify } from '../catalogue/slug';
import {
  imagePathFor,
  SEED_BRANDS,
  SEED_CATEGORIES,
  SEED_PRODUCTS,
  SeedTaxonomy,
} from './catalogue-data';

export interface CatalogueSeedResult {
  brands: { created: number; existing: number };
  categories: { created: number; existing: number };
  products: { created: number; existing: number };
}

const SEEDER = 'seed';

async function seedTaxonomy(
  repo: TaxonomyRepository,
  items: SeedTaxonomy[],
): Promise<{ byName: Map<string, TaxonomyRecord>; created: number; existing: number }> {
  const byName = new Map<string, TaxonomyRecord>();
  let created = 0;
  let existing = 0;
  for (const item of items) {
    const slug = slugify(item.name);
    const found = await repo.findBySlug(slug);
    if (found) {
      existing++;
      byName.set(item.name, found);
    } else {
      created++;
      byName.set(
        item.name,
        await repo.create({ name: item.name, slug, image: null, isDemo: true, createdBy: SEEDER }),
      );
    }
  }
  return { byName, created, existing };
}

/**
 * Idempotent: records are matched by slug and an existing one is left untouched, so re-running never
 * duplicates data or overwrites an admin's edits. Every seeded record is flagged `isDemo` (synthetic).
 */
export async function seedCatalogue(
  brands: BrandsRepository,
  categories: CategoriesRepository,
  products: ProductsRepository,
): Promise<CatalogueSeedResult> {
  const b = await seedTaxonomy(brands, SEED_BRANDS);
  const c = await seedTaxonomy(categories, SEED_CATEGORIES);
  let created = 0;
  let existing = 0;
  for (const p of SEED_PRODUCTS) {
    const slug = slugify(p.name);
    if (await products.findBySlug(slug)) {
      existing++;
      continue;
    }
    const category = c.byName.get(p.category);
    const brand = b.byName.get(p.brand);
    if (!category || !brand)
      throw new Error(`Seed data references an unknown taxonomy for ${p.name}`);
    await products.create({
      name: p.name,
      slug,
      description: p.description,
      images: [imagePathFor(slug)],
      priceCents: p.priceCents,
      discountPercent: p.discountPercent,
      salePriceCents: computeSalePriceCents(p.priceCents, p.discountPercent),
      stock: p.stock,
      categoryId: category.id,
      brandId: brand.id,
      isDemo: true,
      createdBy: SEEDER,
    });
    created++;
  }
  return {
    brands: { created: b.created, existing: b.existing },
    categories: { created: c.created, existing: c.existing },
    products: { created, existing },
  };
}
