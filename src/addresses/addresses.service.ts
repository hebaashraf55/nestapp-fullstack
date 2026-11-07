import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { ADDRESSES_PER_USER } from './address.schema';
import { AddressRecord, AddressesRepository } from './addresses.repository';
import { AddressCreateDto, AddressUpdateDto } from './dto';

export type AddressView = Omit<AddressRecord, 'userId'>;
const view = ({ userId: _u, ...rest }: AddressRecord): AddressView => rest;
const notFound = () => new NotFoundException('Address not found');

@Injectable()
export class AddressesService {
  constructor(private readonly repo: AddressesRepository) {}

  async list(user: AuthenticatedUser): Promise<AddressView[]> {
    return (await this.repo.list(user.id)).map(view);
  }

  async create(dto: AddressCreateDto, user: AuthenticatedUser): Promise<AddressView> {
    const count = await this.repo.count(user.id);
    if (count >= ADDRESSES_PER_USER)
      throw new ConflictException(`You can save up to ${ADDRESSES_PER_USER} addresses`);
    const { isDefault, ...fields } = dto;
    // The first address becomes the default automatically.
    return view(await this.repo.create(user.id, fields, isDefault || count === 0));
  }

  async update(id: string, dto: AddressUpdateDto, user: AuthenticatedUser): Promise<AddressView> {
    const updated = await this.repo.update(id, user.id, dto);
    if (!updated) throw notFound();
    return view(updated);
  }

  async setDefault(id: string, user: AuthenticatedUser): Promise<AddressView> {
    const updated = await this.repo.setDefault(id, user.id);
    if (!updated) throw notFound();
    return view(updated);
  }

  async remove(id: string, user: AuthenticatedUser): Promise<{ deleted: true }> {
    const existing = await this.repo.findOwned(id, user.id);
    if (!existing || !(await this.repo.delete(id, user.id))) throw notFound();
    if (existing.isDefault) {
      const next = (await this.repo.list(user.id))[0];
      if (next) await this.repo.setDefault(next.id, user.id);
    }
    return { deleted: true };
  }

  /** For checkout: the caller's own saved address, or 404. */
  async resolve(id: string, user: AuthenticatedUser): Promise<AddressRecord> {
    const found = await this.repo.findOwned(id, user.id);
    if (!found) throw notFound();
    return found;
  }
}
