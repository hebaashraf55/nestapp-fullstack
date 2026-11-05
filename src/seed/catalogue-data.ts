/*
 * Synthetic demo catalogue. Every brand, category and product here is invented for the portfolio demo
 * (no real companies or trademarks). Product images are free-licence Unsplash photos stored in
 * web/public/catalogue; the photographers are credited in web/public/catalogue/CREDITS.md and on the About page.
 */
export interface SeedTaxonomy {
  name: string;
}
export interface SeedProduct {
  name: string;
  description: string;
  priceCents: number;
  discountPercent: number;
  stock: number;
  category: string;
  brand: string;
}

export const SEED_BRANDS: SeedTaxonomy[] = [
  { name: 'Noor Atelier' },
  { name: 'Sahra Studio' },
  { name: 'Wadi Works' },
];

export const SEED_CATEGORIES: SeedTaxonomy[] = [
  { name: 'Ceramics' },
  { name: 'Glassware' },
  { name: 'Textiles' },
  { name: 'Lighting' },
  { name: 'Furniture' },
  { name: 'Kitchen' },
  { name: 'Decor' },
];

export const SEED_PRODUCTS: SeedProduct[] = [
  {
    name: 'Dune Stoneware Vase',
    description: 'A round hand-glazed vase with a soft cream finish.',
    priceCents: 7800,
    discountPercent: 0,
    stock: 14,
    category: 'Ceramics',
    brand: 'Noor Atelier',
  },
  {
    name: 'Oasis Serving Bowl',
    description: 'A wide shallow bowl in deep green glaze, made for sharing.',
    priceCents: 4600,
    discountPercent: 15,
    stock: 22,
    category: 'Ceramics',
    brand: 'Wadi Works',
  },
  {
    name: 'Mirage Espresso Set',
    description: 'White porcelain cups with matching saucers, sold as a set of four.',
    priceCents: 5400,
    discountPercent: 0,
    stock: 9,
    category: 'Ceramics',
    brand: 'Sahra Studio',
  },
  {
    name: 'Amber Tumbler Pair',
    description: 'Two ribbed tumblers in smoky amber and sea-green glass.',
    priceCents: 3200,
    discountPercent: 0,
    stock: 30,
    category: 'Glassware',
    brand: 'Noor Atelier',
  },
  {
    name: 'Reed Carafe',
    description: 'A slim blown-glass carafe with a glass stopper.',
    priceCents: 3900,
    discountPercent: 10,
    stock: 12,
    category: 'Glassware',
    brand: 'Sahra Studio',
  },
  {
    name: 'Tide Wine Glasses',
    description: 'A set of four fine-rimmed wine glasses in clear crystal.',
    priceCents: 6200,
    discountPercent: 0,
    stock: 0,
    category: 'Glassware',
    brand: 'Wadi Works',
  },
  {
    name: 'Saffron Linen Throw',
    description: 'A chunky knitted throw in muted saffron.',
    priceCents: 8900,
    discountPercent: 20,
    stock: 7,
    category: 'Textiles',
    brand: 'Sahra Studio',
  },
  {
    name: 'Nile Cotton Cushion',
    description: 'A woven cotton cushion cover in sand and sage.',
    priceCents: 2800,
    discountPercent: 0,
    stock: 40,
    category: 'Textiles',
    brand: 'Wadi Works',
  },
  {
    name: 'Sandstone Table Runner',
    description: 'A long hemstitched table runner in natural undyed linen.',
    priceCents: 3500,
    discountPercent: 0,
    stock: 18,
    category: 'Textiles',
    brand: 'Noor Atelier',
  },
  {
    name: 'Lantern Table Lamp',
    description: 'A walnut-stem lamp with a warm linen shade.',
    priceCents: 12900,
    discountPercent: 0,
    stock: 5,
    category: 'Lighting',
    brand: 'Noor Atelier',
  },
  {
    name: 'Crescent Wall Light',
    description: 'A brushed-brass crescent sconce with a soft glow.',
    priceCents: 14500,
    discountPercent: 25,
    stock: 6,
    category: 'Lighting',
    brand: 'Sahra Studio',
  },
  {
    name: 'Ember Pillar Candle Holder',
    description: 'A weighty candle holder in hand-turned dark clay.',
    priceCents: 2400,
    discountPercent: 0,
    stock: 25,
    category: 'Lighting',
    brand: 'Wadi Works',
  },
  {
    name: 'Fjord Nesting Side Tables',
    description: 'A set of three nesting side tables in oiled walnut-toned wood.',
    priceCents: 18900,
    discountPercent: 0,
    stock: 6,
    category: 'Furniture',
    brand: 'Wadi Works',
  },
  {
    name: 'Dune Boucl\u00e9 Lounge Chair',
    description: 'A rounded swivel lounge chair upholstered in soft ivory boucl\u00e9.',
    priceCents: 64000,
    discountPercent: 15,
    stock: 3,
    category: 'Furniture',
    brand: 'Noor Atelier',
  },
  {
    name: 'Birch Floating Shelf',
    description: 'A 90 cm floating shelf in pale birch plywood with hidden fixings.',
    priceCents: 7400,
    discountPercent: 0,
    stock: 15,
    category: 'Furniture',
    brand: 'Sahra Studio',
  },
  {
    name: 'Woven Rattan Stool',
    description: 'A low stool with a hand-woven rattan seat and bent cane legs.',
    priceCents: 11500,
    discountPercent: 0,
    stock: 0,
    category: 'Furniture',
    brand: 'Wadi Works',
  },
  {
    name: 'Olive Wood Serving Board',
    description: 'A paddle board carved from a single piece of olive wood.',
    priceCents: 4200,
    discountPercent: 0,
    stock: 20,
    category: 'Kitchen',
    brand: 'Sahra Studio',
  },
  {
    name: 'Speckled Stoneware Mug Pair',
    description: 'Two hand-thrown mugs with a speckled oat glaze.',
    priceCents: 3800,
    discountPercent: 10,
    stock: 24,
    category: 'Kitchen',
    brand: 'Noor Atelier',
  },
  {
    name: 'Ceramic Pour-Over Set',
    description: 'A matte ceramic dripper with a heat-proof glass server.',
    priceCents: 5600,
    discountPercent: 0,
    stock: 10,
    category: 'Kitchen',
    brand: 'Wadi Works',
  },
  {
    name: 'White & Brass Cutlery Set',
    description: 'A 16-piece set of brushed brass cutlery with white handles.',
    priceCents: 9800,
    discountPercent: 20,
    stock: 8,
    category: 'Kitchen',
    brand: 'Sahra Studio',
  },
  {
    name: 'Seagrass Lidded Baskets',
    description: 'Two lidded baskets woven from natural seagrass.',
    priceCents: 6900,
    discountPercent: 0,
    stock: 12,
    category: 'Decor',
    brand: 'Wadi Works',
  },
  {
    name: 'Round Oak Wall Mirror',
    description: 'A 70 cm round mirror in a slim natural oak frame.',
    priceCents: 15900,
    discountPercent: 0,
    stock: 4,
    category: 'Decor',
    brand: 'Noor Atelier',
  },
  {
    name: 'Stone Sphere Bookend',
    description: 'A solid travertine sphere that keeps a row of books upright.',
    priceCents: 3400,
    discountPercent: 0,
    stock: 18,
    category: 'Decor',
    brand: 'Sahra Studio',
  },
  {
    name: 'Walnut Serving Tray',
    description: 'A shallow walnut tray with cut-out handles for breakfast in bed.',
    priceCents: 5200,
    discountPercent: 0,
    stock: 14,
    category: 'Decor',
    brand: 'Noor Atelier',
  },
];

/** Image path for a seeded product, matching the photo files in web/public/catalogue. */
export const imagePathFor = (slug: string) => `/catalogue/${slug}.jpg`;

/** The abstract SVG an earlier seed used. Still served so old order snapshots keep their image. */
export const legacyImagePathFor = (slug: string) => `/catalogue/${slug}.svg`;
