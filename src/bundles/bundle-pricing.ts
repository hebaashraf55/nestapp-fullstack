import { BundleRecord } from './bundles.repository';

export interface PricedLine {
  productId: string;
  quantity: number;
  unitPriceCents: number;
}
export interface AppliedBundle {
  bundleId: string;
  name: string;
  /** How many complete sets were found in the cart. */
  times: number;
  discountPercent: number;
  savingsCents: number;
}

/**
 * Applies bundle discounts to a priced cart, on the server only. Bundles are tried from the largest
 * discount down (ties by id, so the result is deterministic); each complete set uses up its quantities,
 * so one unit is never discounted twice. Lines with problems should not be passed in.
 */
export function applyBundles(lines: PricedLine[], bundles: BundleRecord[]): AppliedBundle[] {
  const left = new Map<string, number>();
  const price = new Map<string, number>();
  for (const l of lines) {
    left.set(l.productId, (left.get(l.productId) ?? 0) + l.quantity);
    price.set(l.productId, l.unitPriceCents);
  }
  const applied: AppliedBundle[] = [];
  const ordered = [...bundles]
    .filter((b) => b.active && b.items.length > 0)
    .sort((a, b) => b.discountPercent - a.discountPercent || a.id.localeCompare(b.id));
  for (const bundle of ordered) {
    const times = Math.min(
      ...bundle.items.map((i) => Math.floor((left.get(i.productId) ?? 0) / i.quantity)),
    );
    if (!Number.isFinite(times) || times < 1) continue;
    const setCents = bundle.items.reduce(
      (sum, i) => sum + (price.get(i.productId) ?? 0) * i.quantity,
      0,
    );
    for (const i of bundle.items)
      left.set(i.productId, (left.get(i.productId) ?? 0) - i.quantity * times);
    applied.push({
      bundleId: bundle.id,
      name: bundle.name,
      times,
      discountPercent: bundle.discountPercent,
      savingsCents: Math.round((setCents * times * bundle.discountPercent) / 100),
    });
  }
  return applied;
}
