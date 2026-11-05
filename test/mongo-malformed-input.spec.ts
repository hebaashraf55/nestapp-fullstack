import type { Model } from 'mongoose';
import {
  MongoOtpRepository,
  MongoRefreshTokenRepository,
} from '../src/auth/mongo-auth.repositories';
import { MongoUsersRepository } from '../src/users/mongo-users.repository';

/**
 * Runs WITHOUT a database: the Mongoose model is a stub that fails the test if it is ever queried.
 * A malformed (non-string) lookup key must be answered "not found" before any query is built, so it
 * can neither throw a CastError (500) nor be interpreted as a query operator. The same behaviour is
 * also asserted against a real MongoDB in test/db (skipped unless MONGODB_TEST_URI is set).
 */
const forbidden = () => {
  throw new Error('the database must not be queried for malformed input');
};
const model = { findOne: forbidden, findOneAndUpdate: forbidden } as unknown as Model<never>;

const malformed: [string, unknown][] = [
  ['an operator object', { $ne: '' }],
  ['an array', ['a@example.com']],
  ['a number', 7],
  ['null', null],
  ['undefined', undefined],
];

describe('Mongo repositories: malformed lookup keys', () => {
  it.each(malformed)('users.findByEmail returns null for %s', async (_n, value) => {
    const repo = new MongoUsersRepository(model as never);
    await expect(repo.findByEmail(value as string)).resolves.toBeNull();
  });

  it.each(malformed)('otps.find returns null for a userId that is %s', async (_n, value) => {
    const repo = new MongoOtpRepository(model as never);
    await expect(repo.find(value as string, 'verify-email')).resolves.toBeNull();
  });

  it.each(malformed)('otps.find returns null for a purpose that is %s', async (_n, value) => {
    const repo = new MongoOtpRepository(model as never);
    await expect(repo.find('aaaaaaaaaaaaaaaaaaaaaaaa', value as never)).resolves.toBeNull();
  });

  it.each(malformed)('refreshTokens.findByHash returns null for %s', async (_n, value) => {
    const repo = new MongoRefreshTokenRepository(model as never);
    await expect(repo.findByHash(value as string)).resolves.toBeNull();
  });

  it('valid string input still reaches the database with $eq filters', async () => {
    const seen: unknown[] = [];
    const exec = () => Promise.resolve(null);
    const spy = {
      findOne: (filter: unknown) => {
        seen.push(filter);
        return { select: () => ({ exec }), exec };
      },
    } as never;
    await new MongoUsersRepository(spy).findByEmail('a@example.com');
    await new MongoOtpRepository(spy).find('u1', 'verify-email');
    await new MongoRefreshTokenRepository(spy).findByHash('abc');
    expect(seen).toEqual([
      { email: { $eq: 'a@example.com' } },
      { userId: { $eq: 'u1' }, purpose: { $eq: 'verify-email' } },
      { tokenHash: { $eq: 'abc' } },
    ]);
  });
});
