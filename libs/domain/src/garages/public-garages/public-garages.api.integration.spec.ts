import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications/notifications.testing';
import { HomeService } from '../../search/home/home.service';
import { UNUSED_STORAGE } from '../../storage/s3-test-store';
import { StorageModule } from '../../storage/storage.module';
import { GaragesModule } from '../garages.module';
import { VerificationService } from '../verification/verification.service';

// @traces 207-FR-005 207-FR-011 040-FR-012

const redisUrl = redisUrlFor(2);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;
let verification: VerificationService;

beforeAll(async () => {
  const email = testConfig('http://127.0.0.1:9');
  const auth = AuthModule.register({
    databaseUrl,
    redisUrl,
    tokenSecret: 'test-secret',
  });
  const notifications = NotificationsModule.register(
    { databaseUrl, email, redisUrl },
    auth,
  );
  const moduleRef = await Test.createTestingModule({
    imports: [
      auth,
      notifications,
      StorageModule.register(UNUSED_STORAGE),
      GaragesModule.register(email, notifications, {
        skipManualApproval: false,
      }),
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  await app.init();
  verification = app.get(VerificationService);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE brand CASCADE');
});

const read = (slug: string) =>
  request(app.getHttpServer()).get(`/garages/${slug}`);

async function garage(status: 'draft' | 'approved' | 'suspended' = 'draft') {
  return prisma.garage.create({
    data: {
      name: 'Atelier Dinamo',
      slug: `dinamo-${randomUUID()}`,
      status,
    },
  });
}

async function withFile(
  status: 'submitted' | 'in_review' | 'more_requested' | 'rejected',
) {
  const created = await garage();
  await prisma.verificationFile.create({
    data: { garageId: created.id, status },
  });
  return created;
}

describe('reading a garage by its public slug', () => {
  it('returns an approved garage without a session', async () => {
    const approved = await garage('approved');

    const res = await read(approved.slug);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      brandNote: null,
      doesNotTake: [],
      id: approved.id,
      jobTypes: [],
      name: 'Atelier Dinamo',
      paymentMethods: { card: false, cash: false, transfer: false },
      photos: [],
      rating: null,
      refusalPhrase: null,
      responseRate: { state: 'new' },
      reviewCount: 0,
      slug: approved.slug,
      verifiedAt: null,
      worksOn: [],
    });
  });

  it('never shows the phone, the step-1 details or the mechanic cards', async () => {
    const approved = await prisma.garage.create({
      data: {
        businessKind: 'company',
        knownFor: 'Frâne',
        name: 'Atelier Dinamo',
        phone: '+40722123456',
        slug: `dinamo-${randomUUID()}`,
        status: 'approved',
      },
    });
    await prisma.mechanic.create({
      data: { garageId: approved.id, name: 'Ion Marin', onProfile: true },
    });

    const res = await read(approved.slug);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      'brandNote',
      'businessKind',
      'description',
      'doesNotTake',
      'id',
      'jobTypes',
      'name',
      'paymentMethods',
      'photos',
      'rating',
      'refusalPhrase',
      'responseRate',
      'reviewCount',
      'slug',
      'verifiedAt',
      'worksOn',
    ]);
    expect(JSON.stringify(res.body)).not.toContain('722123456');
  });

  it('shows a workshop where it is', async () => {
    const approved = await prisma.garage.create({
      data: {
        address: 'Strada Ștefan cel Mare 12, Sector 2, București',
        businessKind: 'company',
        latitude: 44.4512,
        longitude: 26.1207,
        name: 'Atelier Dinamo',
        slug: `dinamo-${randomUUID()}`,
        status: 'approved',
      },
    });

    const res = await read(approved.slug);

    expect(res.body).toMatchObject({
      address: 'Strada Ștefan cel Mare 12, Sector 2, București',
      latitude: 44.4512,
      longitude: 26.1207,
    });
    expect(res.body).not.toHaveProperty('serviceRadiusKm');
  });

  it('shows a mobile mechanic only by the area served, never the seat', async () => {
    const seat = 'Strada Sediului 3, Ploiești';
    const approved = await prisma.garage.create({
      data: {
        businessKind: 'mobile',
        latitude: 44.9365,
        longitude: 26.0129,
        mobileLegalForm: 'pfa',
        name: 'Mecanic la domiciliu',
        seatAddress: seat,
        serviceRadiusKm: 35,
        slug: `mobil-${randomUUID()}`,
        status: 'approved',
      },
    });

    const res = await read(approved.slug);

    expect(res.status).toBe(200);
    expect(res.body.serviceRadiusKm).toBe(35);
    for (const key of ['address', 'latitude', 'longitude', 'seatAddress']) {
      expect(res.body).not.toHaveProperty(key);
    }
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('Sediului');
    expect(body).not.toContain('44.9365');
  });

  it("carries the garage's brand answer, in catalogue order, retired brands kept", async () => {
    const approved = await prisma.garage.update({
      data: {
        brandNote: 'Fără mașini electrice',
        refusalPhrase: 'orice nu e BMW',
      },
      where: { id: (await garage('approved')).id },
    });
    const brand = (name: string, popularity: number | null, active = true) => {
      const key = `${name.toLowerCase()}-${randomUUID()}`;
      return prisma.brand.create({
        data: { active, key, name, popularity, slug: key },
      });
    };
    const bmw = await brand('BMW', 2);
    const audi = await brand('Audi', null);
    const mini = await brand('Mini', 1);
    const lada = await brand('Lada', null, false);
    const tesla = await brand('Tesla', 3);
    for (const [b, stance] of [
      [bmw, 'works_on'],
      [audi, 'works_on'],
      [mini, 'works_on'],
      [lada, 'works_on'],
      [tesla, 'does_not_take'],
    ] as const) {
      const fuels = stance === 'works_on';
      await prisma.garageBrand.create({
        data: {
          brandId: b.id,
          diesel: fuels,
          electric: fuels,
          garageId: approved.id,
          hybrid: fuels,
          petrol: fuels,
          stance,
        },
      });
    }

    const res = await read(approved.slug);

    const ref = (b: { id: string; name: string; slug: string }) => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      brandNote: 'Fără mașini electrice',
      doesNotTake: [ref(tesla)],
      refusalPhrase: 'orice nu e BMW',
      worksOn: [ref(mini), ref(bmw), ref(audi), ref(lada)],
    });
  });

  it('carries the payment methods the garage takes', async () => {
    const approved = await garage('approved');
    await prisma.$executeRaw`UPDATE garage SET payment_cash = true, payment_transfer = true WHERE id = ${approved.id}::uuid`;

    const res = await read(approved.slug);

    expect(res.body.paymentMethods).toEqual({
      card: false,
      cash: true,
      transfer: true,
    });
  });

  it('carries no courtesy car when the garage does not list one', async () => {
    const approved = await garage('approved');

    const res = await read(approved.slug);

    expect(res.body).not.toHaveProperty('courtesyCar');
  });

  it('carries a free courtesy car without a price', async () => {
    const approved = await garage('approved');
    await prisma.garageFacility.create({
      data: { facility: 'courtesy_car', garageId: approved.id },
    });

    const res = await read(approved.slug);

    expect(res.body.courtesyCar).toEqual({ paid: false });
  });

  it('carries a paid courtesy car with its price per day', async () => {
    const approved = await garage('approved');
    await prisma.garageFacility.create({
      data: { facility: 'courtesy_car', garageId: approved.id },
    });
    await prisma.$executeRaw`UPDATE garage SET courtesy_car_paid = true, courtesy_car_price_per_day_bani = 12000 WHERE id = ${approved.id}::uuid`;

    const res = await read(approved.slug);

    expect(res.body.courtesyCar).toEqual({
      paid: true,
      pricePerDayBani: 12000,
    });
  });

  it('carries the ticked fuels of each taken brand, none ticked included', async () => {
    const approved = await garage('approved');
    const brand = (name: string, popularity: number) => {
      const key = `${name.toLowerCase()}-${randomUUID()}`;
      return prisma.brand.create({
        data: { key, name, popularity, slug: key },
      });
    };
    const dacia = await brand('Dacia', 1);
    const bmw = await brand('BMW', 2);
    const tesla = await brand('Tesla', 3);
    await prisma.garageBrand.createMany({
      data: [
        {
          brandId: dacia.id,
          diesel: true,
          electric: false,
          garageId: approved.id,
          hybrid: true,
          petrol: true,
          stance: 'works_on',
        },
        {
          brandId: bmw.id,
          diesel: false,
          electric: false,
          garageId: approved.id,
          hybrid: false,
          petrol: false,
          stance: 'works_on',
        },
        {
          brandId: tesla.id,
          diesel: false,
          electric: false,
          garageId: approved.id,
          hybrid: false,
          petrol: false,
          stance: 'does_not_take',
        },
      ],
    });

    const res = await read(approved.slug);

    expect(res.body.worksOn).toEqual([
      {
        fuels: ['petrol', 'diesel', 'hybrid'],
        id: dacia.id,
        name: 'Dacia',
        slug: dacia.slug,
      },
      { fuels: [], id: bmw.id, name: 'BMW', slug: bmw.slug },
    ]);
    expect(res.body.doesNotTake).toEqual([
      { id: tesla.id, name: 'Tesla', slug: tesla.slug },
    ]);
  });

  it('answers a garage never approved exactly as a slug nobody holds', async () => {
    const unknown = await read(`nobody-${randomUUID()}`);
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('not_found');

    const hidden = [
      await garage('draft'),
      await withFile('submitted'),
      await withFile('in_review'),
      await withFile('more_requested'),
      await withFile('rejected'),
    ];
    for (const { slug } of hidden) {
      const res = await read(slug);

      expect([slug, res.status, res.body]).toEqual([slug, 404, unknown.body]);
    }
  });

  it('answers 410 gone for a suspended garage', async () => {
    const suspended = await garage('suspended');

    const res = await read(suspended.slug);

    expect(res.status).toBe(410);
    expect(res.body.code).toBe('gone');
  });

  it('returns the garage on the read right after its approval commits', async () => {
    const owner = await account('Mihai', ['garage']);
    const admin = await account('Ioana', ['admin']);
    const hidden = await garage();
    const none = {
      canAnswerQuotes: false,
      canMoveBookings: false,
      canRecordFinalPrice: false,
    };
    const file = await prisma.$transaction((tx) =>
      verification.submit(
        tx,
        {
          accountId: owner,
          garageId: hidden.id,
          permissions: none,
          role: 'garage',
          roles: ['garage'],
        },
        hidden.id,
      ),
    );
    expect((await read(hidden.slug)).status).toBe(404);

    await prisma.$transaction((tx) =>
      verification.decide(
        tx,
        {
          accountId: admin,
          garageId: null,
          permissions: none,
          role: 'admin',
          roles: ['admin'],
        },
        file.id,
        { outcome: 'approved' },
      ),
    );

    const res = await read(hidden.slug);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(hidden.id);
  });
});

const readWith = (slug: string, query: Record<string, string>) =>
  request(app.getHttpServer()).get(`/garages/${slug}`).query(query);

const catalogueBrand = (name: string, active = true) => {
  const slug = `${name.toLowerCase()}-${randomUUID()}`;
  return prisma.brand.create({
    data: { active, key: slug, name, popularity: null, slug },
  });
};

const approvedFile = (garageId: string, decidedAt: Date) =>
  prisma.verificationFile.create({
    data: { decidedAt, garageId, status: 'approved' },
  });

// @traces 307-FR-001 307-FR-002
describe('what the profile says about the garage', () => {
  it('carries the line the garage wrote about itself, as written', async () => {
    const approved = await prisma.garage.create({
      data: {
        businessKind: 'company',
        knownFor: 'Specializați pe Dacia și VW.',
        name: 'Service Auto Militari',
        slug: `militari-${randomUUID()}`,
        status: 'approved',
      },
    });

    const res = await read(approved.slug);

    expect(res.body).toMatchObject({
      businessKind: 'company',
      description: 'Specializați pe Dacia și VW.',
      rating: null,
      reviewCount: 0,
    });
  });

  it('leaves the description out when the garage wrote none', async () => {
    const approved = await prisma.garage.create({
      data: {
        knownFor: '   ',
        name: 'Fără descriere',
        slug: `gol-${randomUUID()}`,
        status: 'approved',
      },
    });

    const res = await read(approved.slug);

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('description');
    expect(res.body).not.toHaveProperty('businessKind');
  });

  // @traces 226-FR-011
  it('answers the rating and review count the garage holds, as Home does', async () => {
    const approved = await prisma.garage.create({
      data: {
        name: 'Atelier Berceni',
        rating: 4.7,
        reviewCount: 31,
        slug: `berceni-${randomUUID()}`,
        status: 'approved',
      },
    });
    const brand = await catalogueBrand('Dacia');
    await prisma.garageBrand.create({
      data: { brandId: brand.id, garageId: approved.id, stance: 'works_on' },
    });

    const res = await read(approved.slug);
    const shown = await new HomeService(prisma).forBrand(brand.slug);

    expect(res.body).toMatchObject({ rating: 4.7, reviewCount: 31 });
    expect(shown.best).toMatchObject({
      rating: res.body.rating,
      reviewCount: res.body.reviewCount,
      slug: approved.slug,
    });
  });

  it('dates the verification by the latest approved file', async () => {
    const approved = await garage('approved');
    await prisma.garage.update({
      data: { approvedAt: new Date('2025-03-01T10:00:00.000Z') },
      where: { id: approved.id },
    });
    await approvedFile(approved.id, new Date('2026-01-15T09:30:00.000Z'));
    await prisma.verificationFile.create({
      data: {
        decidedAt: new Date('2026-05-01T09:30:00.000Z'),
        garageId: approved.id,
        status: 'rejected',
      },
    });

    const res = await read(approved.slug);

    expect(res.body.verifiedAt).toBe('2026-01-15T09:30:00.000Z');
  });

  it('keeps the approval date while an approved file is reopened into review', async () => {
    const approved = await garage('approved');
    await prisma.garage.update({
      data: { approvedAt: new Date('2026-02-02T08:00:00.000Z') },
      where: { id: approved.id },
    });
    await prisma.verificationFile.create({
      data: {
        decidedAt: new Date('2026-02-02T08:00:00.000Z'),
        garageId: approved.id,
        reopenedAt: new Date('2026-04-01T08:00:00.000Z'),
        status: 'in_review',
      },
    });

    const res = await read(approved.slug);

    expect(res.status).toBe(200);
    expect(res.body.verifiedAt).toBe('2026-02-02T08:00:00.000Z');
  });

  it('answers a null verification date when the garage holds neither', async () => {
    const approved = await garage('approved');

    expect((await read(approved.slug)).body.verifiedAt).toBeNull();
  });

  it('fills in the 20 km area of a mobile mechanic that set none', async () => {
    const approved = await prisma.garage.create({
      data: {
        businessKind: 'mobile',
        mobileLegalForm: 'pfa',
        name: 'Mecanic Mobil Ilfov',
        slug: `mobil-${randomUUID()}`,
        status: 'approved',
      },
    });

    const res = await read(approved.slug);

    expect(res.body).toMatchObject({
      businessKind: 'mobile',
      serviceRadiusKm: 20,
    });
  });

  // @traces 307-FR-001
  it('answers 404 for a slug holding a control character', async () => {
    const res = await read('service%07auto');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  // @traces 307-FR-005
  it('shows only public fields, with or without a brand, for a workshop and a mobile mechanic', async () => {
    const dacia = await catalogueBrand('Dacia');
    const fixed = await prisma.garage.create({
      data: {
        address: 'Bulevardul Iuliu Maniu 100, București',
        businessKind: 'company',
        knownFor: 'Frâne și suspensii',
        latitude: 44.4339,
        longitude: 26.0161,
        name: 'Service Auto Militari',
        phone: '+40722123456',
        slug: `militari-${randomUUID()}`,
        status: 'approved',
      },
    });
    const mobile = await prisma.garage.create({
      data: {
        businessKind: 'mobile',
        latitude: 44.5,
        longitude: 26.1,
        mobileLegalForm: 'pfa',
        name: 'Mecanic Mobil Ilfov',
        phone: '+40722123457',
        seatAddress: 'Strada Sediului 3, Otopeni',
        serviceRadiusKm: 25,
        slug: `mobil-${randomUUID()}`,
        status: 'approved',
      },
    });
    for (const [slug, seat] of [
      [fixed.slug, false],
      [mobile.slug, true],
    ] as const) {
      const queries: Record<string, string>[] = [{}, { brand: dacia.slug }];
      for (const query of queries) {
        const res = await readWith(slug, query);

        expect(res.status).toBe(200);
        expectPublicOnly(res.body, seat);
      }
    }
  });

  // @traces 307-FR-019
  it('writes nothing when a visitor reads a profile', async () => {
    const approved = await garage('approved');
    const before = await Promise.all([
      prisma.outboxEvent.count(),
      prisma.activityLog.count(),
    ]);

    await read(approved.slug);
    await readWith(approved.slug, { brand: 'dacia' });

    expect(
      await Promise.all([
        prisma.outboxEvent.count(),
        prisma.activityLog.count(),
      ]),
    ).toEqual(before);
  });
});

// @traces 307-FR-003
describe('reading a profile with a brand in context', () => {
  async function garageWith(
    rows: { brandId: string; stance: 'works_on' | 'does_not_take' }[],
  ) {
    const approved = await garage('approved');
    for (const { brandId, stance } of rows) {
      const fuels = stance === 'works_on';
      await prisma.garageBrand.create({
        data: {
          brandId,
          diesel: fuels,
          electric: fuels,
          garageId: approved.id,
          hybrid: fuels,
          petrol: fuels,
          stance,
        },
      });
    }
    return approved;
  }

  it('says the garage works on a brand it marked so', async () => {
    const dacia = await catalogueBrand('Dacia');
    const approved = await garageWith([
      { brandId: dacia.id, stance: 'works_on' },
    ]);

    const res = await readWith(approved.slug, { brand: dacia.slug });

    expect(res.status).toBe(200);
    expect(res.body.brand).toEqual({
      id: dacia.id,
      name: 'Dacia',
      slug: dacia.slug,
      stance: 'works_on',
    });
  });

  it('says the garage does not take a brand it refused or never named', async () => {
    const bmw = await catalogueBrand('BMW');
    const audi = await catalogueBrand('Audi');
    const approved = await garageWith([
      { brandId: bmw.id, stance: 'does_not_take' },
    ]);

    const refused = await readWith(approved.slug, { brand: bmw.slug });
    const unnamed = await readWith(approved.slug, { brand: audi.slug });

    expect(refused.body.brand).toMatchObject({
      slug: bmw.slug,
      stance: 'does_not_take',
    });
    expect(unnamed.body.brand).toMatchObject({
      slug: audi.slug,
      stance: 'does_not_take',
    });
  });

  it('answers for a retired brand too', async () => {
    const lada = await catalogueBrand('Lada', false);
    const approved = await garageWith([
      { brandId: lada.id, stance: 'works_on' },
    ]);

    const res = await readWith(approved.slug, { brand: lada.slug });

    expect(res.body.brand).toMatchObject({
      name: 'Lada',
      stance: 'works_on',
    });
  });

  it.each([
    ['an unknown brand', 'nu-exista'],
    ['a blank brand', '   '],
    ['an empty brand', ''],
    ['an over-long brand', 'd'.repeat(61)],
    ['a brand holding a control character', 'da\u0007cia'],
  ])('answers 200 with no brand for %s, never 400', async (_, value) => {
    await catalogueBrand('Dacia');
    const approved = await garage('approved');

    const res = await readWith(approved.slug, { brand: value });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('brand');
  });

  it('answers 200 with no brand when the brand is given twice', async () => {
    const approved = await garage('approved');

    const res = await request(app.getHttpServer()).get(
      `/garages/${approved.slug}?brand=dacia&brand=bmw`,
    );

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('brand');
  });
});

const PUBLIC_FIELDS = new Set([
  'address',
  'brand',
  'brandNote',
  'businessKind',
  'courtesyCar',
  'description',
  'doesNotTake',
  'id',
  'jobTypes',
  'latitude',
  'longitude',
  'name',
  'paymentMethods',
  'photos',
  'rating',
  'refusalPhrase',
  'responseRate',
  'reviewCount',
  'serviceRadiusKm',
  'slug',
  'verifiedAt',
  'worksOn',
]);

// A mobile mechanic's position is its owner's seat, so it never leaves.
function expectPublicOnly(body: Record<string, unknown>, mobile: boolean) {
  expect(Object.keys(body).filter((key) => !PUBLIC_FIELDS.has(key))).toEqual(
    [],
  );
  const hidden = ['phone', 'cui', 'seatAddress'];
  if (mobile) hidden.push('address', 'latitude', 'longitude');
  for (const key of hidden) expect(body).not.toHaveProperty(key);
  if (!mobile) {
    expect(body).toMatchObject({
      address: 'Bulevardul Iuliu Maniu 100, București',
      latitude: 44.4339,
      longitude: 26.0161,
    });
  }
}

// @traces 221-FR-004
// @traces 357-public-price-jobs-FR-006
describe('the jobs a profile offers', () => {
  const jobType = (nameRo: string, nameEn: string) =>
    prisma.jobType.create({
      data: { key: `job-${randomUUID()}`, nameEn, nameRo, status: 'approved' },
    });

  it('lists the public jobs once each, in the order of their default rows', async () => {
    const approved = await garage('approved');
    const owner = await account('owner', ['garage']);
    const oil = await jobType('Schimb ulei', 'Oil change');
    const brakes = await jobType('Plăcuțe frână', 'Brake pads');
    const hidden = await jobType('Diagnoză', 'Diagnosis');
    const noTop = await jobType('Verificare suspensie', 'Suspension check');
    const brandTop = await jobType('Kit distribuție', 'Timing kit');
    const dacia = await catalogueBrand('Dacia');
    const price = (jobTypeId: string, position: number, extra = {}) =>
      prisma.garagePrice.create({
        data: {
          fromBani: 20_000,
          garageId: approved.id,
          jobTypeId,
          position,
          toBani: 30_000,
          updatedBy: owner,
          ...extra,
        },
      });
    await price(brakes.id, 2);
    await price(oil.id, 1);
    await price(oil.id, 3, { brandId: dacia.id });
    await price(hidden.id, 0, { visible: false });
    await price(noTop.id, 4, { toBani: null });
    await price(brandTop.id, 5, { toBani: null });
    await price(brandTop.id, 6, { brandId: dacia.id });

    const res = await read(approved.slug);

    expect(res.body.jobTypes).toEqual([
      { id: oil.id, nameEn: 'Oil change', nameRo: 'Schimb ulei' },
      { id: brakes.id, nameEn: 'Brake pads', nameRo: 'Plăcuțe frână' },
    ]);
  });

  it('offers no job when the garage lists no price', async () => {
    const approved = await garage('approved');

    expect((await read(approved.slug)).body.jobTypes).toEqual([]);
  });
});

// @traces 384-FR-007
describe('the response rate a profile carries', () => {
  const figures = (
    garageId: string,
    lifetimeRequests: number,
    requests30d: number,
    answeredWithinDay30d: number,
    rate: number | null,
  ) =>
    prisma.garageResponseStats.create({
      data: {
        answeredWithinDay30d,
        computedAt: new Date('2026-10-09T22:00:00Z'),
        garageId,
        lifetimeRequests,
        rate,
        requests30d,
      },
    });

  it('says new for a garage the night has not counted yet', async () => {
    const approved = await garage('approved');

    expect((await read(approved.slug)).body.responseRate).toEqual({
      state: 'new',
    });
  });

  it('says new below 10 lifetime requests, whatever the rate', async () => {
    const approved = await garage('approved');
    await figures(approved.id, 9, 9, 9, 100);

    expect((await read(approved.slug)).body.responseRate).toEqual({
      state: 'new',
    });
  });

  it('carries the rate from 10 lifetime requests on', async () => {
    const approved = await garage('approved');
    await figures(approved.id, 12, 12, 11, 91);

    expect((await read(approved.slug)).body.responseRate).toEqual({
      rate: 91,
      state: 'rate',
    });
  });

  it('carries a rate of 0 as a rate', async () => {
    const approved = await garage('approved');
    await figures(approved.id, 10, 5, 0, 0);

    expect((await read(approved.slug)).body.responseRate).toEqual({
      rate: 0,
      state: 'rate',
    });
  });

  it('says none for 10 or more lifetime requests and none in the last 30 days', async () => {
    const approved = await garage('approved');
    await figures(approved.id, 14, 0, 0, null);

    expect((await read(approved.slug)).body.responseRate).toEqual({
      state: 'none',
    });
  });
});
