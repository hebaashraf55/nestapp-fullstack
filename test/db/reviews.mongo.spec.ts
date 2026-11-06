import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model } from 'mongoose';
import { MongoReviewsRepository } from '../../src/reviews/mongo-reviews.repository';
import { Review, ReviewSchema } from '../../src/reviews/review.schema';
import { DuplicateReviewError, NewReview } from '../../src/reviews/reviews.repository';

const uri = process.env.MONGODB_TEST_URI;
const suite = uri ? describe : describe.skip;
const oid = (n: number) => n.toString(16).padStart(24, '0');
const review = (over: Partial<NewReview> = {}): NewReview => ({
  productId: oid(1),
  userId: 'u1',
  authorName: 'Ada L.',
  rating: 4,
  title: 'Lovely',
  body: 'A lovely piece indeed.',
  verifiedPurchase: false,
  isDemo: false,
  ...over,
});

suite('review storage (real MongoDB)', () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let repo: MongoReviewsRepository;
  let model: Model<unknown>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(uri as string, { serverSelectionTimeoutMS: 5000 }),
        MongooseModule.forFeature([{ name: Review.name, schema: ReviewSchema }]),
      ],
      providers: [MongoReviewsRepository],
    }).compile();
    await moduleRef.init();
    repo = moduleRef.get(MongoReviewsRepository);
    model = moduleRef.get(getModelToken(Review.name));
    await model.init();
  });
  beforeEach(async () => {
    await model.deleteMany({});
  });
  afterAll(async () => {
    await moduleRef?.close();
  });

  it('stores one review per user and product, even when two submissions race', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => repo.create(review())),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x) => x.status === 'rejected'))
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(DuplicateReviewError);
    expect(await model.countDocuments({})).toBe(1);
    await repo.create(review({ userId: 'u2' })); // another customer may still review it
  });

  it('summarises approved reviews only and pages them by sort', async () => {
    const ids: string[] = [];
    for (const [i, rating] of [5, 4, 4, 1].entries())
      ids.push((await repo.create(review({ userId: `u${i}`, rating }))).id);
    await repo.create(review({ userId: 'pending', rating: 1 }));
    for (const id of ids) await repo.moderate(id, 'APPROVED', null, 'admin');
    expect(await repo.summarize(oid(1))).toEqual({
      average: 3.5,
      count: 4,
      distribution: [1, 0, 0, 2, 1],
    });
    const highest = await repo.findApproved(oid(1), 'highest', 1, 2);
    expect(highest.total).toBe(4);
    expect(highest.items.map((r) => r.rating)).toEqual([5, 4]);
    expect((await repo.findApproved(oid(1), 'lowest', 1, 10)).items[0]!.rating).toBe(1);
  });

  it('sends an author edit back to moderation, only for the author', async () => {
    const r = await repo.create(review());
    await repo.moderate(r.id, 'REJECTED', 'Too short', 'admin');
    expect(
      await repo.updateContent(r.id, 'someone-else', {
        rating: 5,
        title: 't',
        body: 'b',
        verifiedPurchase: true,
      }),
    ).toBeNull();
    const edited = await repo.updateContent(r.id, 'u1', {
      rating: 5,
      title: 'Better',
      body: 'Now with details.',
      verifiedPurchase: true,
    });
    expect(edited).toMatchObject({
      status: 'PENDING',
      moderationNote: null,
      rating: 5,
      verifiedPurchase: true,
    });
  });

  it('enforces the schema limits and handles malformed or operator input safely', async () => {
    await expect(repo.create(review({ rating: 9 }))).rejects.toThrow();
    await expect(repo.create(review({ title: 'x'.repeat(121) }))).rejects.toThrow();
    expect(await repo.findById('nope')).toBeNull();
    expect(await repo.delete('nope')).toBe(false);
    expect(await repo.summarize('nope')).toMatchObject({ count: 0, average: null });
    await repo.create(review());
    const injected = { $ne: 'x' } as unknown as string;
    expect(await repo.findByUserAndProduct(injected, oid(1))).toBeNull();
    expect(
      await repo.updateContent(oid(9), injected, {
        rating: 1,
        title: 't',
        body: 'b',
        verifiedPurchase: false,
      }),
    ).toBeNull();
  });

  it('limits the moderation queue to synthetic reviews for the demo scope', async () => {
    await repo.create(review({ userId: 'real' }));
    await repo.create(review({ userId: 'demo', isDemo: true }));
    const demo = await repo.findForModeration({ demoOnly: true, page: 1, limit: 10 });
    expect(demo.items.map((r) => r.userId)).toEqual(['demo']);
    expect(
      (await repo.findForModeration({ demoOnly: false, status: 'PENDING', page: 1, limit: 10 }))
        .total,
    ).toBe(2);
  });
});
