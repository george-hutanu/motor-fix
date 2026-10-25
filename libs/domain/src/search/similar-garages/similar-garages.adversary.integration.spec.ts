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

const POINT = { lat: 44.4268, lng: 26.1025 };
// Metres per degree of latitude on the sphere the area is measured on.
const METRES_PER_DEGREE = (6_371_008.8 * Math.PI) / 180;
const north = (km: number) => ({
  latitude: POINT.lat + (km * 1000) / METRES_PER_DEGREE,
  longitude: POINT.lng,
});

let app: INestApplication;
let bmw: { id: string; name: string; slug: string };
let dacia: { id: string; name: string; slug: string };
let audi: { id: string; name: string; slug: string };

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
  const brand = (key: string, name: string, popularity: number | null) =>
    prisma.brand.create({
      data: { key, name, popularity, slug: key },
      select: { id: true, name: true, slug: true },
    });
  bmw = await brand('bmw', 'BMW', 2);
  dacia = await brand('dacia', 'Dacia', 1);
  audi = await brand('audi', 'Audi', null);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

type Seed = {
  slug: string;
  status?: 'draft' | 'approved' | 'suspended';
  km?: number;
  mobileRadiusKm?: number;
  rating?: number;
  reviews?: number;
  worksOn?: { id: string }[];
  refuses?: { id: string }[];
};

async function garage({
  slug,
  status = 'approved',
  km,
  mobileRadiusKm,
  rating,
  reviews = 0,
  worksOn = [],
  refuses = [],
}: Seed) {
  const { id } = await prisma.garage.create({
    data: {
      name: slug,
      slug,
      status,
      ...(km !== undefined && north(km)),
      ...(rating !== undefined && { rating, reviewCount: reviews }),
      ...(mobileRadiusKm !== undefined && {
        businessKind: 'mobile' as const,
        seatAddress: 'Strada Sediului 1, București',
        serviceRadiusKm: mobileRadiusKm,
      }),
    },
  });
  for (const brand of worksOn) {
    await prisma.garageBrand.create({
      data: { brandId: brand.id, garageId: id, stance: 'works_on' },
    });
  }
  for (const brand of refuses) {
    await prisma.garageBrand.create({
      data: {
        brandId: brand.id,
        diesel: false,
        electric: false,
        garageId: id,
        hybrid: false,
        petrol: false,
        stance: 'does_not_take',
      },
    });
  }
  return id;
}

const similar = (slug: string, query: Record<string, string> = {}) =>
  request(app.getHttpServer()).get(`/garages/${slug}/similar`).query(query);

const slugs = (res: request.Response) =>
  (res.body.items as { slug: string }[]).map((item) => item.slug);

// @traces 385-FR-012 385-FR-013
describe('GET /garages/:slug/similar under hostile requests', () => {
  it.each([
    ['an empty brand', '?brand='],
    ['a brand of 81 characters', `?brand=${'a'.repeat(81)}`],
    ['a brand with a space', '?brand=b%20mw'],
    ['a brand with unicode', '?brand=b%C3%A4mw'],
    ['a brand given twice', '?brand=bmw&brand=dacia'],
    ['a brand as an object', '?brand[a]=bmw'],
    ['an unknown parameter beside a good brand', '?brand=bmw&src=share'],
  ])('answers 400 to %s', async (_, qs) => {
    await garage({ km: 0, slug: 'old', status: 'suspended', worksOn: [bmw] });

    const res = await request(app.getHttpServer()).get(
      `/garages/old/similar${qs}`,
    );

    expect(res.status).toBe(400);
    expect(res.body.items).toBeUndefined();
  });

  it('answers 404 for a brand of exactly 80 valid characters that names no brand', async () => {
    await garage({ km: 0, slug: 'old', status: 'suspended', worksOn: [bmw] });

    const res = await similar('old', { brand: 'a'.repeat(80) });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it.each([
    ['capitals', 'OLD'],
    ['a trailing space', 'old%20'],
    ['unicode', '%C3%B6ld'],
    ['an encoded slash', 'old%2F..%2Fx'],
    ['a long slug', 'a'.repeat(5000)],
  ])('answers 404 to a slug with %s', async (_, slug) => {
    await garage({ km: 0, slug: 'old', status: 'suspended', worksOn: [bmw] });

    const res = await request(app.getHttpServer()).get(
      `/garages/${slug}/similar`,
    );

    expect(res.status).toBe(404);
    expect(res.body.items).toBeUndefined();
  });

  it('answers 404 to a POST', async () => {
    await garage({ km: 0, slug: 'old', status: 'suspended', worksOn: [bmw] });

    const res = await request(app.getHttpServer()).post('/garages/old/similar');

    expect(res.status).toBe(404);
  });

  it('keeps no-store on a refusal too', async () => {
    const res = await similar('nobody');

    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('answers the asked brand even when the old garage never worked on it', async () => {
    await garage({ km: 0, slug: 'old', status: 'suspended', worksOn: [dacia] });
    await garage({ km: 1, slug: 'near', worksOn: [bmw] });

    const res = await similar('old', { brand: 'bmw' });

    expect(res.status).toBe(200);
    expect(slugs(res)).toEqual(['near']);
  });

  it('answers an empty list with no brand when the old garage worked on none', async () => {
    await garage({ km: 0, refuses: [bmw], slug: 'old', status: 'suspended' });
    await garage({ km: 1, slug: 'near', worksOn: [bmw] });

    const res = await similar('old');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ brand: null, items: [] });
  });

  it('keeps a garage at 24.9 km and drops one at 25.1 km', async () => {
    await garage({ km: 0, slug: 'old', status: 'suspended', worksOn: [bmw] });
    await garage({ km: 24.9, slug: 'inside', worksOn: [bmw] });
    await garage({ km: 25.1, slug: 'outside', worksOn: [bmw] });

    const res = await similar('old', { brand: 'bmw' });

    expect(slugs(res)).toEqual(['inside']);
  });

  it('lists a garage once when it works on every brand of the old garage', async () => {
    await garage({
      km: 0,
      slug: 'old',
      status: 'suspended',
      worksOn: [bmw, dacia, audi],
    });
    await garage({ km: 1, slug: 'all', worksOn: [audi, dacia, bmw] });

    const res = await similar('old');

    expect(slugs(res)).toEqual(['all']);
    expect(res.body.items[0].brand).toEqual(dacia);
  });

  it('puts a garage that works on a brand after the one that does not take it out entirely, and an unrated one last', async () => {
    await garage({ km: 0, slug: 'old', status: 'suspended', worksOn: [bmw] });
    await garage({ km: 1, slug: 'unrated', worksOn: [bmw] });
    await garage({
      km: 1,
      rating: 2.0,
      reviews: 1,
      slug: 'low',
      worksOn: [bmw],
    });
    await garage({
      km: 1,
      rating: 4.0,
      reviews: 1,
      slug: 'high',
      worksOn: [bmw],
    });

    const res = await similar('old', { brand: 'bmw' });

    expect(slugs(res)).toEqual(['high', 'low', 'unrated']);
  });

  it('answers the same twice and changes nothing between', async () => {
    await garage({ km: 0, slug: 'old', status: 'suspended', worksOn: [bmw] });
    await garage({ km: 1, slug: 'near', worksOn: [bmw] });
    const before = await prisma.garage.count();

    const first = await similar('old', { brand: 'bmw' });
    const second = await similar('old', { brand: 'bmw' });

    expect(second.body).toEqual(first.body);
    expect(await prisma.garage.count()).toBe(before);
  });

  it('stops answering once the garage is approved again', async () => {
    const id = await garage({
      km: 0,
      slug: 'old',
      status: 'suspended',
      worksOn: [bmw],
    });
    await similar('old', { brand: 'bmw' }).expect(200);

    await prisma.garage.update({ data: { status: 'approved' }, where: { id } });

    await similar('old', { brand: 'bmw' }).expect(404);
  });

  it('never lists a suspended mobile mechanic nor a draft one whose area covers the place', async () => {
    await garage({ km: 0, slug: 'old', status: 'suspended', worksOn: [bmw] });
    await garage({
      km: 10,
      mobileRadiusKm: 50,
      slug: 'mobile-draft',
      status: 'draft',
      worksOn: [bmw],
    });
    await garage({
      km: 10,
      mobileRadiusKm: 50,
      slug: 'mobile-suspended',
      status: 'suspended',
      worksOn: [bmw],
    });

    const res = await similar('old', { brand: 'bmw' });

    expect(res.body.items).toEqual([]);
  });

  it('carries no coordinates, seat address or radius of a mobile mechanic', async () => {
    await garage({ km: 0, slug: 'old', status: 'suspended', worksOn: [bmw] });
    await garage({
      km: 30,
      mobileRadiusKm: 40,
      slug: 'mobile',
      worksOn: [bmw],
    });

    const res = await similar('old', { brand: 'bmw' });

    const text = JSON.stringify(res.body.items[0]);
    expect(text).not.toContain('seatAddress');
    expect(text).not.toContain('Strada Sediului');
    expect(text).not.toContain('latitude');
    expect(text).not.toContain('longitude');
  });
});
