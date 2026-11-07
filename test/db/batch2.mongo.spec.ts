import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model } from 'mongoose';
import { Bundle, BundleSchema } from '../../src/bundles/bundle.schema';
import { DuplicateBundleError, NewBundle } from '../../src/bundles/bundles.repository';
import { MongoBundlesRepository } from '../../src/bundles/mongo-bundles.repository';
import { Look, LookSchema } from '../../src/looks/look.schema';
import { MongoLooksRepository } from '../../src/looks/mongo-looks.repository';
import {
  MOODBOARD_MAX_PRODUCTS,
  Moodboard,
  MoodboardSchema,
} from '../../src/moodboards/moodboard.schema';
import { MongoMoodboardsRepository } from '../../src/moodboards/mongo-moodboards.repository';

const uri = process.env.MONGODB_TEST_URI;
const suite = uri ? describe : describe.skip;
const oid = (n: number) => n.toString(16).padStart(24, '0');
const bundle = (over: Partial<NewBundle> = {}): NewBundle => ({
  name: 'Bath Set',
  slug: 'bath-set',
  description: '',
  image: null,
  items: [
    { productId: oid(1), quantity: 1 },
    { productId: oid(2), quantity: 2 },
  ],
  discountPercent: 10,
  active: true,
  isDemo: false,
  createdBy: 'admin',
  ...over,
});

suite('bundles, looks and moodboards storage (real MongoDB)', () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let bundles: MongoBundlesRepository;
  let looks: MongoLooksRepository;
  let boards: MongoMoodboardsRepository;
  let models: Model<unknown>[];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(uri as string, { serverSelectionTimeoutMS: 5000 }),
        MongooseModule.forFeature([
          { name: Bundle.name, schema: BundleSchema },
          { name: Look.name, schema: LookSchema },
          { name: Moodboard.name, schema: MoodboardSchema },
        ]),
      ],
      providers: [MongoBundlesRepository, MongoLooksRepository, MongoMoodboardsRepository],
    }).compile();
    await moduleRef.init();
    bundles = moduleRef.get(MongoBundlesRepository);
    looks = moduleRef.get(MongoLooksRepository);
    boards = moduleRef.get(MongoMoodboardsRepository);
    models = [Bundle, Look, Moodboard].map((c) => moduleRef.get(getModelToken(c.name)));
    await Promise.all(models.map((m) => m.init()));
  });
  beforeEach(async () => {
    await Promise.all(models.map((m) => m.deleteMany({})));
  });
  afterAll(async () => {
    await moduleRef?.close();
  });

  it('round-trips bundles, finds active ones by product, and keeps slugs unique', async () => {
    const created = await bundles.create(bundle());
    expect(created.items).toEqual(bundle().items);
    await bundles.create(bundle({ slug: 'paused', active: false }));
    expect((await bundles.findActiveContaining([oid(2), 'nope'])).map((b) => b.slug)).toEqual([
      'bath-set',
    ]);
    expect(await bundles.findActiveContaining(['nope'])).toEqual([]);
    expect(
      (await bundles.findAll({ activeOnly: false, demoOnly: false, productId: oid(1) })).length,
    ).toBe(2);
    await expect(bundles.create(bundle())).rejects.toBeInstanceOf(DuplicateBundleError);
    await expect(bundles.create(bundle({ slug: 'x', discountPercent: 80 }))).rejects.toThrow();
    expect(await bundles.findBySlug({ $ne: 'x' } as unknown as string)).toBeNull();
    const updated = await bundles.update(created.id, {
      items: [{ productId: oid(3), quantity: 1 }],
    });
    expect(updated?.items).toEqual([{ productId: oid(3), quantity: 1 }]);
  });

  it('round-trips looks with optional spots', async () => {
    const look = await looks.create({
      title: 'Living',
      slug: 'living',
      description: '',
      image: '/catalogue/x.jpg',
      spots: [
        { productId: oid(1), x: 20, y: 40 },
        { productId: oid(2), x: null, y: null },
      ],
      active: true,
      isDemo: false,
      createdBy: 'admin',
    });
    expect((await looks.findBySlug('living'))?.spots).toEqual(look.spots);
    expect(
      await looks.findAll({ activeOnly: true, demoOnly: false, productId: oid(2) }),
    ).toHaveLength(1);
    expect(await looks.findAll({ activeOnly: true, demoOnly: true })).toEqual([]);
  });

  it('scopes every moodboard write to its owner, caps it, and keeps share tokens unique', async () => {
    const b = await boards.create({ userId: 'u1', name: 'Calm', note: '' });
    expect(await boards.addProduct(b.id, 'u2', oid(1))).toBeNull(); // not the owner
    await Promise.all(Array.from({ length: 6 }, () => boards.addProduct(b.id, 'u1', oid(1))));
    expect((await boards.findOwned(b.id, 'u1'))?.productIds).toEqual([oid(1)]);
    await models[2]!.updateOne(
      { _id: b.id },
      {
        $set: {
          productIds: Array.from({ length: MOODBOARD_MAX_PRODUCTS }, (_, i) => oid(i + 100)),
        },
      },
    );
    expect(await boards.addProduct(b.id, 'u1', oid(5))).toBeNull(); // full
    expect(await boards.delete(b.id, 'u2')).toBe(false);
    expect(await boards.findOwned(b.id, { $ne: 'x' } as unknown as string)).toBeNull();

    const token = 'a'.repeat(32);
    await boards.setShareToken(b.id, 'u1', token);
    const other = await boards.create({ userId: 'u2', name: 'Mine', note: '' });
    await expect(boards.setShareToken(other.id, 'u2', token)).rejects.toThrow(); // unique index
    expect((await boards.findByShareToken(token))?.id).toBe(b.id);
    expect(await boards.findByShareToken({ $ne: null } as unknown as string)).toBeNull();
    // Many private boards (null tokens) do not collide.
    await boards.setShareToken(b.id, 'u1', null);
    await boards.create({ userId: 'u3', name: 'Another', note: '' });
    expect(await boards.findByShareToken(token)).toBeNull();
  });
});
