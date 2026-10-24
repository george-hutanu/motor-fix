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

// @traces 385-FR-012 385-FR-013 385-FR-016
describe('GET /garages/:slug/similar', () => {
  it('answers a visitor with at most 3 approved garages nearby that work on the brand, in the search order', async () => {
    await garage({ km: 0, slug: 'old', status: 'suspended', worksOn: [bmw] });
    await garage({
      km: 2,
      rating: 4.9,
      reviews: 10,
      slug: 'best',
      worksOn: [bmw],
    });
    await garage({
      km: 1,
      rating: 4.5,
      reviews: 10,
      slug: 'good',
      worksOn: [bmw],
    });
    await garage({
      km: 3,
      rating: 4.5,
      reviews: 20,
      slug: 'busier',
      worksOn: [bmw],
    });
    await garage({
      km: 4,
      rating: 3.0,
      reviews: 5,
      slug: 'fourth',
      worksOn: [bmw],
    });

    const res = await similar('old', { brand: 'bmw' });

    expect(res.status).toBe(200);
    expect(res.body.brand).toEqual(bmw);
    expect(slugs(res)).toEqual(['best', 'busier', 'good']);
    expect(res.body.items[0]).toMatchObject({
      brand: bmw,
      comesToYou: false,
      name: 'best',
      stance: 'works_on',
    });
    expect(res.body.items[0].distanceKm).toBeCloseTo(2, 0);
  });

  it('never lists the suspended garage, a draft, another suspended one or a garage that does not take the brand', async () => {
    await garage({ km: 0, slug: 'old', status: 'suspended', worksOn: [bmw] });
    await garage({ km: 1, slug: 'draft', status: 'draft', worksOn: [bmw] });
    await garage({
      km: 1,
      slug: 'gone-too',
      status: 'suspended',
      worksOn: [bmw],
    });
    await garage({ km: 1, refuses: [bmw], slug: 'refuses' });
    await garage({ km: 1, slug: 'other-brand', worksOn: [dacia] });
    await garage({ km: 1, slug: 'kept', worksOn: [bmw] });

    const res = await similar('old', { brand: 'bmw' });

    expect(slugs(res)).toEqual(['kept']);
  });

  it('keeps a fixed garage within 25 km, drops one at 30 km and keeps a mobile mechanic at 30 km whose area covers the place', async () => {
    await garage({ km: 0, slug: 'old', status: 'suspended', worksOn: [bmw] });
    await garage({ km: 24, slug: 'fixed-near', worksOn: [bmw] });
    await garage({ km: 30, slug: 'fixed-far', worksOn: [bmw] });
    await garage({
      km: 30,
      mobileRadiusKm: 40,
      slug: 'mobile-covers',
      worksOn: [bmw],
    });
    await garage({
      km: 30,
      mobileRadiusKm: 20,
      slug: 'mobile-short',
      worksOn: [bmw],
    });

    const res = await similar('old', { brand: 'bmw' });

    expect(slugs(res).sort()).toEqual(['fixed-near', 'mobile-covers']);
    const mobile = res.body.items.find(
      (item: { slug: string }) => item.slug === 'mobile-covers',
    );
    expect(mobile.comesToYou).toBe(true);
    expect(mobile.distanceKm).toBeNull();
  });

  it('without a brand, lists once each garage that works on any brand the old garage worked on, drawn for the most popular shared brand', async () => {
    await garage({
      km: 0,
      refuses: [audi],
      slug: 'old',
      status: 'suspended',
      worksOn: [bmw, dacia],
    });
    await garage({ km: 1, slug: 'both', worksOn: [bmw, dacia] });
    await garage({ km: 1, slug: 'only-bmw', worksOn: [bmw] });
    await garage({ km: 1, slug: 'only-audi', worksOn: [audi] });

    const res = await similar('old');

    expect(res.status).toBe(200);
    expect(res.body.brand).toBeNull();
    expect(slugs(res).sort()).toEqual(['both', 'only-bmw']);
    const brandOf = (slug: string) =>
      res.body.items.find((item: { slug: string }) => item.slug === slug).brand;
    expect(brandOf('both')).toEqual(dacia);
    expect(brandOf('only-bmw')).toEqual(bmw);
  });

  it('answers an empty list, with the brand, when nothing similar is nearby', async () => {
    await garage({ km: 0, slug: 'old', status: 'suspended', worksOn: [bmw] });
    await garage({ km: 80, slug: 'far', worksOn: [bmw] });

    const res = await similar('old', { brand: 'bmw' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ brand: bmw, items: [] });
  });

  it('answers an empty list for a suspended garage with no stored place', async () => {
    await garage({ slug: 'old', status: 'suspended', worksOn: [bmw] });
    await garage({ km: 1, slug: 'near', worksOn: [bmw] });

    const res = await similar('old', { brand: 'bmw' });

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('carries nothing about the old garage', async () => {
    await garage({ km: 0, slug: 'old', status: 'suspended', worksOn: [bmw] });
    await garage({ km: 1, slug: 'near', worksOn: [bmw] });

    const res = await similar('old', { brand: 'bmw' });

    expect(Object.keys(res.body).sort()).toEqual(['brand', 'items']);
    expect(JSON.stringify(res.body)).not.toContain('"old"');
  });

  it.each([
    ['an unknown slug', 'nobody', {}],
    ['a garage that was never public', 'draft', {}],
    ['a garage that is still approved', 'listed', {}],
    ['an unknown brand', 'old', { brand: 'tesla' }],
  ])('answers not_found to %s', async (_, slug, query) => {
    await garage({ km: 0, slug: 'old', status: 'suspended', worksOn: [bmw] });
    await garage({ km: 0, slug: 'draft', status: 'draft', worksOn: [bmw] });
    await garage({ km: 0, slug: 'listed', worksOn: [bmw] });

    const res = await similar(slug, query);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
    expect(res.body.items).toBeUndefined();
  });

  it.each([
    ['an unknown parameter', { near: '44.4,26.1' }],
    ['a slug with capitals', { brand: 'BMW' }],
  ])('answers validation_failed to %s', async (_, query) => {
    await garage({ km: 0, slug: 'old', status: 'suspended', worksOn: [bmw] });

    const res = await similar('old', query);

    expect(res.status).toBe(400);
  });

  it('is never kept by a cache on the way', async () => {
    await garage({ km: 0, slug: 'old', status: 'suspended', worksOn: [bmw] });

    const res = await similar('old', { brand: 'bmw' });

    expect(res.headers['cache-control']).toBe('no-store');
  });
});
