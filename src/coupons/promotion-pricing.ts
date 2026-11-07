import { CouponRecord, isCouponUsable } from './coupons.repository';

export interface PricedLineForPromotion {
  productId: string;
  categoryId: string | null;
  lineTotalCents: number;
}

export type Evaluation =
  { eligible: true; discountCents: number } | { eligible: false; reason: string };

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Whether a promotion applies to a cart, and what it takes off. Pure and server-side only. The base is
 * the subtotal after set savings (the whole cart), or the in-scope lines capped at that amount; a fixed
 * amount never exceeds its base, so a total can never go below zero.
 */
export function evaluatePromotion(
  c: CouponRecord,
  lines: PricedLineForPromotion[],
  afterBundlesCents: number,
  usesByCustomer: number,
  now = Date.now(),
): Evaluation {
  if (!isCouponUsable(c, now)) return { eligible: false, reason: 'is not valid right now' };
  if (c.maxUses !== null && c.usedCount >= c.maxUses)
    return { eligible: false, reason: 'has been fully used' };
  if (c.maxUsesPerCustomer !== null && usesByCustomer >= c.maxUsesPerCustomer)
    return {
      eligible: false,
      reason: 'was already used the maximum number of times on your account',
    };
  if (afterBundlesCents < c.minSubtotalCents)
    return {
      eligible: false,
      reason: `needs a subtotal of ${money(c.minSubtotalCents)} (${money(c.minSubtotalCents - afterBundlesCents)} more)`,
    };
  const inScope =
    c.scope === 'ALL'
      ? lines
      : c.scope === 'PRODUCTS'
        ? lines.filter((l) => c.productIds.includes(l.productId))
        : lines.filter((l) => l.categoryId !== null && c.categoryIds.includes(l.categoryId));
  if (inScope.length === 0)
    return { eligible: false, reason: 'does not apply to anything in your cart' };
  const base =
    c.scope === 'ALL'
      ? afterBundlesCents
      : Math.min(
          afterBundlesCents,
          inScope.reduce((s, l) => s + l.lineTotalCents, 0),
        );
  const discountCents =
    c.type === 'FIXED'
      ? Math.min(c.amountOffCents ?? 0, base)
      : Math.round((base * c.discountPercent) / 100);
  return { eligible: true, discountCents };
}
