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
  legacyImagePathFor,
  SEED_BRANDS,
  SEED_CATEGORIES,
  SEED_PRODUCTS,
  SeedTaxonomy,
} from './catalogue-data';

export interface CatalogueSeedResult {
  brands: { created: number; existing: number };
  categories: { created: number; existing: number };
  products: { created: number; existing: number; imagesUpdated: number; specsAdded: number };
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
 * duplicates data or overwrites an admin's edits. The one exception: a seeded product whose images are
 * still exactly the old default SVG is switched to its photo (an admin-chosen image is never replaced). Every seeded record is flagged `isDemo` (synthetic).
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
  let imagesUpdated = 0;
  let specsAdded = 0;
  for (const p of SEED_PRODUCTS) {
    const slug = slugify(p.name);
    const found = await products.findBySlug(slug);
    if (found) {
      existing++;
      if (found.images.length === 1 && found.images[0] === legacyImagePathFor(slug)) {
        await products.update(found.id, { images: [imagePathFor(slug)] });
        imagesUpdated++;
      }
      // Seeded products created before specifications existed get them once; anything an admin
      // already set (specs or the featured flag) is left alone.
      if (found.createdBy === SEEDER && Object.keys(found.specs ?? {}).length === 0) {
        await products.update(found.id, {
          specs: p.specs,
          ...(found.featured ? {} : { featured: p.featured === true }),
        });
        specsAdded++;
      }
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
      specs: p.specs,
      featured: p.featured === true,
      isDemo: true,
      createdBy: SEEDER,
    });
    created++;
  }
  return {
    brands: { created: b.created, existing: b.existing },
    categories: { created: c.created, existing: c.existing },
    products: { created, existing, imagesUpdated, specsAdded },
  };
}
