import { randomUUID } from 'node:crypto';

import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../notifications/notifications.testing';
import { ROUTE_LIMITS } from '../../rate-limit/rate-limit.config';
import { SearchModule } from '../search.module';

const redisUrl = redisUrlFor(3);
const { prisma } = fixtures();
const store = new Redis(redisUrl);
serialDatabase(databaseUrl);

const NEAR = '46.771,23.624';
const BBOX = '46.721,23.524,47.121,23.724';

let app: INestApplication;
let dacia: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret: 'test' }),
      SearchModule,
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
});

beforeEach(async () => {
  const counts = await store.keys(`${ROUTE_LIMITS.search.key}:*`);
  if (counts.length) await store.del(...counts);
  await prisma.$executeRawUnsafe('TRUNCATE brand, garage, search_log CASCADE');
  dacia = (
    await prisma.brand.create({
      data: { key: 'dacia', name: 'Dacia', slug: 'dacia' },
    })
  ).id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await store.quit();
});

const search = (query: Record<string, string>) =>
  request(app.getHttpServer()).get('/search/garages').query(query);

type Spec = {
  dLat?: number | null;
  labour?: number | null;
  rating?: number | null;
  reviews?: number;
  stance?: 'works_on' | 'does_not_take';
  radiusKm?: number;
};

async function garage(name: string, spec: Spec = {}) {
  const { dLat = 0.01, labour = null, rating = null, reviews = 0 } = spec;
  const created = await prisma.garage.create({
    data: {
      labourFromBani: labour,
      name,
      rating,
      reviewCount: reviews,
      slug: `g-${randomUUID()}`,
      status: 'approved',
      ...(dLat !== null && { latitude: 46.771 + dLat, longitude: 23.624 }),
      ...(spec.radiusKm !== undefined && {
        businessKind: 'mobile' as const,
        seatAddress: 'Strada Sediului 1, Cluj-Napoca',
        serviceRadiusKm: spec.radiusKm,
      }),
    },
  });
  const stance = spec.stance ?? 'works_on';
  await prisma.garageBrand.create({
    data: {
      brandId: dacia,
      garageId: created.id,
      stance,
      ...(stance === 'does_not_take' && {
        diesel: false,
        electric: false,
        hybrid: false,
        petrol: false,
      }),
    },
  });
  return created.id;
}

const pad = (n: number) => String(n).padStart(3, '0');
const names = (res: request.Response) =>
  res.body.items.map((i: { name: string }) => i.name);

async function readAll(
  query: Record<string, string>,
  between?: (page: number) => Promise<void>,
) {
  const out: string[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i += 1) {
    const res = await search({
      brand: 'dacia',
      ...query,
      ...(cursor ? { cursor } : {}),
    });
    expect(res.status).toBe(200);
    out.push(...names(res));
    if (res.body.nextCursor === null) {
      return out;
    }
    cursor = res.body.nextCursor;
    await between?.(i);
  }
  throw new Error('paging did not end');
}

const decode = (cursor: string) =>
  JSON.parse(Buffer.from(cursor, 'base64url').toString());
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
const encodeRaw = (json: string) => Buffer.from(json).toString('base64url');

async function firstCursor(query: Record<string, string>) {
  const res = await search({ brand: 'dacia', ...query });
  expect(res.status).toBe(200);
  return res.body.nextCursor as string;
}

describe('sort cursors under attack', () => {
  beforeEach(async () => {
    for (let i = 0; i < 25; i += 1) {
      await garage(`G${pad(i)}`, { dLat: 0.001 * (i + 1), labour: 1000 + i });
    }
  });

  it.each([
    ['distance', 'rating', { sort: 'distance' }, {}],
    ['distance', 'price', { sort: 'distance' }, { sort: 'price' }],
    ['price', 'distance', { sort: 'price' }, { sort: 'distance' }],
    ['price', 'rating', { sort: 'price' }, { sort: 'rating' }],
    ['rating', 'price', { sort: 'rating' }, { sort: 'price' }],
    ['rating', 'distance', {}, { sort: 'distance' }],
  ])(
    'refuses a %s cursor replayed under %s',
    async (_from, _to, issued, replayed) => {
      const cursor = await firstCursor({ near: NEAR, ...issued });

      const res = await search({
        brand: 'dacia',
        cursor,
        near: NEAR,
        ...replayed,
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_cursor');
    },
  );

  it('refuses a distance cursor that also carries a rate', async () => {
    const cursor = decode(await firstCursor({ near: NEAR, sort: 'distance' }));

    const res = await search({
      brand: 'dacia',
      cursor: encode({ ...cursor, p: 1000 }),
      near: NEAR,
      sort: 'distance',
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('refuses a price cursor that also carries a distance', async () => {
    const cursor = decode(await firstCursor({ near: NEAR, sort: 'price' }));

    const res = await search({
      brand: 'dacia',
      cursor: encode({ ...cursor, d: 100 }),
      near: NEAR,
      sort: 'price',
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('refuses a sort cursor with its sort removed', async () => {
    const { s, ...rest } = decode(
      await firstCursor({ near: NEAR, sort: 'price' }),
    );

    const res = await search({
      brand: 'dacia',
      cursor: encode(rest),
      near: NEAR,
      sort: 'price',
    });

    expect(s).toBe('price');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('refuses a sort cursor naming a sort the search does not know', async () => {
    const cursor = decode(await firstCursor({ near: NEAR, sort: 'price' }));

    const res = await search({
      brand: 'dacia',
      cursor: encode({ ...cursor, s: 'newest' }),
      near: NEAR,
      sort: 'price',
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it.each([
    ['negative', '-1'],
    ['a string', '"12"'],
    ['the word NaN', '"NaN"'],
    ['null', 'null'],
    ['a number too large for float8', '1e999'],
    ['larger than the Earth', '1e30'],
    ['an array', '[1]'],
    ['an object', '{"a":1}'],
    ['a boolean', 'true'],
  ])('refuses a distance boundary that is %s', async (_, d) => {
    const cursor = await firstCursor({ near: NEAR, sort: 'distance' });
    const json = JSON.stringify(decode(cursor)).replace(
      /"d":[^,}]+/,
      `"d":${d}`,
    );

    const res = await search({
      brand: 'dacia',
      cursor: encodeRaw(json),
      near: NEAR,
      sort: 'distance',
    });

    expect(json).toContain(`"d":${d}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it.each([
    ['over INT4', '2147483648'],
    ['negative', '-1'],
    ['fractional', '1.5'],
    ['a string', '"1000"'],
    ['a float exponent', '1e30'],
    ['an array', '[1000]'],
  ])('refuses a rate boundary that is %s', async (_, p) => {
    const cursor = await firstCursor({ near: NEAR, sort: 'price' });
    const json = JSON.stringify(decode(cursor)).replace(
      /"p":[^,}]+/,
      `"p":${p}`,
    );

    const res = await search({
      brand: 'dacia',
      cursor: encodeRaw(json),
      near: NEAR,
      sort: 'price',
    });

    expect(json).toContain(`"p":${p}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('refuses a distance cursor of the circle search inside a box', async () => {
    const cursor = await firstCursor({ near: NEAR, sort: 'distance' });

    const res = await search({
      bbox: BBOX,
      brand: 'dacia',
      cursor,
      near: NEAR,
      sort: 'distance',
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });
});

describe('sorting with ties', () => {
  it('pages 45 garages at the same distance with no repeat and no skip', async () => {
    for (let i = 0; i < 45; i += 1) {
      await garage(`T${pad(i)}`, {
        dLat: 0.02,
        rating: i % 3 === 0 ? 4 : null,
        reviews: i % 3 === 0 ? i + 1 : 0,
      });
    }

    const all = await readAll({ near: NEAR, sort: 'distance' });

    expect(all).toHaveLength(45);
    expect(new Set(all).size).toBe(45);
  });

  it('breaks an equal distance by rating, then reviews, then name', async () => {
    await garage('Zed', { dLat: 0.02, rating: 5, reviews: 1 });
    await garage('Bun', { dLat: 0.02, rating: 4.5, reviews: 9 });
    await garage('Ana', { dLat: 0.02, rating: 4.5, reviews: 9 });
    await garage('Mai', { dLat: 0.02, rating: 4.5, reviews: 20 });
    await garage('Nou', { dLat: 0.02 });

    const res = await search({
      brand: 'dacia',
      near: NEAR,
      sort: 'distance',
    });

    expect(names(res)).toEqual(['Zed', 'Mai', 'Ana', 'Bun', 'Nou']);
  });

  it('pages 45 garages at the same rate with no repeat and no skip', async () => {
    for (let i = 0; i < 45; i += 1) {
      await garage(`R${pad(i)}`, {
        labour: 5000,
        rating: 3 + (i % 3),
        reviews: 1,
      });
    }

    const all = await readAll({ sort: 'price' });

    expect(all).toHaveLength(45);
    expect(new Set(all).size).toBe(45);
  });

  it('keeps both groups in order across pages under every sort', async () => {
    for (let i = 0; i < 15; i += 1) {
      await garage(`A${pad(i)}`, { dLat: 0.2 - i * 0.01, labour: 9000 - i });
      await garage(`B${pad(i)}`, {
        dLat: 0.001 * (i + 1),
        labour: 100 + i,
        stance: 'does_not_take',
      });
    }

    for (const sort of ['rating', 'distance', 'price']) {
      const all = await readAll({ near: NEAR, sort });
      const firstRefuser = all.findIndex((n) => n.startsWith('B'));
      expect(all).toHaveLength(30);
      expect(firstRefuser).toBe(15);
      expect(all.slice(0, 15).every((n) => n.startsWith('A'))).toBe(true);
    }
  });

  it('continues the price order when a rate changes between pages', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 45; i += 1) {
      ids.push(await garage(`P${pad(i)}`, { labour: 1000 + i * 10 }));
    }

    const all = await readAll({ sort: 'price' }, async (page) => {
      if (page === 0) {
        await prisma.garage.update({
          data: { labourFromBani: 1 },
          where: { id: ids[5] },
        });
        await prisma.garage.update({
          data: { labourFromBani: 99999 },
          where: { id: ids[30] },
        });
      }
    });

    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBeGreaterThanOrEqual(44);
    expect(all.slice(20).filter((n) => n !== 'P030')).toEqual(
      all
        .slice(20)
        .filter((n) => n !== 'P030')
        .sort(),
    );
  });
});

describe('sorting by price', () => {
  it('lists a rate of 0 first and no rate last, with the exact bani deciding', async () => {
    await garage('Nimic', { labour: null });
    await garage('Zero', { labour: 0 });
    await garage('Doi', { labour: 5001 });
    await garage('Unu', { labour: 5000 });

    const res = await search({ brand: 'dacia', sort: 'price' });

    expect(names(res)).toEqual(['Zero', 'Unu', 'Doi', 'Nimic']);
  });

  it('puts every garage without a rate after every garage with one, on later pages too', async () => {
    for (let i = 0; i < 30; i += 1) {
      await garage(`N${pad(i)}`, { labour: null, rating: 5, reviews: 100 });
    }
    for (let i = 0; i < 30; i += 1) {
      await garage(`Y${pad(i)}`, { labour: i % 2 });
    }

    const all = await readAll({ sort: 'price' });

    expect(all).toHaveLength(60);
    expect(all.slice(0, 30).every((n) => n.startsWith('Y'))).toBe(true);
    expect(all.slice(30).every((n) => n.startsWith('N'))).toBe(true);
  });

  it('pages a run of zero rates that straddles the page boundary', async () => {
    for (let i = 0; i < 25; i += 1) {
      await garage(`Z${pad(i)}`, { labour: 0 });
    }
    await garage('Last', { labour: null });

    const all = await readAll({ sort: 'price' });

    expect(all).toHaveLength(26);
    expect(all[25]).toBe('Last');
    expect(new Set(all).size).toBe(26);
  });
});

describe('sorting by distance with a box', () => {
  it('measures from the place, not the box, and keeps the groups', async () => {
    await garage('Far', { dLat: 0.1 });
    await garage('Near', { dLat: 0.01 });
    await garage('Refuser', { dLat: 0.001, stance: 'does_not_take' });
    await garage('Outside', { dLat: 0.9 });

    const res = await search({
      bbox: BBOX,
      brand: 'dacia',
      near: NEAR,
      sort: 'distance',
    });

    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['Near', 'Far', 'Refuser']);
  });

  it('ranks a mobile mechanic by its home base against a garage at 8 km', async () => {
    await garage('Garage8', { dLat: 0.072 });
    await garage('Mobile12', { dLat: 0.108, radiusKm: 30 });
    await garage('Mobile5', { dLat: 0.045, radiusKm: 30 });

    const res = await search({
      brand: 'dacia',
      near: NEAR,
      sort: 'distance',
    });

    expect(names(res)).toEqual(['Mobile5', 'Garage8', 'Mobile12']);
    expect(res.body.items[0].distanceKm).toBeNull();
  });

  it('answers 400 for distance with a box and no place', async () => {
    const res = await search({ bbox: BBOX, brand: 'dacia', sort: 'distance' });

    expect(res.status).toBe(400);
  });

  it('leaves a garage without a position out of a distance list', async () => {
    await garage('Placed', { dLat: 0.01 });
    await garage('Nowhere', { dLat: null });

    const res = await search({ brand: 'dacia', near: NEAR, sort: 'distance' });

    expect(names(res)).toEqual(['Placed']);
  });
});

describe('the search log', () => {
  const logged = async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return prisma.searchLog.count();
  };

  it.each(['rating', 'distance', 'price'])(
    'writes no row for a first page sorted by %s that sends no log',
    async (sort) => {
      await garage('Alfa');

      await search({ brand: 'dacia', near: NEAR, sort }).expect(200);

      expect(await logged()).toBe(0);
    },
  );

  it('still writes one row for a new search that sends log=1', async () => {
    await garage('Alfa');

    await search({ brand: 'dacia', log: '1', near: NEAR }).expect(200);

    expect(await logged()).toBe(1);
  });

  it('writes no row for a later page of a sorted search', async () => {
    for (let i = 0; i < 25; i += 1) {
      await garage(`G${pad(i)}`, { labour: i });
    }
    const cursor = await firstCursor({ sort: 'price' });

    await search({ brand: 'dacia', cursor, sort: 'price' }).expect(200);

    expect(await logged()).toBe(0);
  });
});
