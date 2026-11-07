export interface AddressFields {
  label: string;
  fullName: string;
  line1: string;
  line2: string;
  city: string;
  postalCode: string;
  country: string;
  phone: string;
}
export interface AddressRecord extends AddressFields {
  id: string;
  userId: string;
  isDefault: boolean;
  createdAt: Date;
}

/** Every operation is scoped to the owner. */
export abstract class AddressesRepository {
  abstract list(userId: string): Promise<AddressRecord[]>;
  abstract count(userId: string): Promise<number>;
  abstract findOwned(id: string, userId: string): Promise<AddressRecord | null>;
  abstract create(
    userId: string,
    fields: AddressFields,
    isDefault: boolean,
  ): Promise<AddressRecord>;
  abstract update(
    id: string,
    userId: string,
    fields: Partial<AddressFields>,
  ): Promise<AddressRecord | null>;
  /** Makes this the only default address of the user. */
  abstract setDefault(id: string, userId: string): Promise<AddressRecord | null>;
  abstract delete(id: string, userId: string): Promise<boolean>;
}

/** One line for the order record and the courier label. */
export const formatAddress = (a: AddressFields): string =>
  [a.fullName, a.line1, a.line2, `${a.postalCode} ${a.city}`, a.country]
    .filter((x) => x.trim() !== '')
    .join(', ');
