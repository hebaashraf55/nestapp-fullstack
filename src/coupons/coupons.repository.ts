export interface CouponRecord {
  id: string;
  code: string;
  discountPercent: number;
  expiresAt: Date;
  /** False when an admin has paused the coupon. */
  active: boolean;
  isDemo: boolean;
  createdBy: string;
  createdAt: Date;
}
export type NewCoupon = Omit<CouponRecord, 'id' | 'createdAt'>;
export type CouponPatch = Partial<Pick<CouponRecord, 'discountPercent' | 'expiresAt' | 'active'>>;

/** The single rule for whether a cart may use a coupon: active and not yet expired. */
export const isCouponUsable = (c: CouponRecord, now = Date.now()): boolean =>
  c.active && c.expiresAt.getTime() > now;

/** Persistence port. Codes are stored upper-case; `create` throws DuplicateKeyError on a repeated code. */
export abstract class CouponsRepository {
  abstract findById(id: string): Promise<CouponRecord | null>;
  abstract findByCode(code: string): Promise<CouponRecord | null>;
  abstract findAll(): Promise<CouponRecord[]>;
  abstract create(record: NewCoupon): Promise<CouponRecord>;
  abstract update(id: string, patch: CouponPatch): Promise<CouponRecord | null>;
  abstract delete(id: string): Promise<boolean>;
}
