export interface LookSpotRecord {
  productId: string;
  x: number | null;
  y: number | null;
}
export interface LookRecord {
  id: string;
  title: string;
  slug: string;
  description: string;
  image: string;
  spots: LookSpotRecord[];
  active: boolean;
  isDemo: boolean;
  createdBy: string;
  createdAt: Date;
}
export type NewLook = Omit<LookRecord, 'id' | 'createdAt'>;
export type LookPatch = Partial<
  Pick<LookRecord, 'title' | 'slug' | 'description' | 'image' | 'spots' | 'active'>
>;

export class DuplicateLookError extends Error {
  constructor() {
    super('Duplicate look slug');
    this.name = 'DuplicateLookError';
  }
}

export abstract class LooksRepository {
  abstract findAll(filter: {
    activeOnly: boolean;
    demoOnly: boolean;
    productId?: string;
  }): Promise<LookRecord[]>;
  abstract findById(id: string): Promise<LookRecord | null>;
  abstract findBySlug(slug: string): Promise<LookRecord | null>;
  abstract create(look: NewLook): Promise<LookRecord>;
  abstract update(id: string, patch: LookPatch): Promise<LookRecord | null>;
  abstract delete(id: string): Promise<boolean>;
}
