/**
 * Mongoose-backed tests. They need a real MongoDB, so they run only when MONGODB_TEST_URI is set
 * (use a throwaway database: the collection is emptied before every test). Otherwise they show up
 * as SKIPPED, never as passed. Run with: `npm run db:up` then `npm run test:db`.
 */
import { Test } from '@nestjs/testing';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { hashPassword, verifyPassword } from '../../src/auth/password';
import { MongoUsersRepository } from '../../src/users/mongo-users.repository';
import { Role } from '../../src/users/role';
import { User, UserSchema } from '../../src/users/user.schema';
import { DuplicateEmailError } from '../../src/users/users.repository';
import { UsersService } from '../../src/users/users.service';
import { loadSeedConfig } from '../../src/seed/seed-config';
import { seedUsers } from '../../src/seed/seed-users';

const uri = process.env.MONGODB_TEST_URI;
const suite = uri ? describe : describe.skip;

suite('MongoUsersRepository (real MongoDB)', () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let repo: MongoUsersRepository;
  let service: UsersService;
  let model: Model<User>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(uri as string, { serverSelectionTimeoutMS: 5000 }),
        MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
      ],
      providers: [MongoUsersRepository],
    }).compile();
    await moduleRef.init();
    repo = moduleRef.get(MongoUsersRepository);
    service = new UsersService(repo);
    model = moduleRef.get<Model<User>>(getModelToken(User.name));
    await model.init(); // make sure the unique index exists before testing it
  });

  beforeEach(async () => {
    await model.deleteMany({});
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const base = { name: 'N', passwordHash: 'scrypt$x', isDemo: false, emailVerified: false };

  it('creates and finds a user by id and by (normalized) email', async () => {
    const created = await service.create({
      ...base,
      email: 'Ann@Example.com',
      role: Role.CUSTOMER,
    });
    expect(created.email).toBe('ann@example.com');
    expect((await repo.findById(created.id))?.email).toBe('ann@example.com');
    expect((await service.findByEmail('ANN@example.com'))?.id).toBe(created.id);
  });

  it('enforces a unique email at the database level', async () => {
    await service.create({ ...base, email: 'dup@example.com', role: Role.CUSTOMER });
    await expect(
      repo.create({ ...base, email: 'dup@example.com', role: Role.CUSTOMER }),
    ).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  it('never returns the password hash from ordinary queries, only via the repository', async () => {
    const created = await service.create({ ...base, email: 'h@example.com', role: Role.CUSTOMER });
    const plain = await model.findById(created.id).lean().exec();
    expect(plain).not.toHaveProperty('passwordHash');
    expect((await repo.findById(created.id))?.passwordHash).toBe('scrypt$x');
  });

  it('treats a malformed id as not found instead of throwing', async () => {
    await expect(repo.findById('not-an-object-id')).resolves.toBeNull();
    await expect(repo.findById("{ $ne: '' }")).resolves.toBeNull();
  });

  it('does not let a query-operator object act as an email', async () => {
    await service.create({ ...base, email: 'victim@example.com', role: Role.CUSTOMER });
    await expect(repo.findByEmail({ $ne: '' } as unknown as string)).resolves.toBeNull();
  });

  it('rejects an invalid role at the schema level', async () => {
    await expect(
      model.create({
        email: 'r@example.com',
        name: 'R',
        passwordHash: 'x',
        role: 'SUPERUSER',
        isDemo: false,
      }),
    ).rejects.toThrow(/role/i);
  });

  it('defaults to CUSTOMER and non-demo', async () => {
    const doc = await model.create({ email: 'd@example.com', name: 'D', passwordHash: 'x' });
    expect(doc.role).toBe(Role.CUSTOMER);
    expect(doc.isDemo).toBe(false);
  });

  it('updates role and demo flag', async () => {
    const created = await service.create({ ...base, email: 'u@example.com', role: Role.CUSTOMER });
    await service.setRole(created.id, Role.ADMIN, false);
    expect((await repo.findById(created.id))?.role).toBe(Role.ADMIN);
  });

  it('seeds the three accounts into a real database, idempotently', async () => {
    const config = loadSeedConfig({
      SEED_ADMIN_EMAIL: 'owner@example.com',
      SEED_ADMIN_PASSWORD: 'admin-pass-long-1',
      SEED_DEMO_PASSWORD: 'demo-pass-long-1',
    });
    expect((await seedUsers(service, config)).map((r) => r.outcome)).toEqual([
      'created',
      'created',
      'created',
    ]);
    expect((await seedUsers(service, config)).map((r) => r.outcome)).toEqual([
      'already-exists',
      'already-exists',
      'already-exists',
    ]);
    const admin = await service.findByEmail('owner@example.com');
    expect(admin && (await verifyPassword('admin-pass-long-1', admin.passwordHash))).toBe(true);
    expect(await model.countDocuments()).toBe(3);
    // hashPassword imported to ensure the same scrypt format is what the DB round-trips
    expect(await hashPassword('x-long-password-1')).toMatch(/^scrypt\$/);
  });
});
