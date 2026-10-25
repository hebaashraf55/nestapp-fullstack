import { InMemoryUsersRepository } from '../../test/helpers/in-memory-users.repository';
import { Role } from './role';
import { assertRoleInvariants, toPublicUser, UsersService } from './users.service';
import { DuplicateEmailError } from './users.repository';

const base = { name: 'N', passwordHash: 'scrypt$hash', emailVerified: false };

describe('UsersService', () => {
  let repo: InMemoryUsersRepository;
  let service: UsersService;
  beforeEach(() => {
    repo = new InMemoryUsersRepository();
    service = new UsersService(repo);
  });

  it('normalizes email on create and lookup', async () => {
    const user = await service.create({
      ...base,
      email: '  Mixed@Example.COM ',
      role: Role.CUSTOMER,
      isDemo: false,
    });
    expect(user.email).toBe('mixed@example.com');
    expect((await service.findByEmail('MIXED@example.com'))?.id).toBe(user.id);
  });

  it('rejects a duplicate email regardless of case', async () => {
    await service.create({ ...base, email: 'a@example.com', role: Role.CUSTOMER, isDemo: false });
    await expect(
      service.create({ ...base, email: 'A@Example.com', role: Role.CUSTOMER, isDemo: false }),
    ).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  it('enforces the role/demo invariants on create and on role change', async () => {
    await expect(
      service.create({ ...base, email: 'v@example.com', role: Role.DEMO_VIEWER, isDemo: false }),
    ).rejects.toThrow(/DEMO_VIEWER/);
    await expect(
      service.create({ ...base, email: 'a@example.com', role: Role.ADMIN, isDemo: true }),
    ).rejects.toThrow(/ADMIN/);
    const user = await service.create({
      ...base,
      email: 'c@example.com',
      role: Role.CUSTOMER,
      isDemo: false,
    });
    await expect(service.setRole(user.id, Role.DEMO_VIEWER, false)).rejects.toThrow();
    await service.setRole(user.id, Role.ADMIN, false);
    expect((await service.findById(user.id))?.role).toBe(Role.ADMIN);
    expect(() => assertRoleInvariants(Role.CUSTOMER, true)).not.toThrow();
  });

  it('public projection never contains the password hash', async () => {
    const user = await service.create({
      ...base,
      email: 'p@example.com',
      role: Role.CUSTOMER,
      isDemo: false,
    });
    const view = toPublicUser(user);
    expect(Object.keys(view).sort()).toEqual(['email', 'id', 'isDemo', 'name', 'role']);
    expect(JSON.stringify(view)).not.toContain('scrypt');
  });
});
