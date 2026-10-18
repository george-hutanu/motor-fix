import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { Redis } from 'ioredis';
import request from 'supertest';

import { AuthModule } from '../../auth/auth.module';
import type { Actor } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { serialDatabase } from '../../auth/serial-db.testing';
import { OutboxRelay } from '../../events/outbox-relay/outbox-relay';
import { PrismaClient } from '../../generated/prisma/client';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications/notifications.testing';
import { S3TestStore } from '../../storage/s3-test-store';
import { StorageModule } from '../../storage/storage.module';
import { GarageBrandsService } from '../garage-brands/garage-brands.service';
import { GarageSettingsService } from '../garage-settings/garage-settings.service';
import { GaragesModule } from '../garages.module';
import { PriceListService } from '../price-list/price-list.service';
import { VerificationService } from '../verification/verification.service';

const redisUrl = redisUrlFor(2);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

// The app's own client, logging every statement it sends.
const logged = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: databaseUrl,
    options: '-c TimeZone=UTC',
  }),
  log: [{ emit: 'event', level: 'query' }],
});
const statements: string[] = [];
logged.$on('query', (event) => statements.push(event.query));

const store = new S3TestStore();
const other = new Redis(redisUrl);
let app: NestExpressApplication;

beforeAll(async () => {
  await store.start();
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
      StorageModule.register(store.env()),
      GaragesModule.register(email, notifications, {
        skipManualApproval: false,
      }),
    ],
  })
    .overrideProvider(PRISMA)
    .useValue(logged)
    .compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  await app.init();
});

afterAll(async () => {
  await app.close();
  await store.stop();
  other.disconnect();
  await logged.$disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE brand, job_type CASCADE');
  store.objects.clear();
});

const read = (slug: string, query: Record<string, string> = {}) =>
  request(app.getHttpServer()).get(`/garages/${slug}`).query(query);

// The statements one read sends once its brand lookup is cached.
async function counted(slug: string, query: Record<string, string> = {}) {
  // Every call reads the maintenance flag; a first call fills it in Redis.
  await read(`warm-${randomUUID()}`);
  statements.length = 0;
  const res = await read(slug, query);
  return { res, sent: [...statements] };
}

const none = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};

const brandOf = (name: string, popularity: number | null) => {
  const slug = `${name.toLowerCase()}-${randomUUID()}`;
  return prisma.brand.create({
    data: { key: slug, name, popularity, slug },
  });
};

const jobOf = (nameRo: string, nameEn: string) =>
  prisma.jobType.create({
    data: {
      key: `${nameEn}-${randomUUID()}`,
      nameEn,
      nameRo,
      status: 'approved',
    },
  });

// Service Auto Militari with everything the profile shows: two brands (one
// taken on two fuels with a job ticked, one refused), two priced jobs and a
// brand range, a sized and an unsized photo, the courtesy car, response
// figures and an approved verification file.
async function militari() {
  const dacia = await brandOf('Dacia', 1);
  const tesla = await brandOf('Tesla', null);
  const brakes = await jobOf('Frâne', 'Brakes');
  const belt = await jobOf('Distribuție', 'Timing belt');
  const garage = await prisma.garage.create({
    data: {
      address: 'Bd. Iuliu Maniu 10, București',
      approvedAt: new Date('2026-09-01T08:00:00.000Z'),
      brandNote: 'Doar benzină și motorină',
      businessKind: 'company',
      courtesyCarPaid: true,
      courtesyCarPricePerDayBani: 10_000,
      knownFor: 'Frâne și distribuție, „rapid”.',
      labourFromBani: 15_000,
      labourToBani: 20_000,
      latitude: 44.4301,
      longitude: 26.0145,
      name: 'Service Auto Militari',
      paymentCard: true,
      paymentCash: true,
      rating: 4.6,
      refusalPhrase: 'Nu lucrăm pe electrice',
      reviewCount: 12,
      slug: `militari-${randomUUID()}`,
      status: 'approved',
    },
  });
  await prisma.garageFacility.create({
    data: { facility: 'courtesy_car', garageId: garage.id },
  });
  await prisma.garageBrand.createMany({
    data: [
      {
        brandId: dacia.id,
        electric: false,
        garageId: garage.id,
        hybrid: false,
        stance: 'works_on',
      },
      {
        brandId: tesla.id,
        diesel: false,
        electric: false,
        garageId: garage.id,
        hybrid: false,
        petrol: false,
        stance: 'does_not_take',
      },
    ],
  });
  const updatedBy = randomUUID();
  const brakesPrice = await prisma.garagePrice.create({
    data: {
      durationMinutes: 60,
      fromBani: 20_000,
      garageId: garage.id,
      jobTypeId: brakes.id,
      position: 0,
      toBani: 30_000,
      updatedBy,
    },
  });
  await prisma.garagePrice.createMany({
    data: [
      {
        fromBani: 50_000,
        garageId: garage.id,
        jobTypeId: belt.id,
        position: 1,
        toBani: 80_000,
        updatedBy,
      },
      {
        brandId: dacia.id,
        fromBani: 18_000,
        garageId: garage.id,
        jobTypeId: brakes.id,
        position: 2,
        toBani: 25_000,
        updatedBy,
      },
    ],
  });
  await prisma.garageBrandJob.create({
    data: { brandId: dacia.id, garageId: garage.id, jobTypeId: brakes.id },
  });
  const sized = `garage_photo/${garage.id}/${randomUUID()}`;
  const unsized = `garage_photo/${garage.id}/${randomUUID()}`;
  for (const key of [sized, unsized]) {
    store.put(`${key}.thumb`, Buffer.from('thumb'), 'image/jpeg', {
      height: '600',
      width: '800',
    });
    store.put(`${key}.display`, Buffer.from('display'), 'image/jpeg');
  }
  const unsizedPhoto = await prisma.garagePhoto.create({
    data: { fileKey: unsized, garageId: garage.id, position: 1 },
  });
  const sizedPhoto = await prisma.garagePhoto.create({
    data: {
      fileKey: sized,
      garageId: garage.id,
      height: 900,
      position: 0,
      width: 1200,
    },
  });
  await prisma.garageResponseStats.create({
    data: {
      answeredWithinDay30d: 10,
      computedAt: new Date(),
      garageId: garage.id,
      lifetimeRequests: 20,
      rate: 83,
      requests30d: 12,
    },
  });
  await prisma.verificationFile.create({
    data: {
      decidedAt: new Date('2026-09-15T10:00:00.000Z'),
      garageId: garage.id,
      status: 'approved',
    },
  });
  return {
    belt,
    brakes,
    brakesPrice,
    dacia,
    garage,
    photos: [sizedPhoto, unsizedPhoto],
    tesla,
  };
}

const ref = ({
  id,
  name,
  slug,
}: {
  id: string;
  name: string;
  slug: string;
}) => ({
  id,
  name,
  slug,
});

const signed = expect.stringContaining('X-Amz-Signature');

function militariAnswer(w: Awaited<ReturnType<typeof militari>>) {
  return {
    address: 'Bd. Iuliu Maniu 10, București',
    brandNote: 'Doar benzină și motorină',
    businessKind: 'company',
    courtesyCar: { paid: true, pricePerDayBani: 10_000 },
    description: 'Frâne și distribuție, „rapid”.',
    doesNotTake: [ref(w.tesla)],
    id: w.garage.id,
    jobTypes: [
      { id: w.brakes.id, nameEn: 'Brakes', nameRo: 'Frâne' },
      { id: w.belt.id, nameEn: 'Timing belt', nameRo: 'Distribuție' },
    ],
    labour: { fromBani: 15_000, toBani: 20_000 },
    latitude: 44.4301,
    longitude: 26.0145,
    name: 'Service Auto Militari',
    paymentMethods: { card: true, cash: true, transfer: false },
    photos: [
      {
        displayUrl: signed,
        height: 900,
        id: w.photos[0].id,
        thumbnailUrl: signed,
        width: 1200,
      },
      {
        displayUrl: signed,
        height: 600,
        id: w.photos[1].id,
        thumbnailUrl: signed,
        width: 800,
      },
    ],
    prices: [
      {
        durationMinutes: 60,
        fromBani: 20_000,
        jobTypeId: w.brakes.id,
        nameEn: 'Brakes',
        nameRo: 'Frâne',
        toBani: 30_000,
      },
      {
        fromBani: 50_000,
        jobTypeId: w.belt.id,
        nameEn: 'Timing belt',
        nameRo: 'Distribuție',
        toBani: 80_000,
      },
    ],
    rating: 4.6,
    refusalPhrase: 'Nu lucrăm pe electrice',
    responseRate: { rate: 83, state: 'rate' },
    reviewCount: 12,
    slug: w.garage.slug,
    verifiedAt: '2026-09-15T10:00:00.000Z',
    worksOn: [{ ...ref(w.dacia), fuels: ['petrol', 'diesel'] }],
  };
}

// @traces 1183-FR-001 1183-FR-002 1183-FR-003
describe('the profile read on a cache miss', () => {
  it('reads a fully filled garage in one statement, field for field', async () => {
    const w = await militari();

    const { res, sent } = await counted(w.garage.slug);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(militariAnswer(w));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/^\s*SELECT/i);
  });

  it('reads the brand in context in one statement once the brand is known', async () => {
    const w = await militari();
    await read(`nobody-${randomUUID()}`, { brand: w.dacia.slug });

    const { res, sent } = await counted(w.garage.slug, { brand: w.dacia.slug });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ...militariAnswer(w),
      brand: { ...ref(w.dacia), stance: 'works_on' },
      prices: [
        {
          durationMinutes: 60,
          fromBani: 18_000,
          jobTypeId: w.brakes.id,
          nameEn: 'Brakes',
          nameRo: 'Frâne',
          toBani: 25_000,
        },
      ],
    });
    expect(sent).toHaveLength(1);
  });

  it('reads a mobile mechanic in one statement and keeps its seat out', async () => {
    const garage = await prisma.garage.create({
      data: {
        address: 'Str. Sediului 1',
        businessKind: 'mobile',
        latitude: 44.4,
        longitude: 26.1,
        name: 'Mecanic la domiciliu',
        slug: `mobil-${randomUUID()}`,
        status: 'approved',
      },
    });

    const { res, sent } = await counted(garage.slug);

    expect(res.body).toEqual({
      brandNote: null,
      businessKind: 'mobile',
      doesNotTake: [],
      id: garage.id,
      jobTypes: [],
      name: 'Mecanic la domiciliu',
      paymentMethods: { card: false, cash: false, transfer: false },
      photos: [],
      prices: [],
      rating: null,
      refusalPhrase: null,
      responseRate: { state: 'new' },
      reviewCount: 0,
      serviceRadiusKm: 20,
      slug: garage.slug,
      verifiedAt: null,
      worksOn: [],
    });
    expect(sent).toHaveLength(1);
  });

  it.each([
    ['suspended', 410, 'gone'],
    ['draft', 404, 'not_found'],
  ] as const)(
    'tells a %s garage apart in the same one statement',
    async (status, code, body) => {
      const garage = await prisma.garage.create({
        data: { name: 'Ascuns', slug: `ascuns-${randomUUID()}`, status },
      });

      const { res, sent } = await counted(garage.slug);

      expect([res.status, res.body.code]).toEqual([code, body]);
      expect(res.body).not.toHaveProperty('id');
      expect(sent).toHaveLength(1);
    },
  );

  it('answers a slug nobody holds 404 after one statement, then from the cache', async () => {
    const unknown = `nobody-${randomUUID()}`;

    const first = await counted(unknown);
    const second = await counted(unknown);

    expect([first.res.status, second.res.status]).toEqual([404, 404]);
    expect([first.sent.length, second.sent.length]).toEqual([1, 0]);
  });

  it('sends nothing to PostgreSQL for a cached profile', async () => {
    const w = await militari();
    await read(w.garage.slug);

    const { res, sent } = await counted(w.garage.slug);

    expect(res.status).toBe(200);
    expect(sent).toEqual([]);
  });
});

// The relay hands on every event the write committed; the profile's cached
// entry goes with the garage's audience.
async function relayed(since: Date) {
  const relay = new OutboxRelay(prisma, other);
  for (let lap = 0; lap < 50; lap++) {
    await relay.relay();
    const waiting = await prisma.outboxEvent.count({
      where: { createdAt: { gte: since }, relayedAt: null },
    });
    if (waiting === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('the events of the write were never relayed');
}

async function ownerOf(garageId: string): Promise<Actor> {
  const accountId = await account(`Mihai ${randomUUID()}`, ['garage']);
  await prisma.garageMember.create({
    data: { accountId, garageId, role: 'owner' },
  });
  return {
    accountId,
    garageId,
    permissions: none,
    role: 'garage',
    roles: ['garage'],
  };
}

const now = async () => {
  const [{ at }] = await prisma.$queryRaw<
    { at: Date }[]
  >`SELECT clock_timestamp() AS at`;
  return at;
};

// @traces 1183-FR-005
describe('the next read after a change the garage makes', () => {
  it('shows a new courtesy car price after garage.updated', async () => {
    const w = await militari();
    const owner = await ownerOf(w.garage.id);
    await read(w.garage.slug);
    const since = await now();

    await app
      .get(GarageSettingsService)
      .update(owner, w.garage.id, { courtesyCar: { paid: false } });
    await relayed(since);

    expect((await read(w.garage.slug)).body.courtesyCar).toEqual({
      paid: false,
    });
  });

  it('shows a brand newly taken after garage.updated from the brands', async () => {
    const w = await militari();
    const owner = await ownerOf(w.garage.id);
    await read(w.garage.slug);
    const since = await now();

    await app.get(GarageBrandsService).replace(owner, w.garage.id, {
      brands: [
        { brandId: w.dacia.id, stance: 'works_on' },
        { brandId: w.tesla.id, stance: 'works_on' },
      ],
    });
    await relayed(since);

    const res = await read(w.garage.slug);
    expect(res.body.worksOn.map((b: { id: string }) => b.id)).toEqual([
      w.dacia.id,
      w.tesla.id,
    ]);
    expect(res.body.doesNotTake).toEqual([]);
  });

  it('shows a new price range after price_list.updated', async () => {
    const w = await militari();
    const owner = await ownerOf(w.garage.id);
    await read(w.garage.slug);
    const since = await now();

    await app.get(PriceListService).setRange(
      owner,
      { garageId: w.garage.id, priceId: w.brakesPrice.id },
      {
        durationMinutes: 60,
        expectedUpdatedAt: w.brakesPrice.updatedAt.toISOString(),
        fromBani: 21_000,
        toBani: 30_000,
      },
    );
    await relayed(since);

    expect((await read(w.garage.slug)).body.prices[0]).toMatchObject({
      fromBani: 21_000,
      jobTypeId: w.brakes.id,
    });
  });

  it('shows the new verification date after a published verification.decided', async () => {
    const garage = await prisma.garage.create({
      data: {
        approvedAt: new Date('2026-09-01T08:00:00.000Z'),
        name: 'Service Auto Titan',
        slug: `titan-${randomUUID()}`,
        status: 'approved',
      },
    });
    const owner = await ownerOf(garage.id);
    const admin = await account(`Ioana ${randomUUID()}`, ['admin']);
    const verification = app.get(VerificationService);
    expect((await read(garage.slug)).body.verifiedAt).toBe(
      '2026-09-01T08:00:00.000Z',
    );
    const file = await prisma.$transaction((tx) =>
      verification.submit(tx, owner, garage.id),
    );
    await prisma.verificationCheck.updateMany({
      data: { result: 'ok' },
      where: { fileId: file.id },
    });
    await prisma.legalDocument.createMany({
      data: ['onrc_certificate', 'rar_authorisation'].map((kind) => ({
        kind,
        pages: [`${kind}/1.pdf`],
        verificationFileId: file.id,
      })),
      skipDuplicates: true,
    });
    const since = await now();

    const decided = await prisma.$transaction((tx) =>
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
    await relayed(since);

    expect((await read(garage.slug)).body.verifiedAt).toBe(
      decided.decidedAt?.toISOString(),
    );
  });
});
