/**
 * Mongoose-backed tests for the OTP and refresh-token repositories and the new user fields. They need a
 * real MongoDB, so they run only when MONGODB_TEST_URI is set; otherwise they are SKIPPED (not passed).
 */
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model } from 'mongoose';
import {
  Otp,
  OtpSchema,
  RefreshToken,
  RefreshTokenSchema,
} from '../../src/auth/auth-storage.schemas';
import {
  MongoOtpRepository,
  MongoRefreshTokenRepository,
} from '../../src/auth/mongo-auth.repositories';
import { MongoUsersRepository } from '../../src/users/mongo-users.repository';
import { Role } from '../../src/users/role';
import { User, UserSchema } from '../../src/users/user.schema';

const uri = process.env.MONGODB_TEST_URI;
const suite = uri ? describe : describe.skip;

suite('auth storage (real MongoDB)', () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let otps: MongoOtpRepository;
  let tokens: MongoRefreshTokenRepository;
  let users: MongoUsersRepository;
  let otpModel: Model<Otp>;
  let tokenModel: Model<RefreshToken>;
  let userModel: Model<User>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(uri as string, { serverSelectionTimeoutMS: 5000 }),
        MongooseModule.forFeature([
          { name: User.name, schema: UserSchema },
          { name: Otp.name, schema: OtpSchema },
          { name: RefreshToken.name, schema: RefreshTokenSchema },
        ]),
      ],
      providers: [MongoOtpRepository, MongoRefreshTokenRepository, MongoUsersRepository],
    }).compile();
    await moduleRef.init();
    otps = moduleRef.get(MongoOtpRepository);
    tokens = moduleRef.get(MongoRefreshTokenRepository);
    users = moduleRef.get(MongoUsersRepository);
    otpModel = moduleRef.get(getModelToken(Otp.name));
    tokenModel = moduleRef.get(getModelToken(RefreshToken.name));
    userModel = moduleRef.get(getModelToken(User.name));
    await Promise.all([otpModel.init(), tokenModel.init(), userModel.init()]);
  });

  beforeEach(async () => {
    await Promise.all([
      otpModel.deleteMany({}),
      tokenModel.deleteMany({}),
      userModel.deleteMany({}),
    ]);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const otp = (userId: string, purpose: 'verify-email' | 'reset-password' = 'verify-email') => ({
    userId,
    purpose,
    codeHash: 'h'.repeat(64),
    expiresAt: new Date(Date.now() + 600_000),
    sentAt: new Date(),
  });

  describe('OTP', () => {
    it('keeps one active code per user and purpose, and replacing resets attempts', async () => {
      const first = await otps.replace(otp('u1'));
      await otps.addAttempt(first.id);
      const second = await otps.replace(otp('u1'));
      expect(await otpModel.countDocuments({ userId: 'u1', purpose: 'verify-email' })).toBe(1);
      expect(second.attempts).toBe(0);
      await otps.replace(otp('u1', 'reset-password'));
      expect(await otpModel.countDocuments({ userId: 'u1' })).toBe(2);
    });

    it('counts attempts atomically', async () => {
      const record = await otps.replace(otp('u1'));
      const totals = await Promise.all([
        otps.addAttempt(record.id),
        otps.addAttempt(record.id),
        otps.addAttempt(record.id),
      ]);
      expect(totals.sort()).toEqual([1, 2, 3]);
    });

    it('consume succeeds for exactly one of two concurrent callers', async () => {
      const record = await otps.replace(otp('u1'));
      const results = await Promise.all([otps.consume(record.id), otps.consume(record.id)]);
      expect(results.sort()).toEqual([false, true]);
      expect(await otps.find('u1', 'verify-email')).toBeNull();
    });

    it('treats malformed ids and operator objects as not found', async () => {
      expect(await otps.consume('nope')).toBe(false);
      expect(await otps.find({ $ne: '' } as unknown as string, 'verify-email')).toBeNull();
    });

    it('has a TTL index on expiresAt', async () => {
      const indexes = await otpModel.collection.indexes();
      expect(indexes.some((i) => i.key.expiresAt === 1 && i.expireAfterSeconds === 0)).toBe(true);
    });
  });

  describe('refresh tokens', () => {
    const token = (hash: string, family = 'f1') => ({
      userId: 'u1',
      familyId: family,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    it('creates, finds by hash, and revokes atomically (one winner)', async () => {
      const record = await tokens.create(token('a'));
      expect((await tokens.findByHash('a'))?.revokedAt).toBeNull();
      const results = await Promise.all([tokens.revoke(record.id), tokens.revoke(record.id)]);
      expect(results.sort()).toEqual([false, true]);
      expect((await tokens.findByHash('a'))?.revokedAt).toBeInstanceOf(Date);
    });

    it('enforces unique token hashes', async () => {
      await tokens.create(token('dup'));
      await expect(tokens.create(token('dup'))).rejects.toThrow();
    });

    it('revokes a whole family, or every token of a user', async () => {
      await tokens.create(token('a', 'f1'));
      await tokens.create(token('b', 'f1'));
      await tokens.create(token('c', 'f2'));
      await tokens.revokeFamily('f1');
      expect((await tokens.findByHash('a'))?.revokedAt).not.toBeNull();
      expect((await tokens.findByHash('c'))?.revokedAt).toBeNull();
      await tokens.revokeAllForUser('u1');
      expect((await tokens.findByHash('c'))?.revokedAt).not.toBeNull();
    });

    it('does not treat an operator object as a hash', async () => {
      await tokens.create(token('real'));
      expect(await tokens.findByHash({ $ne: '' } as unknown as string)).toBeNull();
    });

    it('has a TTL index on expiresAt', async () => {
      const indexes = await tokenModel.collection.indexes();
      expect(indexes.some((i) => i.key.expiresAt === 1 && i.expireAfterSeconds === 0)).toBe(true);
    });
  });

  describe('user auth fields', () => {
    const base = { name: 'N', passwordHash: 'scrypt$x', role: Role.CUSTOMER, isDemo: false };

    it('new users start unverified with tokenVersion 0', async () => {
      const doc = await userModel.create({ ...base, email: 'a@example.com' });
      expect(doc.emailVerified).toBe(false);
      expect(doc.tokenVersion).toBe(0);
    });

    it('markEmailVerified, bumpTokenVersion and resetPassword update atomically', async () => {
      const user = await users.create({ ...base, email: 'b@example.com', emailVerified: false });
      await users.markEmailVerified(user.id);
      await Promise.all([users.bumpTokenVersion(user.id), users.bumpTokenVersion(user.id)]);
      expect((await users.findById(user.id))?.tokenVersion).toBe(2);
      await users.resetPassword(user.id, 'scrypt$new');
      const after = await users.findById(user.id);
      expect(after).toMatchObject({
        passwordHash: 'scrypt$new',
        emailVerified: true,
        tokenVersion: 3,
      });
    });
  });
});
