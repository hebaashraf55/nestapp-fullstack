export type DiscountType = 'PERCENT' | 'FIXED';
export type PromotionScope = 'ALL' | 'PRODUCTS' | 'CATEGORIES';

export interface CouponRecord {
  id: string;
  /** The code customers type; for an automatic promotion it is also its name in the cart. */
  code: string;
  type: DiscountType;
  /** PERCENT only (1–90). 0 for a fixed-amount coupon. */
  discountPercent: number;
  /** FIXED only: amount off in cents, never more than the eligible subtotal. */
  amountOffCents: number | null;
  /** Subtotal after set savings that the cart must reach. 0 = no minimum. */
  minSubtotalCents: number;
  startsAt: Date | null;
  expiresAt: Date;
  /** Total uses across all customers (null = unlimited) and how many are taken. */
  maxUses: number | null;
  usedCount: number;
  maxUsesPerCustomer: number | null;
  scope: PromotionScope;
  productIds: string[];
  categoryIds: string[];
  /** Applied without a code whenever the cart qualifies. */
  automatic: boolean;
  /** False when an admin has paused the coupon. */
  active: boolean;
  isDemo: boolean;
  createdBy: string;
  createdAt: Date;
}

const PROMOTION_DEFAULTS = {
  type: 'PERCENT' as DiscountType,
  amountOffCents: null,
  minSubtotalCents: 0,
  startsAt: null,
  maxUses: null,
  usedCount: 0,
  maxUsesPerCustomer: null,
  scope: 'ALL' as PromotionScope,
  productIds: [] as string[],
  categoryIds: [] as string[],
  automatic: false,
};
type PromotionFields = keyof typeof PROMOTION_DEFAULTS;

/** The newer promotion fields are optional when creating: older callers create plain percentage codes. */
export type NewCoupon = Omit<CouponRecord, 'id' | 'createdAt' | PromotionFields> &
  Partial<Pick<CouponRecord, PromotionFields>>;
export type CouponPatch = Partial<
  Omit<CouponRecord, 'id' | 'code' | 'createdAt' | 'createdBy' | 'isDemo' | 'usedCount'>
>;

/** Fills in defaults for documents saved before promotions existed. */
export const withPromotionDefaults = <T extends object>(c: T): T & typeof PROMOTION_DEFAULTS =>
  ({
    ...PROMOTION_DEFAULTS,
    ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)),
  }) as T & typeof PROMOTION_DEFAULTS;

/** Active, started and not expired. Usage limits and the cart's contents are checked separately. */
export const isCouponUsable = (c: CouponRecord, now = Date.now()): boolean =>
  c.active && c.expiresAt.getTime() > now && (c.startsAt === null || c.startsAt.getTime() <= now);

export type ClaimResult = 'ok' | 'used-up' | 'customer-limit';

/** Persistence port. Codes are stored upper-case; `create` throws DuplicateKeyError on a repeated code. */
export abstract class CouponsRepository {
  abstract findById(id: string): Promise<CouponRecord | null>;
  abstract findByCode(code: string): Promise<CouponRecord | null>;
  abstract findAll(): Promise<CouponRecord[]>;
  /** Active automatic promotions (dates and limits are checked by the caller). */
  abstract findAutomatic(): Promise<CouponRecord[]>;
  abstract create(record: NewCoupon): Promise<CouponRecord>;
  abstract update(id: string, patch: CouponPatch): Promise<CouponRecord | null>;
  abstract delete(id: string): Promise<boolean>;
  /** How many orders this customer currently holds with this coupon. */
  abstract usesBy(couponId: string, ownerId: string): Promise<number>;
  /**
   * Takes one use atomically: the global count and the customer's count are each compare-and-set, so
   * two orders racing for the last use cannot both get it.
   */
  abstract claim(
    couponId: string,
    ownerId: string,
    perCustomer: number | null,
  ): Promise<ClaimResult>;
  /** Gives a use back (the order was cancelled, expired or refunded). Never goes below zero. */
  abstract release(couponId: string, ownerId: string): Promise<void>;
}
