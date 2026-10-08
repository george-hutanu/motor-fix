import { randomUUID } from 'node:crypto';

import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { BrandLoader } from './brand-loader';
import { BRANDS, type BrandRecord } from './brands';
import { BrandsService } from './brands.service';
import { CatalogueModule } from './catalogue.module';
import { AuthModule } from '../auth/auth.module';
import { serialDatabase } from '../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../notifications/notifications.testing';

const redisUrl = redisUrlFor(3);
const { prisma } = fixtures();
const redis = new Redis(redisUrl);
serialDatabase(databaseUrl);

let app: INestApplication;
let loader: BrandLoader;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret: 'test' }),
      CatalogueModule,
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  // The API's own pipe options (apps/api bootstrap).
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  await app.init();
  loader = app.get(BrandLoader);
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE brand, garage CASCADE');
  await redis.del('brands:active');
});

afterAll(async () => {
  await app.close();
  redis.disconnect();
  await prisma.$disconnect();
});

const search = (query: Record<string, string> = {}) =>
  request(app.getHttpServer()).get('/brands').query(query);

const names = (body: { items: { name: string }[] }) =>
  body.items.map((item) => item.name);

const numbered = (count: number): BrandRecord[] =>
  Array.from({ length: count }, (_, n) => ({
    key: `brand-${n + 1}`,
    name: `Brand ${String(n + 1).padStart(2, '0')}`,
  }));

describe('GET /brands', () => {
  it.each(['sko', 'Skoda', 'ŠKODA'])(
    'finds Škoda for a visitor typing %s',
    async (q) => {
      await loader.load(BRANDS);

      const res = await search({ q });

      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([
        {
          id: expect.any(String),
          name: 'Škoda',
          popularity: 6,
          slug: 'skoda',
        },
      ]);
      expect(res.body).toMatchObject({ nextCursor: null, total: 1 });
    },
  );

  it('lists every active brand by popularity, then unranked brands by name', async () => {
    await loader.load([
      { key: 'zeta', name: 'Zeta', popularity: 2 },
      { key: 'gamma', name: 'Gamma' },
      { key: 'beta', name: 'Beta', popularity: 1 },
      { key: 'alfa', name: 'Alfa' },
    ]);

    const res = await search();

    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual(['Beta', 'Zeta', 'Alfa', 'Gamma']);
    expect(res.body.total).toBe(4);
  });

  it('treats a search of spaces as no search', async () => {
    await loader.load(BRANDS);

    const res = await search({ q: '   ' });

    expect(res.body.total).toBe(14);
  });

  it('ships Alfa Romeo and Citroën unranked, after every ranked brand', async () => {
    await loader.load(BRANDS);

    const res = await search();
    const listed = names(res.body);

    expect(listed.slice(-2)).toEqual(['Alfa Romeo', 'Citroën']);
    expect(
      res.body.items
        .filter((b: { name: string }) =>
          ['Alfa Romeo', 'Citroën'].includes(b.name),
        )
        .map((b: { popularity: number | null }) => b.popularity),
    ).toEqual([null, null]);
  });

  it('pages 20 brands at a time with a cursor to the next page', async () => {
    await loader.load(numbered(25));

    const first = await search({ q: 'brand' });

    expect(first.body.items).toHaveLength(20);
    expect(first.body.total).toBe(25);
    expect(first.body.nextCursor).toBe(first.body.items[19].id);

    const second = await search({ cursor: first.body.nextCursor, q: 'brand' });

    expect(names(second.body)).toEqual([
      'Brand 21',
      'Brand 22',
      'Brand 23',
      'Brand 24',
      'Brand 25',
    ]);
    expect(second.body).toMatchObject({ nextCursor: null, total: 25 });
  });

  it('answers an empty page when nothing matches', async () => {
    await loader.load(BRANDS);

    const res = await search({ q: 'zzz' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], nextCursor: null, total: 0 });
  });

  it('never returns a retired brand', async () => {
    await loader.load(BRANDS);
    await loader.load(BRANDS.filter((brand) => brand.key !== 'tesla'));

    const res = await search({ q: 'tesla' });

    expect(res.body.items).toEqual([]);
    expect((await search()).body.total).toBe(13);
  });

  it.each([
    ['an unknown id', () => randomUUID(), {}],
    [
      'a brand that does not match the search',
      () => prisma.brand.findUniqueOrThrow({ where: { key: 'bmw' } }),
      { q: 'dacia' },
    ],
  ])(
    'answers 400 invalid_cursor to %s as cursor',
    async (_, cursorOf, query) => {
      await loader.load(BRANDS);
      const cursor = await cursorOf();

      const res = await search({
        ...query,
        cursor: typeof cursor === 'string' ? cursor : cursor.id,
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_cursor');
    },
  );

  it('answers 400 to a search longer than 60 characters', async () => {
    const res = await search({ q: 'a'.repeat(61) });

    expect(res.status).toBe(400);
  });

  it('serves the list from the cache until the loader changes it', async () => {
    await loader.load(BRANDS);
    await search({ q: 'dacia' });
    expect(await redis.get('brands:active')).not.toBeNull();
    await prisma.brand.update({
      data: { name: 'Dacia Groupe' },
      where: { key: 'dacia' },
    });

    expect(names((await search({ q: 'dacia' })).body)).toEqual(['Dacia']);

    await loader.load(
      BRANDS.map((brand) =>
        brand.key === 'dacia' ? { ...brand, name: 'Dacia Renault' } : brand,
      ),
    );

    expect(names((await search({ q: 'dacia' })).body)).toEqual([
      'Dacia Renault',
    ]);
  });

  it('keeps the cached list for an hour', async () => {
    await loader.load(BRANDS);
    await search();

    const ttl = await redis.ttl('brands:active');

    expect(ttl).toBeGreaterThan(3590);
    expect(ttl).toBeLessThanOrEqual(3600);
  });
});

describe('BrandsService without Redis', () => {
  it('reads the list from PostgreSQL', async () => {
    await loader.load(BRANDS);
    const down = new Redis('redis://127.0.0.1:1', {
      connectTimeout: 200,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    down.on('error', () => undefined);

    const page = await new BrandsService(prisma, down).search('sko');

    expect(page.items.map((item) => item.name)).toEqual(['Škoda']);
    down.disconnect();
  });
});
