import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { AuthModule } from '../../auth/auth.module';
import type { Actor } from '../../auth/policy';
import { serialDatabase } from '../../auth/serial-db.testing';
import { addDays, localDay } from '../../bucharest';
import { OutboxRelay } from '../../events/outbox-relay/outbox-relay';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications/notifications.testing';
import { UNUSED_STORAGE } from '../../storage/s3-test-store';
import { StorageModule } from '../../storage/storage.module';
import { GaragesModule } from '../garages.module';
import { RecheckService } from '../verification/recheck/recheck.service';

const redisUrl = redisUrlFor(2);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;
const other = new Redis(redisUrl);

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
});

afterAll(async () => {
  await app.close();
  other.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await prisma.outboxEvent.deleteMany();
});

const read = (slug: string) =>
  request(app.getHttpServer()).get(`/garages/${slug}`);

const today = () => localDay(new Date());

const garage = (data: Record<string, unknown> = {}) =>
  prisma.garage.create({
    data: {
      name: 'Atelier Dinamo',
      rarActivities: ['mechanics'],
      slug: `dinamo-${randomUUID()}`,
      status: 'approved',
      ...data,
    },
  });

async function adminActor(): Promise<Actor> {
  return {
    accountId: await account('Ana Popescu', ['admin']),
    garageId: null,
    permissions: {
      canAnswerQuotes: false,
      canMoveBookings: false,
      canRecordFinalPrice: false,
    },
    role: 'admin',
    roles: ['admin'],
  };
}

const okBody = (lastCheckedOn: string | null) => ({
  activities: ['mechanics'],
  checkedOn: today(),
  lastCheckedOn,
  result: 'ok' as const,
});

async function relayAll() {
  const relay = new OutboxRelay(prisma, other);
  for (let lap = 0; lap < 50; lap++) {
    await relay.relay();
    const waiting = await prisma.outboxEvent.count({
      where: { relayedAt: null },
    });
    if (waiting === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('events never relayed');
}

describe('the verification date of a profile at the edges of a day', () => {
  // @traces 1353-FR-001
  it.each([
    '2026-03-28',
    '2026-03-29',
    '2026-03-30',
    '2026-10-24',
    '2026-10-25',
    '2026-10-26',
    '2026-12-31',
    '2027-01-01',
    '2028-02-29',
    '1999-12-31',
  ])('answers UTC midnight of the stored day %s', async (day) => {
    const g = await garage({
      approvedAt: new Date('2026-06-01T22:30:00.000Z'),
      lastCheckedOn: new Date(day),
    });

    const res = await read(g.slug);

    expect(res.body.verifiedAt).toBe(`${day}T00:00:00.000Z`);
  });

  // @traces 1353-FR-001
  it('answers the stored day, not the approval day, when the approval fell at 23:30 UTC', async () => {
    const g = await garage({
      approvedAt: new Date('2026-07-10T23:30:00.000Z'),
      lastCheckedOn: new Date('2026-07-11'),
    });

    expect((await read(g.slug)).body.verifiedAt).toBe(
      '2026-07-11T00:00:00.000Z',
    );
  });

  // @traces 1353-FR-001
  it('answers a stored day that is earlier than the approval instant as stored', async () => {
    const g = await garage({
      approvedAt: new Date('2026-09-01T10:00:00.000Z'),
      lastCheckedOn: new Date('2026-01-05'),
    });

    expect((await read(g.slug)).body.verifiedAt).toBe(
      '2026-01-05T00:00:00.000Z',
    );
  });

  // @traces 1353-FR-001
  it('answers a stored day with no approval instant at all', async () => {
    const g = await garage({
      approvedAt: null,
      lastCheckedOn: new Date('2026-04-02'),
    });

    expect((await read(g.slug)).body.verifiedAt).toBe(
      '2026-04-02T00:00:00.000Z',
    );
  });

  // @traces 1353-FR-001
  it('answers null when the garage holds neither a stored day nor an approval instant, even with an approved file', async () => {
    const g = await garage({ approvedAt: null, lastCheckedOn: null });
    await prisma.verificationFile.create({
      data: {
        decidedAt: new Date('2026-05-01T09:30:00.000Z'),
        garageId: g.id,
        status: 'approved',
      },
    });

    const res = await read(g.slug);

    expect(res.status).toBe(200);
    expect(res.body.verifiedAt).toBeNull();
  });

  // @traces 1353-FR-001
  it('answers the approval instant with its milliseconds when no day is stored', async () => {
    const g = await garage({
      approvedAt: new Date('2026-10-25T00:59:59.999Z'),
      lastCheckedOn: null,
    });

    expect((await read(g.slug)).body.verifiedAt).toBe(
      '2026-10-25T00:59:59.999Z',
    );
  });

  // @traces 1353-FR-001
  it('keeps the stored day whatever the verification files say afterwards', async () => {
    const g = await garage({
      approvedAt: new Date('2026-02-01T10:00:00.000Z'),
      lastCheckedOn: new Date('2026-02-01'),
    });
    await prisma.verificationFile.createMany({
      data: [
        {
          decidedAt: new Date('2026-08-01T10:00:00.000Z'),
          garageId: g.id,
          status: 'approved',
        },
        {
          decidedAt: new Date('2026-09-01T10:00:00.000Z'),
          garageId: g.id,
          status: 'rejected',
        },
      ],
    });

    expect((await read(g.slug)).body.verifiedAt).toBe(
      '2026-02-01T00:00:00.000Z',
    );
  });

  // @traces 1353-FR-001
  it('answers the same value on two reads in a row', async () => {
    const g = await garage({ lastCheckedOn: new Date('2026-10-25') });

    const first = await read(g.slug);
    const second = await read(g.slug);

    expect([first.body.verifiedAt, second.body.verifiedAt]).toEqual([
      '2026-10-25T00:00:00.000Z',
      '2026-10-25T00:00:00.000Z',
    ]);
  });
});

describe('the verification date after re-checks', () => {
  // @traces 1353-FR-004 1353-FR-006
  it('shows the new day on the next read after a valid re-check and the relay, though the old answer was cached', async () => {
    const stored = addDays(today(), -40);
    const g = await garage({ lastCheckedOn: new Date(stored) });
    const before = await read(g.slug);
    const admin = await adminActor();

    await app.get(RecheckService).record(admin, g.id, okBody(stored));
    await relayAll();
    const after = await read(g.slug);

    expect([before.body.verifiedAt, after.body.verifiedAt]).toEqual([
      `${stored}T00:00:00.000Z`,
      `${today()}T00:00:00.000Z`,
    ]);
  });

  // @traces 1353-FR-006
  it('writes recheck.recorded to the garage public channel for a valid re-check', async () => {
    const stored = addDays(today(), -40);
    const g = await garage({ lastCheckedOn: new Date(stored) });

    await app
      .get(RecheckService)
      .record(await adminActor(), g.id, okBody(stored));

    const events = await prisma.outboxEvent.findMany({
      where: { kind: 'recheck.recorded', subjectId: g.id },
    });
    expect(events.map((e) => e.audience)).toEqual([
      expect.arrayContaining([`public:garage:${g.id}`]),
    ]);
  });

  // @traces 1353-FR-001
  it('leaves the date alone and answers 410 after a failed re-check', async () => {
    const stored = addDays(today(), -40);
    const g = await garage({ lastCheckedOn: new Date(stored) });
    expect((await read(g.slug)).status).toBe(200);

    await app.get(RecheckService).record(await adminActor(), g.id, {
      checkedOn: today(),
      detail: 'expirată pe 12 sept. 2026',
      failure: 'expired',
      lastCheckedOn: stored,
      result: 'failed',
    } as never);
    await relayAll();

    const row = await prisma.garage.findUniqueOrThrow({ where: { id: g.id } });
    expect(row.lastCheckedOn?.toISOString()).toBe(`${stored}T00:00:00.000Z`);
    expect((await read(g.slug)).status).toBe(410);
  });

  // @traces 1353-FR-001
  it('keeps the old date when the re-check is refused as stale', async () => {
    const stored = addDays(today(), -40);
    const g = await garage({ lastCheckedOn: new Date(stored) });
    const admin = await adminActor();
    await read(g.slug);

    await expect(
      app.get(RecheckService).record(admin, g.id, okBody(addDays(stored, -3))),
    ).rejects.toBeDefined();
    await relayAll();

    expect((await read(g.slug)).body.verifiedAt).toBe(
      `${stored}T00:00:00.000Z`,
    );
  });

  // @traces 1353-FR-001
  it('keeps the date when a second valid re-check on the same day is refused', async () => {
    const stored = addDays(today(), -40);
    const g = await garage({ lastCheckedOn: new Date(stored) });
    const admin = await adminActor();
    const svc = app.get(RecheckService);
    await svc.record(admin, g.id, okBody(stored));

    await expect(svc.record(admin, g.id, okBody(stored))).rejects.toBeDefined();
    await relayAll();

    expect((await read(g.slug)).body.verifiedAt).toBe(
      `${today()}T00:00:00.000Z`,
    );
  });

  // @traces 1353-FR-001
  it('keeps the date when a re-check is dated in the future', async () => {
    const stored = addDays(today(), -40);
    const g = await garage({ lastCheckedOn: new Date(stored) });

    await expect(
      app.get(RecheckService).record(await adminActor(), g.id, {
        ...okBody(stored),
        checkedOn: addDays(today(), 5),
      }),
    ).rejects.toBeDefined();

    const row = await prisma.garage.findUniqueOrThrow({ where: { id: g.id } });
    expect(row.lastCheckedOn?.toISOString()).toBe(`${stored}T00:00:00.000Z`);
  });

  // @traces 1353-FR-001
  it('does not show a date for a suspended garage', async () => {
    const g = await garage({
      lastCheckedOn: new Date('2026-03-29'),
      status: 'suspended',
    });

    const res = await read(g.slug);

    expect([res.status, res.body.verifiedAt]).toEqual([410, undefined]);
  });
});
