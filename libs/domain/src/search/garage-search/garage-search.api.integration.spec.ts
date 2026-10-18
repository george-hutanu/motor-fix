import { createHash, randomUUID } from 'node:crypto';

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
  // The API trusts the edge's forwarded address (apps/api bootstrap).
  app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
  // The API's own pipe options (apps/api bootstrap).
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
  // Every case searches from this one machine: no case spends another's count.
  const counts = await store.keys(`${ROUTE_LIMITS.search.key}:*`);
  if (counts.length) await store.del(...counts);
  await prisma.$executeRawUnsafe('TRUNCATE brand, garage CASCADE');
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

// @traces 267-FR-004 267-FR-005 267-FR-006 267-FR-024
describe('GET /search/garages', () => {
  it('answers a visitor without a session with a page of garages', async () => {
    const garage = await prisma.garage.create({
      data: { name: 'Alfa Service', slug: 'alfa-service', status: 'approved' },
    });
    await prisma.garageBrand.create({
      data: { brandId: dacia, garageId: garage.id, stance: 'works_on' },
    });

    const res = await search({ brandId: dacia });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      brand: { id: dacia, name: 'Dacia', slug: 'dacia' },
      counts: { doesNotTake: 0, worksOn: 1 },
      items: [
        {
          brandNote: null,
          businessKind: null,
          doesNotTake: [],
          facilities: [],
          id: garage.id,
          labourFromLei: null,
          name: 'Alfa Service',
          rating: null,
          refusalPhrase: null,
          reviewCount: 0,
          slug: 'alfa-service',
          stance: 'works_on',
          worksOn: [{ id: dacia, name: 'Dacia', slug: 'dacia' }],
        },
      ],
      nextCursor: null,
      total: 1,
    });
  });

  it.each([
    ['no brand', {}],
    ['a brand that is not a uuid', { brandId: 'dacia' }],
    ['a slug and an id together', { brand: 'dacia', brandId: randomUUID() }],
    ['a slug with capitals', { brand: 'Dacia' }],
    ['an unknown parameter', { brandId: randomUUID(), sort: 'rating' }],
    [
      'a cursor over 200 characters',
      { brandId: randomUUID(), cursor: 'a'.repeat(201) },
    ],
  ])('answers 400 to %s', async (_, query) => {
    expect((await search(query)).status).toBe(400);
  });

  it('gives a next page for garages with long names', async () => {
    for (let n = 0; n < 21; n += 1) {
      await prisma.garage.create({
        data: {
          name: `${'Service Auto Bucuresti Nord '.repeat(4)}${n}`,
          slug: `long-${n}`,
          status: 'approved',
        },
      });
    }

    const first = await search({ brandId: dacia });
    const second = await search({
      brandId: dacia,
      cursor: first.body.nextCursor,
    });

    expect(second.status).toBe(200);
    expect(second.body.items).toHaveLength(1);
  });

  it('answers 400 invalid_cursor to a cursor it did not give', async () => {
    const res = await search({ brandId: dacia, cursor: 'not-a-cursor' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  // @traces 267-FR-004
  it('finds the brand by its slug and names it in the answer', async () => {
    const res = await search({ brand: 'dacia' });

    expect(res.status).toBe(200);
    expect(res.body.brand).toEqual({ id: dacia, name: 'Dacia', slug: 'dacia' });
  });

  it('answers 404 not_found to a slug that names no brand', async () => {
    const res = await search({ brand: 'trabant' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('answers 400 to a repeated brand key', async () => {
    const res = await request(app.getHttpServer()).get(
      '/search/garages?brand=dacia&brand=bmw',
    );

    expect(res.status).toBe(400);
  });

  it('answers 404 not_found to a brand that does not exist', async () => {
    const res = await search({ brandId: randomUUID() });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });
});

// Cluj-Napoca; a hundredth of a degree of latitude is about 1.1 km.
const CLUJ = { lat: 46.771, lng: 23.624 };
const NEAR = '46.771,23.624';

async function placed(
  name: string,
  dLat: number | null,
  stance?: 'works_on' | 'does_not_take',
  radiusKm?: number,
) {
  const garage = await prisma.garage.create({
    data: {
      name,
      slug: name.toLowerCase().replace(/ /g, '-'),
      status: 'approved',
      ...(dLat !== null && {
        latitude: CLUJ.lat + dLat,
        longitude: CLUJ.lng,
      }),
      ...(radiusKm !== undefined && {
        businessKind: 'mobile' as const,
        seatAddress: 'Strada Sediului 1, Cluj-Napoca',
        serviceRadiusKm: radiusKm,
      }),
    },
  });
  if (stance) {
    await prisma.garageBrand.create({
      data: {
        brandId: dacia,
        garageId: garage.id,
        stance,
        ...(stance === 'does_not_take' && {
          diesel: false,
          electric: false,
          hybrid: false,
          petrol: false,
        }),
      },
    });
  }
  return garage.id;
}

describe('GET /search/garages near a place', () => {
  it('lists and counts only the garages in the area, with their distance', async () => {
    await placed('Alfa', 0.01, 'works_on');
    await placed('Beta', 0.1, 'does_not_take');
    await placed('Gama', 0.27, 'works_on', 35);
    await placed('Delta', 0.27, 'works_on', 20);
    await placed('Epsilon', 0.5, 'works_on');
    await placed('Zeta', null, 'works_on');

    const res = await search({ brandId: dacia, near: NEAR });

    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ doesNotTake: 1, worksOn: 2 });
    expect(res.body.total).toBe(3);
    expect(
      res.body.items.map(
        ({ comesToYou, distanceKm, name }: Record<string, unknown>) => ({
          comesToYou,
          distanceKm,
          name,
        }),
      ),
    ).toEqual([
      { comesToYou: false, distanceKm: 1.1, name: 'Alfa' },
      { comesToYou: true, distanceKm: null, name: 'Gama' },
      { comesToYou: false, distanceKm: 11.1, name: 'Beta' },
    ]);
  });

  // @traces 267-FR-003
  it('never tells where a mobile mechanic is, only how far it travels', async () => {
    await placed('Gama', 0.1, 'works_on', 20);

    const res = await search({ brandId: dacia, near: NEAR });

    const [item] = res.body.items;
    expect(item).toMatchObject({
      businessKind: 'mobile',
      comesToYou: true,
      distanceKm: null,
      serviceRadiusKm: 20,
    });
    for (const key of [
      'address',
      'city',
      'latitude',
      'longitude',
      'seatAddress',
    ]) {
      expect(item).not.toHaveProperty(key);
    }
    expect(JSON.stringify(res.body)).not.toContain('Sediului');
  });

  it('carries neither distance nor "comes to you" without a place', async () => {
    await placed('Alfa', 0.01, 'works_on');
    await placed('Gama', 0.1, 'works_on', 20);

    const res = await search({ brandId: dacia });

    expect(res.body.total).toBe(2);
    for (const item of res.body.items) {
      expect(item).not.toHaveProperty('distanceKm');
      expect(item).not.toHaveProperty('comesToYou');
    }
  });

  it('pages the area 20 at a time, and takes a cursor from a search without a place', async () => {
    for (let n = 0; n < 22; n += 1) {
      await placed(`Service ${String(n).padStart(2, '0')}`, 0.01, 'works_on');
    }
    await placed('Service far', 0.5, 'works_on');

    const first = await search({ brandId: dacia, near: NEAR });
    const second = await search({
      brandId: dacia,
      cursor: first.body.nextCursor,
      near: NEAR,
    });
    const plain = await search({ brandId: dacia });
    const mixed = await search({
      brandId: dacia,
      cursor: plain.body.nextCursor,
      near: NEAR,
    });

    expect(first.body.items).toHaveLength(20);
    expect(first.body.total).toBe(22);
    expect(second.body.items.map((i: { name: string }) => i.name)).toEqual([
      'Service 20',
      'Service 21',
    ]);
    expect(second.body.nextCursor).toBeNull();
    expect(mixed.status).toBe(200);
    expect(mixed.body.items.map((i: { name: string }) => i.name)).toEqual([
      'Service 20',
      'Service 21',
    ]);
  });

  it('answers 400 to a place outside Romania', async () => {
    const res = await search({ brandId: dacia, near: '47.498,19.040' });

    expect(res.status).toBe(400);
  });
});

// @traces 267-FR-005
describe('GET /search/garages with a radius', () => {
  it('widens to 50 km for fixed garages and refuses any other radius', async () => {
    await placed('Alfa', 0.01, 'works_on');
    await placed('Beta', 0.3, 'works_on');

    const wide = await search({ brandId: dacia, near: NEAR, radius: '50' });
    const odd = await search({ brandId: dacia, near: NEAR, radius: '30' });
    const plain = await search({ brandId: dacia, near: NEAR, radius: '25' });

    expect(wide.body.items.map((i: { name: string }) => i.name)).toEqual([
      'Alfa',
      'Beta',
    ]);
    expect(plain.body.total).toBe(1);
    expect(odd.status).toBe(400);
  });

  it('is never kept by a cache on the way', async () => {
    const res = await search({ brandId: dacia });

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

// @traces 267-FR-006
describe('GET /search/garages with ids', () => {
  it('answers a visitor the public garages among the ids, in the order of the search, with its counts', async () => {
    const alfa = await placed('Alfa', 0.01, 'works_on');
    const beta = await placed('Beta', 0.01, 'does_not_take');
    await placed('Gama', 0.01, 'works_on');
    const hidden = await prisma.garage.create({
      data: { name: 'Delta', slug: 'delta', status: 'suspended' },
    });

    const res = await search({
      brand: 'dacia',
      ids: [beta, hidden.id, randomUUID(), alfa].join(','),
    });

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([
      alfa,
      beta,
    ]);
    expect(res.body).toMatchObject({
      counts: { doesNotTake: 1, worksOn: 2 },
      nextCursor: null,
      total: 3,
    });
  });

  it('refuses 21 ids and an id that is not a uuid', async () => {
    const many = Array.from({ length: 21 }, () => randomUUID()).join(',');

    const tooMany = await search({ brandId: dacia, ids: many });
    const bad = await search({ brandId: dacia, ids: 'alfa' });

    expect(tooMany.status).toBe(400);
    expect(bad.status).toBe(400);
  });
});

// From just south of Cluj to 0.35° north of it, 0.2° wide.
const BBOX = '46.721,23.524,47.121,23.724';

// @traces 269-FR-005
// @traces 269-FR-006
// @traces 269-FR-021
describe('GET /search/garages with a box', () => {
  it('lists the fixed garages in the box with their distance from the place, and the mobile mechanics over it', async () => {
    await placed('Alfa', 0.01, 'works_on');
    await placed('Beta', 0.3, 'does_not_take');
    await placed('Gama', 0.5, 'works_on');
    await placed('Mobil', 0.3, 'works_on', 35);

    const res = await search({ bbox: BBOX, brandId: dacia, near: NEAR });

    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { name: string }) => i.name)).toEqual([
      'Alfa',
      'Mobil',
      'Beta',
    ]);
    expect(res.body).toMatchObject({
      counts: { doesNotTake: 1, worksOn: 2 },
      total: 3,
    });
    expect(res.body.items[0].distanceKm).toBe(1.1);
  });

  it('writes no search log row for log=1 with a box', async () => {
    await placed('Alfa', 0.01, 'works_on');

    await search({ bbox: BBOX, brandId: dacia, log: '1', near: NEAR }).expect(
      200,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await prisma.searchLog.count()).toBe(0);
  });

  it('answers 400 invalid_cursor to a cursor of the circle search', async () => {
    for (let n = 0; n < 21; n += 1) {
      await placed(`Service ${String(n).padStart(2, '0')}`, 0.01, 'works_on');
    }
    const circle = await search({ brandId: dacia, near: NEAR });

    const res = await search({
      bbox: BBOX,
      brandId: dacia,
      cursor: circle.body.nextCursor,
      near: NEAR,
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it("reads the cards shown again with the box's counts", async () => {
    const alfa = await placed('Alfa', 0.01, 'works_on');
    await placed('Beta', 0.3, 'works_on');

    const res = await search({
      bbox: BBOX,
      brandId: dacia,
      ids: alfa,
      near: NEAR,
    });

    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([alfa]);
    expect(res.body.total).toBe(2);
  });

  it.each([
    ['wider than 100 km', '46.0,23.0,47.0,24.5'],
    ['outside Romania', '47.0,19.0,47.2,19.2'],
    ['with its corners inverted', '47.121,23.724,46.721,23.524'],
    ['of three numbers', '46.721,23.524,47.121'],
  ])('answers 400 to a box %s', async (_, bbox) => {
    const res = await search({ bbox, brandId: dacia });

    expect(res.status).toBe(400);
  });
});

// @traces 1181-FR-001
// @traces 1181-FR-003
// @traces 1181-FR-004
// @traces 1181-FR-011
describe('GET /search/garages past its limit', () => {
  const { key, limit, windowSeconds } = ROUTE_LIMITS.search;
  const ADDRESS = '198.51.100.23';
  const countOf = (address: string) =>
    `${key}:${createHash('sha256').update(address).digest('hex')}`;
  const from = (address: string, query: Record<string, string>) =>
    search(query).set('X-Forwarded-For', address);
  // Brings the address to `used` calls in the window without making them.
  const used = (address: string, calls: number) =>
    store.set(countOf(address), calls, 'EX', windowSeconds);
  const logged = async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return prisma.searchLog.count();
  };

  beforeEach(() => prisma.$executeRawUnsafe('TRUNCATE search_log'));

  it('counts a logged search like any other, then refuses the next with the wait and writes no log row', async () => {
    await placed('Alfa', 0.01, 'works_on');
    await used(ADDRESS, limit - 1);

    await from(ADDRESS, { brandId: dacia, log: '1', near: NEAR }).expect(200);
    expect(await logged()).toBe(1);
    const refused = await from(ADDRESS, {
      brandId: dacia,
      log: '1',
      near: NEAR,
    }).expect(429);

    expect(refused.body.code).toBe('rate_limited');
    expect(refused.body.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(refused.body.retryAfterSeconds).toBeLessThanOrEqual(windowSeconds);
    expect(await logged()).toBe(1);
  });

  it('admits the address again once its window is over', async () => {
    await used(ADDRESS, limit);
    await from(ADDRESS, { brandId: dacia }).expect(429);

    await store.del(countOf(ADDRESS));

    await from(ADDRESS, { brandId: dacia }).expect(200);
  });

  it('never refuses a second address for the first one’s count', async () => {
    await used(ADDRESS, limit);

    await from('198.51.100.24', { brandId: dacia }).expect(200);
  });

  it('spends no count on a search the validation refuses', async () => {
    await from(ADDRESS, { brand: 'dacia', brandId: dacia }).expect(400);

    expect(await store.get(countOf(ADDRESS))).toBeNull();
  });
});
