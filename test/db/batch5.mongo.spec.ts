import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model } from 'mongoose';
import { Product, ProductSchema } from '../../src/catalogue/catalogue.schemas';
import { MongoProductsRepository } from '../../src/catalogue/mongo-catalogue.repositories';
import { Job, JobSchema } from '../../src/jobs/job.schema';
import { MongoJobsRepository } from '../../src/jobs/mongo-jobs.repository';

const uri = process.env.MONGODB_TEST_URI;
const suite = uri ? describe : describe.skip;
const oid = (n: number) => n.toString(16).padStart(24, '0');

suite('jobs and search on a real MongoDB', () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let jobs: MongoJobsRepository;
  let products: MongoProductsRepository;
  let models: Model<unknown>[];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(uri as string, { serverSelectionTimeoutMS: 5000 }),
        MongooseModule.forFeature([
          { name: Job.name, schema: JobSchema },
          { name: Product.name, schema: ProductSchema },
        ]),
      ],
      providers: [MongoJobsRepository, MongoProductsRepository],
    }).compile();
    await moduleRef.init();
    jobs = moduleRef.get(MongoJobsRepository);
    products = moduleRef.get(MongoProductsRepository);
    models = [Job, Product].map((c) => moduleRef.get(getModelToken(c.name)));
    await Promise.all(models.map((m) => m.deleteMany({})));
    // Builds the text index before the search test runs.
    await Promise.all(models.map((m) => m.syncIndexes()));
  });
  beforeEach(async () => {
    await Promise.all(models.map((m) => m.deleteMany({})));
  });
  afterAll(async () => {
    await moduleRef?.close();
  });

  it('gives each due job to exactly one of many racing workers', async () => {
    const past = new Date(Date.now() - 1000);
    for (let i = 0; i < 3; i++)
      await jobs.enqueue({
        type: 'mail.send',
        payload: { i },
        maxAttempts: 3,
        runAt: past,
        requestId: null,
      });
    await jobs.enqueue({
      type: 'mail.send',
      payload: {},
      maxAttempts: 3,
      runAt: new Date(Date.now() + 60_000),
      requestId: null,
    });
    const claimed = await Promise.all(
      Array.from({ length: 10 }, () => jobs.claimNext(new Date(), 60_000)),
    );
    const ids = claimed.filter(Boolean).map((j) => j!.id);
    expect(ids).toHaveLength(3); // the future job is not due
    expect(new Set(ids).size).toBe(3);
    expect(claimed.filter(Boolean).every((j) => j!.status === 'RUNNING' && j!.attempts === 1)).toBe(
      true,
    );
  });

  it('lets another worker take over a job whose lock expired, and clears the payload when done', async () => {
    const j = await jobs.enqueue({
      type: 'mail.send',
      payload: { text: 'link' },
      maxAttempts: 3,
      runAt: new Date(Date.now() - 1000),
      requestId: 'req-1',
    });
    await jobs.claimNext(new Date(), 1); // the first worker "dies" holding a 1 ms lock
    const later = new Date(Date.now() + 10);
    const again = await jobs.claimNext(later, 60_000);
    expect(again).toMatchObject({ id: j.id, attempts: 2 });
    await jobs.complete(j.id, new Date());
    const [done] = await jobs.list('DONE', 10);
    expect(done).toMatchObject({ id: j.id, payload: null, requestId: 'req-1' });
    expect(done!.finishedAt).toBeInstanceOf(Date);
  });

  it('retries, marks dead, and revives only dead jobs', async () => {
    const j = await jobs.enqueue({
      type: 'x',
      payload: {},
      maxAttempts: 1,
      runAt: new Date(Date.now() - 1000),
      requestId: null,
    });
    await jobs.claimNext(new Date(), 60_000);
    await jobs.fail(j.id, 'boom', null, new Date());
    expect((await jobs.counts()).DEAD).toBe(1);
    expect(await jobs.retry(j.id, new Date())).toMatchObject({
      status: 'PENDING',
      attempts: 0,
      lastError: null,
    });
    expect(await jobs.retry(j.id, new Date())).toBeNull();
    expect(await jobs.retry('nope', new Date())).toBeNull();
  });

  it('ranks by the weighted text index and falls back to literal matching', async () => {
    const base = {
      slug: '',
      description: '',
      images: ['/x.jpg'],
      priceCents: 100,
      discountPercent: 0,
      salePriceCents: 100,
      stock: 1,
      categoryId: oid(1),
      brandId: oid(2),
      isDemo: false,
      createdBy: 't',
    };
    await products.create({
      ...base,
      name: 'Linen Throw',
      slug: 'linen-throw',
      description: 'Lovely with a stoneware mug',
    });
    await products.create({
      ...base,
      name: 'Clay Planter',
      slug: 'clay-planter',
      specs: { material: 'Stoneware' },
    });
    await products.create({ ...base, name: 'Stoneware Mug', slug: 'stoneware-mug' });
    const page = (q: string) =>
      products.findPage({ q, demoOnly: false, sort: 'relevance', page: 1, limit: 10 });
    expect((await page('stoneware')).items.map((p) => p.name)).toEqual([
      'Stoneware Mug',
      'Clay Planter',
      'Linen Throw',
    ]);
    expect((await page('stonew')).total).toBe(3); // not a whole word: literal search
    expect((await page('"; db.dropDatabase(); //')).total).toBe(0);
  });
});
