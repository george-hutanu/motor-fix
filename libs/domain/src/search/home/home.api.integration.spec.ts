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
      data: { key: 'dacia', name: 'Dacia', popularity: 7, slug: 'dacia' },
    })
  ).id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const home = (query: Record<string, string>) =>
  request(app.getHttpServer()).get('/home').query(query);

async function garage(
  slug: string,
  status: 'draft' | 'approved' | 'suspended',
  stance?: 'works_on' | 'does_not_take',
) {
  const { id } = await prisma.garage.create({
    data: { name: slug, slug, status },
  });
  if (stance) {
    await prisma.garageBrand.create({
      data: {
        brandId: dacia,
        garageId: id,
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
}

describe('GET /home', () => {
  it('counts the listed garages and those that take the brand, for a visitor', async () => {
    await garage('a', 'approved', 'works_on');
    await garage('b', 'approved', 'works_on');
    await garage('c', 'approved', 'works_on');
    await garage('d', 'approved', 'does_not_take');
    await garage('e', 'approved');
    await garage('f', 'approved');
    await garage('g', 'draft', 'works_on');
    await garage('h', 'suspended', 'works_on');

    const res = await home({ brand: 'dacia' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      best: expect.objectContaining({ slug: 'a', stance: 'works_on' }),
      brand: { id: dacia, name: 'Dacia', popularity: 7, slug: 'dacia' },
      preview: [
        expect.objectContaining({ slug: 'a' }),
        expect.objectContaining({ slug: 'b' }),
        expect.objectContaining({ slug: 'd', stance: 'does_not_take' }),
      ],
      takers: 3,
      total: 6,
    });
  });

  // @traces 226-best-rated-brand-dial-FR-009
  it('answers the best garage and the preview rows with every field Home shows', async () => {
    await garage('taker', 'approved', 'works_on');
    await prisma.garage.update({
      data: {
        businessKind: 'pfa',
        cityKey: 'bucuresti',
        cityName: 'București',
        labourFromBani: 15000,
        rating: 4.9,
        reviewCount: 80,
      },
      where: { slug: 'taker' },
    });

    const res = await home({ brand: 'dacia' });

    expect(res.body.best).toEqual({
      businessKind: 'pfa',
      city: 'București',
      id: expect.any(String),
      labourFromLei: 150,
      name: 'taker',
      rating: 4.9,
      reviewCount: 80,
      slug: 'taker',
      stance: 'works_on',
    });
    expect(res.body.preview).toEqual([res.body.best]);
  });

  it('answers a null best and an empty preview when no garage is listed', async () => {
    const res = await home({ brand: 'dacia' });

    expect(res.body).toMatchObject({ best: null, preview: [] });
  });

  it('lets the answer be cached for a minute', async () => {
    const res = await home({ brand: 'dacia' });

    expect(res.headers['cache-control']).toBe('public, max-age=60');
  });

  it('answers 0 of 0 when no garage is listed', async () => {
    await garage('draft-only', 'draft', 'works_on');

    const res = await home({ brand: 'dacia' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ takers: 0, total: 0 });
  });

  it('answers 404 for a brand retired from the catalogue', async () => {
    await prisma.brand.update({
      data: { active: false },
      where: { id: dacia },
    });

    const res = await home({ brand: 'dacia' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('answers 404 for a slug no brand holds', async () => {
    const res = await home({ brand: 'lada' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
    expect(res.headers['cache-control']).not.toBe('public, max-age=60');
  });

  it.each([
    ['no brand', {}],
    ['a blank brand', { brand: '' }],
    ['a brand over 60 characters', { brand: 'a'.repeat(61) }],
    ['a place out of range', { brand: 'dacia', near: '95,26' }],
    ['a place outside Romania', { brand: 'dacia', near: '47.498,19.040' }],
    ['an unknown parameter', { brand: 'dacia', sort: 'rating' }],
  ])('refuses with 400 %s', async (_, query) => {
    const res = await home(query);

    expect(res.status).toBe(400);
  });
});

// Cluj-Napoca; a hundredth of a degree of latitude is about 1.1 km.
const CLUJ = { lat: 46.771, lng: 23.624 };

async function placed(
  slug: string,
  dLat: number,
  stance?: 'works_on' | 'does_not_take',
  mobile?: { radiusKm: number },
) {
  await garage(slug, 'approved', stance);
  await prisma.garage.update({
    data: {
      latitude: CLUJ.lat + dLat,
      longitude: CLUJ.lng,
      ...(mobile && {
        businessKind: 'mobile' as const,
        seatAddress: 'Strada Sediului 1',
        serviceRadiusKm: mobile.radiusKm,
      }),
    },
    where: { slug },
  });
}

describe('GET /home near a place', () => {
  beforeEach(async () => {
    await placed('in-taker', 0.01, 'works_on');
    await placed('in-refuser', 0.1, 'does_not_take');
    await placed('mobile-in', 0.27, 'works_on', { radiusKm: 35 });
    await placed('mobile-out', 0.27, 'works_on', { radiusKm: 20 });
    await placed('far-taker', 0.5, 'works_on');
    await garage('nowhere', 'approved', 'works_on');
  });

  it('counts only the garages in the area of the place', async () => {
    const res = await home({ brand: 'dacia', near: '46.771,23.624' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ takers: 2, total: 3 });
  });

  // @traces 226-best-rated-brand-dial-FR-009
  it('ranks the garages in the area, each with its distance or its coming to you', async () => {
    const res = await home({ brand: 'dacia', near: '46.771,23.624' });

    expect(
      res.body.preview.map(
        (g: {
          slug: string;
          distanceKm: number | null;
          comesToYou: boolean;
        }) => [g.slug, g.distanceKm, g.comesToYou],
      ),
    ).toEqual([
      ['in-taker', 1.1, false],
      ['mobile-in', null, true],
      ['in-refuser', 11.1, false],
    ]);
  });

  it('counts all of Romania without a place', async () => {
    const res = await home({ brand: 'dacia' });

    expect(res.body).toMatchObject({ takers: 5, total: 6 });
  });

  it('answers a point given to six decimals as the same point to three', async () => {
    const six = await home({ brand: 'dacia', near: '46.771312,23.623538' });
    const three = await home({ brand: 'dacia', near: '46.771,23.624' });

    expect(six.body).toEqual(three.body);
    expect(six.headers['cache-control']).toBe('public, max-age=60');
  });

  it('answers 0 of 0 for a place with no garage near it', async () => {
    const res = await home({ brand: 'dacia', near: '44.43,26.10' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ takers: 0, total: 0 });
  });

  it('writes nothing when it reads near a place', async () => {
    const before = await Promise.all([
      prisma.activityLog.count(),
      prisma.outboxEvent.count(),
    ]);

    await home({ brand: 'dacia', near: `${CLUJ.lat},${CLUJ.lng}` });

    expect(
      await Promise.all([
        prisma.activityLog.count(),
        prisma.outboxEvent.count(),
      ]),
    ).toEqual(before);
  });
});
