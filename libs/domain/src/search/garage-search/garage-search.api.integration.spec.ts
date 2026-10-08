import { randomUUID } from 'node:crypto';

import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../notifications/notifications.testing';
import { SearchModule } from '../search.module';

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

const search = (query: Record<string, string>) =>
  request(app.getHttpServer()).get('/search/garages').query(query);

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
      counts: { doesNotTake: 0, worksOn: 1 },
      items: [
        {
          brandNote: null,
          doesNotTake: [],
          id: garage.id,
          name: 'Alfa Service',
          refusalPhrase: null,
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

  it('never tells where a mobile mechanic is', async () => {
    await placed('Gama', 0.1, 'works_on', 20);

    const res = await search({ brandId: dacia, near: NEAR });

    const [item] = res.body.items;
    expect(item).toMatchObject({ comesToYou: true, distanceKm: null });
    for (const key of [
      'address',
      'latitude',
      'longitude',
      'seatAddress',
      'serviceRadiusKm',
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
