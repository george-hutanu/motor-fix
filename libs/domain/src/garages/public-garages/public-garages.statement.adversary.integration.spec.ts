import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { Redis } from 'ioredis';
import request from 'supertest';

import { AuthModule } from '../../auth/auth.module';
import { PRISMA } from '../../auth/prisma';
import { serialDatabase } from '../../auth/serial-db.testing';
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
import { GaragesModule } from '../garages.module';

const redisUrl = redisUrlFor(2);
const { prisma, reset } = fixtures();
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

const brandOf = (name: string, popularity: number | null) => {
  const slug = `${name.toLowerCase()}-${randomUUID()}`;
  return prisma.brand.create({
    data: { key: slug, name, popularity, slug },
  });
};

const approved = (data: Record<string, unknown> = {}) =>
  prisma.garage.create({
    data: {
      name: 'Garage',
      slug: `g-${randomUUID()}`,
      status: 'approved',
      ...data,
    },
  });

// @traces 1183-FR-001 1183-FR-002
describe('the profile read by status', () => {
  it('shows an approval and a suspension on the very next read', async () => {
    const garage = await approved({ status: 'draft' });
    expect((await read(garage.slug)).status).toBe(404);

    await prisma.garage.update({
      data: { status: 'approved' },
      where: { id: garage.id },
    });
    expect((await read(garage.slug)).status).toBe(200);
  });

  it('answers an unknown slug, a differently cased slug and a long slug with 404 in at most one statement', async () => {
    const garage = await approved({ slug: `mixed-${randomUUID()}` });

    for (const slug of [
      `nobody-${randomUUID()}`,
      garage.slug.toUpperCase(),
      'a'.repeat(5_000),
      '%E2%80%AE',
      '%F0%9F%9A%97',
    ]) {
      const { res, sent } = await counted(slug);

      expect([slug.slice(0, 20), res.status, sent.length <= 1]).toEqual([
        slug.slice(0, 20),
        404,
        true,
      ]);
    }
  });

  it('runs no statement for a slug holding a control character', async () => {
    for (const slug of ['%00', 'a%00b', 'a%0Ab', '%7F', '%C2%85']) {
      const { res, sent } = await counted(slug);

      expect([slug, res.status, sent]).toEqual([slug, 404, []]);
    }
  });

  it('answers a slug of SQL syntax as an unknown garage', async () => {
    const { res, sent } = await counted(encodeURIComponent(`x' OR '1'='1`));

    expect(res.status).toBe(404);
    expect(sent).toHaveLength(1);
  });
});

// @traces 1183-FR-003
describe('the profile aggregates with ties and gaps', () => {
  it('orders brands by popularity with the unranked last, then by name', async () => {
    const garage = await approved();
    const brands = [
      await brandOf('Zeta', null),
      await brandOf('Beta', 5),
      await brandOf('Alpha', 5),
      await brandOf('Omega', 1),
    ];
    await prisma.garageBrand.createMany({
      data: brands.map((b) => ({
        brandId: b.id,
        garageId: garage.id,
        stance: 'works_on' as const,
      })),
    });

    const { res, sent } = await counted(garage.slug);

    expect(res.body.worksOn.map((b: { name: string }) => b.name)).toEqual([
      'Omega',
      'Alpha',
      'Beta',
      'Zeta',
    ]);
    expect(sent).toHaveLength(1);
  });

  it('reads a hundred photos in one statement', async () => {
    const garage = await approved();
    await prisma.garagePhoto.createMany({
      data: Array.from({ length: 100 }, (_, i) => ({
        fileKey: `garage_photo/${garage.id}/${randomUUID()}`,
        garageId: garage.id,
        height: 10,
        position: i,
        width: 10,
      })),
    });

    const { res, sent } = await counted(garage.slug);

    expect(res.body.photos).toHaveLength(100);
    expect(sent).toHaveLength(1);
  });

  it('takes the approved decision and ignores later and earlier refusals', async () => {
    const garage = await approved({
      approvedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const at = (iso: string) => new Date(iso);
    // Only one file per garage is live (submitted, in review or approved).
    for (const [decidedAt, status] of [
      ['2026-02-01T00:00:00.000Z', 'rejected'],
      ['2026-03-01T00:00:00.000Z', 'approved'],
      ['2026-06-01T00:00:00.000Z', 'rejected'],
    ] as const) {
      await prisma.verificationFile.create({
        data: { decidedAt: at(decidedAt), garageId: garage.id, status },
      });
    }

    const res = await read(garage.slug);

    expect(res.body.verifiedAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('shows the approval time when only a rejected file exists', async () => {
    const garage = await approved({
      approvedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await prisma.verificationFile.create({
      data: {
        decidedAt: new Date('2026-06-01T00:00:00.000Z'),
        garageId: garage.id,
        status: 'rejected',
      },
    });

    const res = await read(garage.slug);

    expect(res.body.verifiedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('keeps every key of a bare garage and runs one statement', async () => {
    const garage = await approved();

    const { res, sent } = await counted(garage.slug);

    expect(res.body).toEqual({
      brandNote: null,
      doesNotTake: [],
      id: garage.id,
      jobTypes: [],
      name: 'Garage',
      paymentMethods: { card: false, cash: false, transfer: false },
      photos: [],
      prices: [],
      rating: null,
      refusalPhrase: null,
      responseRate: expect.anything(),
      reviewCount: 0,
      slug: garage.slug,
      verifiedAt: null,
      worksOn: [],
    });
    expect(sent).toHaveLength(1);
  });

  it('keeps a retired brand in context and a mobile garage without its seat', async () => {
    const garage = await approved({
      address: 'Seat 1',
      businessKind: 'mobile',
      latitude: 44.4,
      longitude: 26.1,
    });
    const dacia = await brandOf('Dacia', 1);
    await prisma.brand.update({
      data: { active: false },
      where: { id: dacia.id },
    });
    await read(`nobody-${randomUUID()}`, { brand: dacia.slug });

    const { res, sent } = await counted(garage.slug, { brand: dacia.slug });

    expect(res.body.brand).toEqual({
      id: dacia.id,
      name: 'Dacia',
      slug: dacia.slug,
      stance: 'does_not_take',
    });
    expect(res.body).toMatchObject({ serviceRadiusKm: 20 });
    expect(res.body).not.toHaveProperty('address');
    expect(res.body).not.toHaveProperty('latitude');
    expect(sent).toHaveLength(1);
  });
});
