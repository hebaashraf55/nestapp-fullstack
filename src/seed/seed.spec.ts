import { InMemoryUsersRepository } from '../../test/helpers/in-memory-users.repository';
import { verifyPassword } from '../auth/password';
import { Role } from '../users/role';
import { UsersService } from '../users/users.service';
import {
  DEMO_CUSTOMER_EMAIL,
  DEMO_VIEWER_EMAIL,
  loadSeedConfig,
  SeedConfigError,
} from './seed-config';
import { SeedConflictError, seedUsers } from './seed-users';

const good = {
  SEED_ADMIN_EMAIL: 'Owner@Example.com',
  SEED_ADMIN_PASSWORD: 'admin-pass-long-1',
  SEED_DEMO_PASSWORD: 'demo-pass-long-1',
};

describe('loadSeedConfig', () => {
  it('reads credentials from the environment and normalizes the email', () => {
    expect(loadSeedConfig(good)).toEqual({
      adminEmail: 'owner@example.com',
      adminPassword: 'admin-pass-long-1',
      demoPassword: 'demo-pass-long-1',
    });
  });

  it('has no built-in default credentials', () => {
    expect(() => loadSeedConfig({})).toThrow(SeedConfigError);
  });

  it('rejects short passwords and a bad email without echoing values', () => {
    try {
      loadSeedConfig({
        SEED_ADMIN_EMAIL: 'nope',
        SEED_ADMIN_PASSWORD: 'tiny-pw',
        SEED_DEMO_PASSWORD: 'tiny-pw2',
      });
      throw new Error('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/SEED_ADMIN_EMAIL/);
      expect(message).toMatch(/SEED_ADMIN_PASSWORD/);
      expect(message).not.toContain('tiny-pw');
    }
  });

  it('refuses a demo address as the admin email', () => {
    expect(() => loadSeedConfig({ ...good, SEED_ADMIN_EMAIL: DEMO_VIEWER_EMAIL })).toThrow(
      /demo account/,
    );
  });

  it('refuses placeholders and a shared admin/demo password in production only', () => {
    const placeholders = {
      ...good,
      SEED_ADMIN_PASSWORD: 'change-me-admin-pw',
      SEED_DEMO_PASSWORD: 'change-me-demo-pw',
    };
    expect(() => loadSeedConfig({ ...placeholders, NODE_ENV: 'production' })).toThrow(
      /placeholder/,
    );
    expect(() => loadSeedConfig({ ...placeholders, NODE_ENV: 'development' })).not.toThrow();
    expect(() =>
      loadSeedConfig({
        ...good,
        NODE_ENV: 'production',
        SEED_DEMO_PASSWORD: good.SEED_ADMIN_PASSWORD,
      }),
    ).toThrow(/must differ/);
  });
});

describe('seedUsers', () => {
  let repo: InMemoryUsersRepository;
  let users: UsersService;
  const config = loadSeedConfig(good);
  beforeEach(() => {
    repo = new InMemoryUsersRepository();
    users = new UsersService(repo);
  });

  it('creates the admin and the two demo accounts with the right roles and flags', async () => {
    const results = await seedUsers(users, config);
    expect(results.map((r) => r.outcome)).toEqual(['created', 'created', 'created']);
    const admin = await users.findByEmail('owner@example.com');
    const customer = await users.findByEmail(DEMO_CUSTOMER_EMAIL);
    const viewer = await users.findByEmail(DEMO_VIEWER_EMAIL);
    expect(admin).toMatchObject({ role: Role.ADMIN, isDemo: false, emailVerified: true });
    expect(customer).toMatchObject({ role: Role.CUSTOMER, isDemo: true });
    expect(viewer).toMatchObject({ role: Role.DEMO_VIEWER, isDemo: true, emailVerified: true });
  });

  it('stores only salted hashes, and each account gets its own password', async () => {
    await seedUsers(users, config);
    const admin = (await users.findByEmail('owner@example.com'))!;
    const viewer = (await users.findByEmail(DEMO_VIEWER_EMAIL))!;
    expect(JSON.stringify([...repo.records.values()])).not.toMatch(
      /admin-pass-long-1|demo-pass-long-1/,
    );
    expect(await verifyPassword('admin-pass-long-1', admin.passwordHash)).toBe(true);
    expect(await verifyPassword('demo-pass-long-1', admin.passwordHash)).toBe(false);
    expect(await verifyPassword('demo-pass-long-1', viewer.passwordHash)).toBe(true);
  });

  it('is idempotent and never overwrites an existing password', async () => {
    await seedUsers(users, config);
    const before = (await users.findByEmail('owner@example.com'))!.passwordHash;
    const second = await seedUsers(users, { ...config, adminPassword: 'a-brand-new-password-9' });
    expect(second.map((r) => r.outcome)).toEqual([
      'already-exists',
      'already-exists',
      'already-exists',
    ]);
    expect((await users.findByEmail('owner@example.com'))!.passwordHash).toBe(before);
    expect(repo.records.size).toBe(3);
  });

  it('refuses to promote an account that already exists with another role', async () => {
    await users.create({
      email: 'owner@example.com',
      name: 'Someone who registered first',
      passwordHash: 'x',
      role: Role.CUSTOMER,
      isDemo: false,
      emailVerified: false,
    });
    await expect(seedUsers(users, config)).rejects.toBeInstanceOf(SeedConflictError);
    expect((await users.findByEmail('owner@example.com'))!.role).toBe(Role.CUSTOMER);
  });
});
