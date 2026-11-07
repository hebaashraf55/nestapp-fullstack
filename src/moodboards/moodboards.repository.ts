export interface MoodboardRecord {
  id: string;
  userId: string;
  name: string;
  note: string;
  productIds: string[];
  shareToken: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Every write is scoped to the owner: a board id alone never changes anything. */
export abstract class MoodboardsRepository {
  abstract listByUser(userId: string): Promise<MoodboardRecord[]>;
  abstract countByUser(userId: string): Promise<number>;
  abstract findOwned(id: string, userId: string): Promise<MoodboardRecord | null>;
  abstract findByShareToken(token: string): Promise<MoodboardRecord | null>;
  abstract create(board: { userId: string; name: string; note: string }): Promise<MoodboardRecord>;
  abstract update(
    id: string,
    userId: string,
    patch: { name?: string; note?: string },
  ): Promise<MoodboardRecord | null>;
  /** Adds once; returns null when the board is missing or already full. */
  abstract addProduct(
    id: string,
    userId: string,
    productId: string,
  ): Promise<MoodboardRecord | null>;
  abstract removeProduct(
    id: string,
    userId: string,
    productId: string,
  ): Promise<MoodboardRecord | null>;
  abstract setShareToken(
    id: string,
    userId: string,
    token: string | null,
  ): Promise<MoodboardRecord | null>;
  abstract delete(id: string, userId: string): Promise<boolean>;
}
