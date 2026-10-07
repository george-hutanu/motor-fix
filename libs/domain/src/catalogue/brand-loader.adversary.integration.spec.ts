import { Redis } from 'ioredis';

import { BrandLoader } from './brand-loader';
import { BrandFileError, type BrandRecord } from './brands';
import { AuditService } from '../audit/audit.service';
import { foreignEntries } from '../audit/audit.testing';
import { serialDatabase } from '../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../notifications/notifications.testing';

const { prisma } = fixtures();
const redis = new Redis(redisUrlFor(3));
const loader = new BrandLoader(prisma, new AuditService(), redis);
serialDatabase(databaseUrl);

let since: Date;

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE brand, garage CASCADE');
  await redis.del('brands:active');
  const [{ now }] = await prisma.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS now`;
  since = now;
  await foreignEntries(prisma, [{ subjectType: 'brand' }]);
});

afterAll(async () => {
  redis.disconnect();
  await prisma.$disconnect();
});

const stored = () => prisma.brand.findMany({ orderBy: { key: 'asc' } });
// Only the catalogue's own brands: the log keeps other runs' entries.
const history = async () =>
  prisma.activityLog.findMany({
    where: {
      at: { gte: since },
      subjectId: {
        in: (await prisma.brand.findMany({ select: { id: true } })).map(
          (b) => b.id,
        ),
      },
      subjectType: 'brand',
    },
  });

describe('BrandLoader under hostile files', () => {
  it('retires every brand when the file is empty', async () => {
    await loader.load([{ key: 'bmw', name: 'BMW' }]);

    const result = await loader.load([]);

    expect(result.changed).toBe(1);
    expect((await stored()).map((b) => b.active)).toEqual([false]);
  });

  it('loads an empty file into an empty store as zero changes', async () => {
    expect(await loader.load([])).toEqual({ changed: 0 });
    expect(await stored()).toEqual([]);
  });

  it('treats a reordered file as no change', async () => {
    const file: BrandRecord[] = [
      { key: 'a', name: 'Alfa', popularity: 1 },
      { key: 'b', name: 'Bravo' },
    ];
    await loader.load(file);
    const entries = (await history()).length;

    expect((await loader.load([...file].reverse())).changed).toBe(0);
    expect(await history()).toHaveLength(entries);
  });

  it.each([
    [
      'names differing only in case',
      [
        { key: 'a', name: 'BMW' },
        { key: 'b', name: 'bmw' },
      ],
    ],
    [
      'names differing only in accents',
      [
        { key: 'a', name: 'Skoda' },
        { key: 'b', name: 'Škoda' },
      ],
    ],
    [
      'names differing only in punctuation',
      [
        { key: 'a', name: 'Mercedes-Benz' },
        { key: 'b', name: 'Mercedes Benz' },
      ],
    ],
    [
      'the same key twice',
      [
        { key: 'a', name: 'Alfa' },
        { key: 'a', name: 'Bravo' },
      ],
    ],
  ])('refuses %s with a BrandFileError and stores nothing', async (_, file) => {
    await expect(loader.load(file)).rejects.toThrow(BrandFileError);
    expect(await stored()).toEqual([]);
    expect(await history()).toEqual([]);
  });

  it.each([
    ['a name with no letters or digits', { key: 'x', name: '!!!' }],
    ['a blank name', { key: 'x', name: '   ' }],
    ['an empty key', { key: '', name: 'Alfa' }],
    ['a popularity of zero', { key: 'x', name: 'Alfa', popularity: 0 }],
    ['a negative popularity', { key: 'x', name: 'Alfa', popularity: -3 }],
    ['a fractional popularity', { key: 'x', name: 'Alfa', popularity: 1.5 }],
    ['a NaN popularity', { key: 'x', name: 'Alfa', popularity: Number.NaN }],
  ])('refuses %s', async (_, record) => {
    await expect(loader.load([record])).rejects.toThrow(BrandFileError);
    expect(await stored()).toEqual([]);
  });

  it('undoes brands already written when a later one hits a stored retired brand', async () => {
    await loader.load([
      { key: 'a', name: 'Alfa' },
      { key: 'old', name: 'Old' },
    ]);
    await loader.load([{ key: 'a', name: 'Alfa' }]);
    const before = await stored();
    const entries = (await history()).length;
    await redis.set('brands:active', '[]');

    await expect(
      loader.load([
        { key: 'a', name: 'Alfa', popularity: 4 },
        { key: 'fresh', name: 'Fresh' },
        { key: 'new-old', name: 'Old' },
      ]),
    ).rejects.toThrow(BrandFileError);

    expect(await stored()).toEqual(before);
    expect(await history()).toHaveLength(entries);
    expect(await redis.get('brands:active')).toBe('[]');
  });

  it('names both keys of a clash with a stored brand', async () => {
    await loader.load([{ key: 'dacia', name: 'Dacia' }]);

    await expect(
      loader.load([
        { key: 'dacia', name: 'Dacia Old' },
        { key: 'dacia-group', name: 'Dacia Old' },
      ]),
    ).rejects.toThrow(/dacia.*dacia-group/);
  });

  it('survives two loads of the same file at the same moment', async () => {
    const file: BrandRecord[] = [
      { key: 'a', name: 'Alfa', popularity: 1 },
      { key: 'b', name: 'Bravo' },
    ];

    await Promise.allSettled([loader.load(file), loader.load(file)]);

    expect((await stored()).map((b) => b.key)).toEqual(['a', 'b']);
    expect(await history()).toHaveLength(2);
  });

  it('stores a file of three thousand brands and finds it unchanged on the second run', async () => {
    const file = Array.from({ length: 3000 }, (_, n) => ({
      key: `k${n}`,
      name: `Brand ${n}`,
      popularity: n + 1,
    }));

    expect((await loader.load(file)).changed).toBe(3000);
    expect((await loader.load(file)).changed).toBe(0);
    expect(await prisma.brand.count()).toBe(3000);
  }, 120_000);

  it('keeps unicode names as written', async () => {
    await loader.load([{ key: 'ro', name: 'Țiriac Ș' }]);

    expect((await stored())[0]).toMatchObject({
      name: 'Țiriac Ș',
      slug: 'tiriac-s',
    });
  });

  it('reports a rename plus a retire plus a creation as three changes', async () => {
    await loader.load([
      { key: 'a', name: 'Alfa' },
      { key: 'b', name: 'Bravo' },
    ]);

    const result = await loader.load([
      { key: 'a', name: 'Alfa Romeo' },
      { key: 'c', name: 'Charlie' },
    ]);

    expect(result.changed).toBe(3);
  });
});
