export interface CartLine {
  productId: string;
  quantity: number;
}

/** What is stored: product references and quantities only. Prices are never stored in the cart. */
export interface CartRecord {
  userId: string;
  items: CartLine[];
  couponId: string | null;
  /** Optimistic-concurrency counter; 0 means "no cart stored yet". */
  version: number;
}
export type CartData = Pick<CartRecord, 'items' | 'couponId'>;

/** Thrown by `save` when another request changed the cart since it was read. */
export class VersionConflictError extends Error {
  constructor() {
    super('Cart was modified concurrently');
    this.name = 'VersionConflictError';
  }
}

export abstract class CartsRepository {
  abstract findByUser(userId: string): Promise<CartRecord | null>;
  /** Compare-and-set: succeeds only if the stored version equals `expectedVersion` (0 = create). */
  abstract save(userId: string, expectedVersion: number, data: CartData): Promise<void>;
}
