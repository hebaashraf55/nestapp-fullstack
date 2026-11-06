import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model } from 'mongoose';
import { MongoShopperListsRepository } from '../../src/shopper/mongo-shopper.repository';
import { RECENT_MAX } from '../../src/shopper/shopper.repository';
import {
  RecentViews,
  RecentViewsSchema,
  Wishlist,
  WishlistSchema,
} from '../../src/shopper/shopper.schemas';

const uri = process.env.MONGODB_TEST_URI;
const suite = uri ? describe : describe.skip;
const oid = (n: number) => n.toString(16).padStart(24, '0');

suite('wishlist and recently viewed storage (real MongoDB)', () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let repo: MongoShopperListsRepository;
  let models: Model<unknown>[];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(uri as string, { serverSelectionTimeoutMS: 5000 }),
        MongooseModule.forFeature([
          { name: Wishlist.name, schema: WishlistSchema },
          { name: RecentViews.name, schema: RecentViewsSchema },
        ]),
      ],
      providers: [MongoShopperListsRepository],
    }).compile();
    await moduleRef.init();
    repo = moduleRef.get(MongoShopperListsRepository);
    models = [Wishlist, RecentViews].map((c) => moduleRef.get(getModelToken(c.name)));
    await Promise.all(models.map((m) => m.init()));
  });
  beforeEach(async () => {
    await Promise.all(models.map((m) => m.deleteMany({})));
  });
  afterAll(async () => {
    await moduleRef?.close();
  });

  it('never stores a product twice, even under concurrent adds', async () => {
    await Promise.all(Array.from({ length: 8 }, () => repo.addToWishlist('u1', [oid(1)])));
    expect(await repo.wishlist('u1')).toEqual([oid(1)]);
    await repo.addToWishlist('u1', [oid(2), oid(3)]);
    expect(await repo.removeFromWishlist('u1', oid(2))).toEqual([oid(1), oid(3)]);
    expect(await repo.wishlist('u2')).toEqual([]); // lists are per user
    expect(await models[0]!.countDocuments({ userId: 'u1' })).toBe(1);
  });

  it('keeps recently viewed newest first, without repeats, capped, in one document per user', async () => {
    await repo.recordViews('u1', [oid(1)]);
    await repo.recordViews('u1', [oid(2)]);
    expect(await repo.recordViews('u1', [oid(1)])).toEqual([oid(1), oid(2)]);
    for (let i = 10; i < 10 + RECENT_MAX + 5; i++) await repo.recordViews('u1', [oid(i)]);
    const list = await repo.recentlyViewed('u1');
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0]).toBe(oid(10 + RECENT_MAX + 4));
    expect(await repo.recordViews('u2', [oid(5), oid(6)])).toEqual([oid(5), oid(6)]);
    expect(await models[1]!.countDocuments({})).toBe(2);
  });

  it('treats an operator object as an ordinary (non-matching) user id', async () => {
    expect(await repo.wishlist({ $ne: '' } as unknown as string)).toEqual([]);
  });
});
