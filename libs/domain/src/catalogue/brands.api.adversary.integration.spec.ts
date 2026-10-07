import { randomUUID } from 'node:crypto';

import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { BrandLoader } from './brand-loader';
import type { BrandRecord } from './brands';
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

const get = (query: string = '') =>
  request(app.getHttpServer()).get(`/brands${query}`);

const mixed = (count: number): BrandRecord[] =>
  Array.from({ length: count }, (_, n) => ({
    key: `b${n}`,
    name: `Brand ${String(n).padStart(3, '0')}`,
    ...(n % 3 === 0 ? {} : { popularity: (n % 4) + 1 }),
  }));

describe('GET /brands under hostile queries', () => {
  it('returns an empty page for an empty store', async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], nextCursor: null, total: 0 });
  });

  it('serves exactly 20 with no next page for 20 brands, and 20 plus one for 21', async () => {
    await loader.load(mixed(20));
    const full = await get();
    expect(full.body.items).toHaveLength(20);
    expect(full.body).toMatchObject({ nextCursor: null, total: 20 });

    await loader.load(mixed(21));
    const over = await get();
    expect(over.body.items).toHaveLength(20);
    expect(over.body.nextCursor).toEqual(expect.any(String));
    expect(over.body.total).toBe(21);
    const next = await get(`?cursor=${over.body.nextCursor}`);
    expect(next.body.items).toHaveLength(1);
    expect(next.body.nextCursor).toBeNull();
  });

  it('walks 95 brands with ties and unranked ones without repeat or gap, in order', async () => {
    await loader.load(mixed(95));
    const seen: { id: string; name: string; popularity: number | null }[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const res = await get(cursor ? `?cursor=${cursor}` : '');
      expect(res.status).toBe(200);
      seen.push(...res.body.items);
      cursor = res.body.nextCursor;
      if (!cursor) break;
    }

    expect(seen).toHaveLength(95);
    expect(new Set(seen.map((b) => b.id)).size).toBe(95);
    const rank = (b: { popularity: number | null }) => b.popularity ?? Infinity;
    const sorted = [...seen].sort(
      (a, b) => rank(a) - rank(b) || (a.name < b.name ? -1 : 1),
    );
    expect(seen).toEqual(sorted);
  });

  it('walks a search across pages with the same text', async () => {
    await loader.load(mixed(50));

    const first = await get('?q=brand');
    const second = await get(`?q=brand&cursor=${first.body.nextCursor}`);
    const third = await get(`?q=brand&cursor=${second.body.nextCursor}`);

    expect([first, second, third].map((r) => r.body.items.length)).toEqual([
      20, 20, 10,
    ]);
    expect(third.body.nextCursor).toBeNull();
  });

  it('answers 400 invalid_cursor for a well-formed cursor that names no brand', async () => {
    await loader.load(mixed(3));

    const res = await get(`?cursor=${randomUUID()}`);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'invalid_cursor' });
  });

  it.each(['abc', '123', 'null', '%00', ' '])(
    'answers 400 for the cursor %j',
    async (cursor) => {
      const res = await get(`?cursor=${encodeURIComponent(cursor)}`);

      expect(res.status).toBe(400);
    },
  );

  it('accepts a search of 60 characters and refuses 61', async () => {
    expect((await get(`?q=${'a'.repeat(60)}`)).status).toBe(200);
    expect((await get(`?q=${'a'.repeat(61)}`)).status).toBe(400);
  });

  it('refuses a repeated q, an extra parameter and a limit override', async () => {
    expect((await get('?q=a&q=b')).status).toBe(400);
    expect((await get('?limit=500')).status).toBe(400);
    expect((await get('?q[a]=1')).status).toBe(400);
  });

  it.each(['%', '_', '\\', '(', '[', '.*', "'; DROP TABLE brand;--", '\u0000'])(
    'treats %j as plain text and matches no brand',
    async (q) => {
      await loader.load([
        { key: 'a', name: 'Alfa' },
        { key: 'b', name: 'Bravo' },
      ]);

      const res = await get(`?q=${encodeURIComponent(q)}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ items: [], total: 0 });
    },
  );

  it('returns every brand for an empty or blank search', async () => {
    await loader.load([
      { key: 'a', name: 'Alfa' },
      { key: 'b', name: 'Bravo' },
    ]);

    expect((await get('?q=')).body.total).toBe(2);
    expect((await get('?q=%20%20')).body.total).toBe(2);
  });

  it('finds a brand with accented capitals typed in decomposed form', async () => {
    await loader.load([{ key: 's', name: 'Škoda' }]);

    const res = await get(`?q=${encodeURIComponent('Škoda')}`);

    expect(res.body.items.map((b: { name: string }) => b.name)).toEqual([
      'Škoda',
    ]);
  });

  it('finds Romanian brands by the unaccented letters', async () => {
    await loader.load([{ key: 't', name: 'Țiriac' }]);

    expect((await get('?q=tiri')).body.total).toBe(1);
    expect((await get(`?q=${encodeURIComponent('ȚIR')}`)).body.total).toBe(1);
  });

  it('matches in the middle of a name', async () => {
    await loader.load([{ key: 'm', name: 'Mercedes-Benz' }]);

    expect((await get('?q=benz')).body.total).toBe(1);
  });

  it('shows a rename on the next search though the list was cached', async () => {
    await loader.load([{ key: 'm', name: 'Mercedes' }]);
    await get();

    await loader.load([{ key: 'm', name: 'Mercedes-Benz' }]);

    expect((await get()).body.items[0]).toMatchObject({
      name: 'Mercedes-Benz',
      slug: 'mercedes-benz',
    });
  });

  it('stops returning a brand on the next search once it is retired', async () => {
    await loader.load([
      { key: 'a', name: 'Alfa' },
      { key: 'b', name: 'Bravo' },
    ]);
    await get('?q=alfa');

    await loader.load([{ key: 'b', name: 'Bravo' }]);

    expect((await get('?q=alfa')).body).toEqual({
      items: [],
      nextCursor: null,
      total: 0,
    });
  });

  it('answers 400 invalid_cursor for a cursor whose brand was retired meanwhile', async () => {
    await loader.load(mixed(30));
    const first = await get();
    const cursor = first.body.nextCursor;
    const retired = first.body.items.at(-1).id;
    const key = (
      await prisma.brand.findUniqueOrThrow({ where: { id: retired } })
    ).key;

    await loader.load(mixed(30).filter((b) => b.key !== key));
    const res = await get(`?cursor=${cursor}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('recovers when the cache holds text that is not a brand list', async () => {
    await loader.load([{ key: 'a', name: 'Alfa' }]);
    await redis.set('brands:active', 'not json');

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it.each([
    ['an object', '{}'],
    ['a string', '"x"'],
    ['a number', '1'],
  ])(
    'recovers when the cache holds JSON that is %s, not a list',
    async (_, text) => {
      await loader.load([{ key: 'a', name: 'Alfa' }]);
      await redis.set('brands:active', text);

      const res = await get();

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
    },
  );

  it('keeps the cache for about an hour', async () => {
    await loader.load([{ key: 'a', name: 'Alfa' }]);
    await get();

    const ttl = await redis.ttl('brands:active');

    expect(ttl).toBeGreaterThan(3500);
    expect(ttl).toBeLessThanOrEqual(3600);
  });

  it('serves a visitor who sends a malformed bearer token', async () => {
    await loader.load([{ key: 'a', name: 'Alfa' }]);

    const res = await get().set('Authorization', 'Bearer garbage');

    expect(res.status).toBe(200);
  });

  it('exposes only id, name, slug and popularity on an item', async () => {
    await loader.load([{ key: 'a', name: 'Alfa', popularity: 1 }]);

    const res = await get();

    expect(Object.keys(res.body.items[0]).sort()).toEqual([
      'id',
      'name',
      'popularity',
      'slug',
    ]);
  });
});
