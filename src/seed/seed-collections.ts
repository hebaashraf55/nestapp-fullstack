import { BundlesRepository } from '../bundles/bundles.repository';
import { ProductsRepository } from '../catalogue/catalogue.repositories';
import { slugify } from '../catalogue/slug';
import { LooksRepository } from '../looks/looks.repository';

/** Sample bundles and looks built from the seeded catalogue. Synthetic, like every seeded record. */
export const SEED_BUNDLES = [
  {
    name: 'Coffee Ritual Set',
    description: 'Pour-over and a pair of speckled mugs for slow mornings.',
    image: '/catalogue/ceramic-pour-over-set.jpg',
    discountPercent: 10,
    items: [
      ['Ceramic Pour-Over Set', 1],
      ['Speckled Stoneware Mug Pair', 1],
    ],
  },
  {
    name: 'Supper Table Set',
    description: 'Plates, linen napkins and ribbed glasses for a table of four.',
    image: '/catalogue/fjell-stoneware-dinner-plates.jpg',
    discountPercent: 15,
    items: [
      ['Fjell Stoneware Dinner Plates', 1],
      ['Linen Dinner Napkins', 1],
      ['Clear Ribbed Water Glasses', 1],
    ],
  },
  {
    name: 'Bath Comfort Set',
    description: 'Two waffle towels and beeswax candles for an unhurried evening.',
    image: '/catalogue/waffle-cotton-bath-towel.jpg',
    discountPercent: 10,
    items: [
      ['Waffle Cotton Bath Towel', 2],
      ['Beeswax Pillar Candles', 1],
    ],
  },
] as const;

export const SEED_LOOKS = [
  {
    title: 'Slow Living Room',
    description: 'Warm wood, soft bouclé and a low lamp: a corner made for reading.',
    image: '/catalogue/live-edge-coffee-table.jpg',
    products: [
      'Live Edge Coffee Table',
      'Dune Bouclé Lounge Chair',
      'Arc Floor Lamp',
      'Hearth Wool Shag Rug',
      'Dried Pampas Bundle',
    ],
  },
  {
    title: 'Set for Supper',
    description: 'Stoneware, linen and candlelight for long dinners.',
    image: '/catalogue/fjell-stoneware-dinner-plates.jpg',
    products: [
      'Fjell Stoneware Dinner Plates',
      'Linen Dinner Napkins',
      'Clear Ribbed Water Glasses',
      'Oak Dining Chair',
      'Beeswax Pillar Candles',
    ],
  },
  {
    title: 'Morning Kitchen',
    description: 'Cast iron, beech and glass: everyday tools that look good out on the counter.',
    image: '/catalogue/enamel-cast-iron-pot.jpg',
    products: [
      'Enamel Cast Iron Pot',
      'Beech Spoon Pair',
      'Linen Kitchen Apron',
      'Granite Mortar & Pestle',
      'Pantry Glass Storage Jars',
    ],
  },
] as const;

export interface CollectionsSeedResult {
  bundles: { created: number; existing: number };
  looks: { created: number; existing: number };
}

/**
 * Idempotent, like the catalogue seed: matched by slug, never overwritten, never deleted. A bundle or
 * look is skipped when one of its products is missing (for example deleted by an admin).
 */
export async function seedCollections(
  products: ProductsRepository,
  bundles: BundlesRepository,
  looks: LooksRepository,
): Promise<CollectionsSeedResult> {
  const idOf = async (name: string) => (await products.findBySlug(slugify(name)))?.id ?? null;
  const result: CollectionsSeedResult = {
    bundles: { created: 0, existing: 0 },
    looks: { created: 0, existing: 0 },
  };
  for (const b of SEED_BUNDLES) {
    const slug = slugify(b.name);
    if (await bundles.findBySlug(slug)) {
      result.bundles.existing++;
      continue;
    }
    const ids = await Promise.all(b.items.map(([name]) => idOf(name)));
    if (ids.some((i) => i === null)) continue;
    await bundles.create({
      name: b.name,
      slug,
      description: b.description,
      image: b.image,
      items: b.items.map(([, quantity], i) => ({ productId: ids[i] as string, quantity })),
      discountPercent: b.discountPercent,
      active: true,
      isDemo: true,
      createdBy: 'seed',
    });
    result.bundles.created++;
  }
  for (const l of SEED_LOOKS) {
    const slug = slugify(l.title);
    if (await looks.findBySlug(slug)) {
      result.looks.existing++;
      continue;
    }
    const ids = await Promise.all(l.products.map(idOf));
    if (ids.some((i) => i === null)) continue;
    await looks.create({
      title: l.title,
      slug,
      description: l.description,
      image: l.image,
      // List-only: the photo shows the room's mood, not each piece in place, so no spots are invented.
      spots: (ids as string[]).map((productId) => ({ productId, x: null, y: null })),
      active: true,
      isDemo: true,
      createdBy: 'seed',
    });
    result.looks.created++;
  }
  return result;
}
