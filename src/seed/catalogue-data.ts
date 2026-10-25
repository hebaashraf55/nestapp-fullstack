/*
 * Synthetic demo catalogue. Every brand, category and product here is invented for the portfolio demo
 * (no real companies, trademarks or photographs). Images are original abstract SVGs in web/public/catalogue.
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
];

export const SEED_PRODUCTS: SeedProduct[] = [
  {
    name: 'Dune Stoneware Vase',
    description: 'A tall hand-glazed vase with a soft sand finish.',
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
    description: 'Four small cups with a speckled cream glaze and matching saucers.',
    priceCents: 5400,
    discountPercent: 0,
    stock: 9,
    category: 'Ceramics',
    brand: 'Sahra Studio',
  },
  {
    name: 'Amber Tumbler Pair',
    description: 'Two heavy tumblers in warm amber glass.',
    priceCents: 3200,
    discountPercent: 0,
    stock: 30,
    category: 'Glassware',
    brand: 'Noor Atelier',
  },
  {
    name: 'Reed Carafe',
    description: 'A slim blown-glass carafe with a cork stopper.',
    priceCents: 3900,
    discountPercent: 10,
    stock: 12,
    category: 'Glassware',
    brand: 'Sahra Studio',
  },
  {
    name: 'Tide Wine Glasses',
    description: 'A set of four stemless glasses with a gentle ripple.',
    priceCents: 6200,
    discountPercent: 0,
    stock: 0,
    category: 'Glassware',
    brand: 'Wadi Works',
  },
  {
    name: 'Saffron Linen Throw',
    description: 'A stonewashed linen throw in muted saffron.',
    priceCents: 8900,
    discountPercent: 20,
    stock: 7,
    category: 'Textiles',
    brand: 'Sahra Studio',
  },
  {
    name: 'Nile Cotton Cushion',
    description: 'A woven cotton cushion cover with a quiet river pattern.',
    priceCents: 2800,
    discountPercent: 0,
    stock: 40,
    category: 'Textiles',
    brand: 'Wadi Works',
  },
  {
    name: 'Sandstone Table Runner',
    description: 'A long table runner in natural undyed cotton.',
    priceCents: 3500,
    discountPercent: 0,
    stock: 18,
    category: 'Textiles',
    brand: 'Noor Atelier',
  },
  {
    name: 'Lantern Table Lamp',
    description: 'A ceramic-based lamp with a warm linen shade.',
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
];

/** Image path for a seeded product, matching the generated SVG files. */
export const imagePathFor = (slug: string) => `/catalogue/${slug}.svg`;
