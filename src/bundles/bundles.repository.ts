export interface BundleItemRecord {
  productId: string;
  quantity: number;
}
export interface BundleRecord {
  id: string;
  name: string;
  slug: string;
  description: string;
  image: string | null;
  items: BundleItemRecord[];
  discountPercent: number;
  active: boolean;
  isDemo: boolean;
  createdBy: string;
  createdAt: Date;
}
export type NewBundle = Omit<BundleRecord, 'id' | 'createdAt'>;
export type BundlePatch = Partial<
  Pick<
    BundleRecord,
    'name' | 'slug' | 'description' | 'image' | 'items' | 'discountPercent' | 'active'
  >
>;

export class DuplicateBundleError extends Error {
  constructor() {
    super('Duplicate bundle slug');
    this.name = 'DuplicateBundleError';
  }
}

export abstract class BundlesRepository {
  abstract findAll(filter: {
    activeOnly: boolean;
    demoOnly: boolean;
    productId?: string;
  }): Promise<BundleRecord[]>;
  /** Active bundles that contain at least one of these products (for cart pricing). */
  abstract findActiveContaining(productIds: string[]): Promise<BundleRecord[]>;
  abstract findById(id: string): Promise<BundleRecord | null>;
  abstract findBySlug(slug: string): Promise<BundleRecord | null>;
  abstract create(bundle: NewBundle): Promise<BundleRecord>;
  abstract update(id: string, patch: BundlePatch): Promise<BundleRecord | null>;
  abstract delete(id: string): Promise<boolean>;
}
