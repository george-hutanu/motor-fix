import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { SearchModule } from './search.module';
import { AuthModule } from '../auth/auth.module';
import { serialDatabase } from '../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../notifications/notifications.testing';

const redisUrl = redisUrlFor(3);
const { prisma } = fixtures();
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
});

const CLUJ = { lat: 46.771, lng: 23.624 };
const http = () => request(app.getHttpServer());
const search = (query: string) =>
  http().get(`/search/garages?brandId=${dacia}&${query}`);
const home = (query: string) => http().get(`/home?brand=dacia&${query}`);

async function garage(
  name: string,
  where: { lat: number | null; lng?: number },
  extra: Record<string, unknown> = {},
  stance: 'works_on' | 'does_not_take' = 'works_on',
) {
  const row = await prisma.garage.create({
    data: {
      name,
      slug: name.toLowerCase().replace(/ /g, '-'),
      status: 'approved',
      ...(where.lat !== null && {
        latitude: where.lat,
        longitude: where.lng ?? CLUJ.lng,
      }),
      ...extra,
    },
  });
  await prisma.garageBrand.create({
    data: {
      brandId: dacia,
      garageId: row.id,
      stance,
      ...(stance === 'does_not_take' && {
        diesel: false,
        electric: false,
        hybrid: false,
        petrol: false,
      }),
    },
  });
  return row.id;
}

const mobile = (radiusKm: number | null) => ({
  businessKind: 'mobile' as const,
  seatAddress: 'Strada Sediului 1, Cluj-Napoca',
  serviceRadiusKm: radiusKm,
});

describe('a place on the garage search under attack', () => {
  it.each([
    ['two places', 'near=46.771,23.624&near=44.43,26.10'],
    ['a place with a space', 'near=46.771,%2023.624'],
    ['a place with three numbers', 'near=46.771,23.624,1'],
    ['an empty place', 'near='],
    ['a place outside Romania', 'near=47.498,19.040'],
  ])('answers 400 to %s', async (_, query) => {
    const res = await search(query);
    expect(res.status).toBe(400);
  });

  it('answers the same for a place and for the same place at six decimals', async () => {
    for (const dLat of [0.2, 0.2245, 0.2247, 0.2249, 0.2251, 0.2255, 0.23]) {
      await garage(`Ring ${dLat}`, { lat: CLUJ.lat - dLat });
    }
    const rounded = await search('near=46.771,23.624');
    const raw = await search('near=46.7714,23.6236');
    const rawOther = await search('near=46.77051,23.62449');

    expect(rounded.status).toBe(200);
    expect(raw.body).toEqual(rounded.body);
    expect(rawOther.body).toEqual(rounded.body);
  });

  it('keeps a garage 24.9 km away and drops one 25.1 km away', async () => {
    await garage('Inside', { lat: CLUJ.lat - 24.9 / 111.2 });
    await garage('Outside', { lat: CLUJ.lat - 25.1 / 111.2 });

    const res = await search('near=46.771,23.624');

    expect(res.body.items.map((i: { name: string }) => i.name)).toEqual([
      'Inside',
    ]);
    expect(res.body.items[0].distanceKm).toBe(24.9);
  });

  it('puts a garage on the place itself at distance 0', async () => {
    await garage('Here', { lat: CLUJ.lat });
    const res = await search('near=46.771,23.624');
    expect(res.body.items[0]).toMatchObject({
      comesToYou: false,
      distanceKm: 0,
    });
  });

  it('gives a distance with at most one decimal', async () => {
    for (let n = 1; n <= 7; n += 1) {
      await garage(`Far ${n}`, { lat: CLUJ.lat + n * 0.0317 });
    }
    const res = await search('near=46.771,23.624');
    for (const item of res.body.items) {
      expect(Math.round(item.distanceKm * 10)).toBeCloseTo(
        item.distanceKm * 10,
        6,
      );
    }
    expect(res.body.items).toHaveLength(7);
  });

  it('drops a garage with no coordinates and a mobile one with no radius defaults to 20 km', async () => {
    await garage('Nowhere', { lat: null });
    await garage('Default in', { lat: CLUJ.lat + 19.5 / 111.2 }, mobile(null));
    await garage('Default out', { lat: CLUJ.lat + 20.5 / 111.2 }, mobile(null));

    const res = await search('near=46.771,23.624');

    expect(res.body.items.map((i: { name: string }) => i.name).sort()).toEqual([
      'Default in',
    ]);
    expect(res.body.items[0]).toMatchObject({
      comesToYou: true,
      distanceKm: null,
    });
  });

  it('covers a place just inside and just outside a mobile mechanic radius', async () => {
    await garage('Edge in', { lat: CLUJ.lat + 9.9 / 111.2 }, mobile(10));
    await garage('Edge out', { lat: CLUJ.lat + 10.1 / 111.2 }, mobile(10));

    const res = await search('near=46.771,23.624');

    expect(res.body.items.map((i: { name: string }) => i.name)).toEqual([
      'Edge in',
    ]);
  });

  it('keeps a mobile mechanic out of the area when the seat has no coordinates', async () => {
    await garage('Seatless', { lat: null }, mobile(50));
    const res = await search('near=46.771,23.624');
    expect(res.body.total).toBe(0);
    expect(res.body.items).toEqual([]);
  });

  it('answers an empty area with zero counts, no cursor and status 200', async () => {
    await garage('Alfa', { lat: CLUJ.lat + 1 });
    const res = await search('near=46.771,23.624');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      counts: { doesNotTake: 0, worksOn: 0 },
      items: [],
      nextCursor: null,
      total: 0,
    });
  });

  it('answers the same twice', async () => {
    await garage('Alfa', { lat: CLUJ.lat + 0.01 });
    const a = await search('near=46.771,23.624');
    const b = await search('near=46.771,23.624');
    expect(b.body).toEqual(a.body);
  });

  it('never lists a suspended garage in the area', async () => {
    const id = await garage('Alfa', { lat: CLUJ.lat });
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id },
    });
    const res = await search('near=46.771,23.624');
    expect(res.body.total).toBe(0);
  });
});

describe('a place on the Home count under attack', () => {
  it('counts only the area and keeps takers within total', async () => {
    await garage('Near', { lat: CLUJ.lat + 0.05 });
    await garage('Near no', { lat: CLUJ.lat + 0.06 }, {}, 'does_not_take');
    await garage('Far', { lat: CLUJ.lat + 1 });
    await garage('Mobile', { lat: CLUJ.lat + 0.3 }, mobile(35));

    const res = await home('near=46.771,23.624');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ takers: 2, total: 3 });
  });

  it('counts a mobile mechanic on the radius edge from either side only once', async () => {
    await garage('Mobile', { lat: CLUJ.lat + 9.9 / 111.2 }, mobile(10));
    const res = await home('near=46.771,23.624');
    expect(res.body).toMatchObject({ takers: 1, total: 1 });
  });

  it('shares one answer between places that round to the same spot', async () => {
    await garage('Near', { lat: CLUJ.lat + 24.99 / 111.2 });
    const a = await home('near=46.771,23.624');
    const b = await home('near=46.7714,23.6236');
    expect(b.body).toEqual(a.body);
  });

  it.each([
    ['two places', 'near=46.771,23.624&near=44.43,26.10'],
    ['three numbers', 'near=46.771,23.624,1'],
    ['outside Romania', 'near=50,10'],
  ])('answers 400 without a public cache header to %s', async (_, query) => {
    const res = await home(query);
    expect(res.status).toBe(400);
    expect(res.headers['cache-control'] ?? '').not.toContain('public');
  });

  it('keeps the public cache header on a counted area', async () => {
    const res = await home('near=46.771,23.624');
    expect(res.headers['cache-control']).toBe('public, max-age=60');
  });
});
